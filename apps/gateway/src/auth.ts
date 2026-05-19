import { jwtVerify, SignJWT } from "jose";
import type { GatewayEnv } from "./types";
import { corsHeaders, errorResponse } from "./index";

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";
const GITHUB_API_HEADERS = {
	Accept: "application/vnd.github+json",
	"User-Agent": "constructor-gateway",
	"X-GitHub-Api-Version": "2022-11-28",
};

const PKCE_TTL_SECONDS = 600; // 10 minutes
const JWT_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const SESSION_TTL_SECONDS = JWT_TTL_SECONDS + 300;
const JWT_ISSUER = "constructor-gateway";
const JWT_AUDIENCE = "constructor-mobile";

interface PkceSession {
	verifier: string;
	appRedirectUri: string;
}

const ALLOWED_APP_REDIRECT = "mobile://auth/callback";

function generateCodeVerifier(): string {
	const arr = new Uint8Array(64);
	crypto.getRandomValues(arr);
	return encodeBase64Url(arr);
}

function encodeBase64Url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function parseJson<T>(raw: string): T | null {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

function isSafeState(state: string): boolean {
	return /^[A-Za-z0-9._~-]{16,128}$/.test(state);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const hash = await crypto.subtle.digest("SHA-256", data);
	const bytes = new Uint8Array(hash);
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

export async function handleAuthStart(request: Request, env: GatewayEnv): Promise<Response> {
	const url = new URL(request.url);
	const appRedirectUri = url.searchParams.get("redirect_uri");
	const state = url.searchParams.get("state") || generateCodeVerifier().slice(0, 32);

	if (!appRedirectUri) {
		return errorResponse("redirect_uri is required", 400);
	}
	if (!isSafeState(state)) {
		return errorResponse("state is invalid", 400);
	}
	if (appRedirectUri !== ALLOWED_APP_REDIRECT) {
		return errorResponse("redirect_uri is not allowed", 400);
	}

	const verifier = generateCodeVerifier();
	const challenge = await generateCodeChallenge(verifier);

	const session: PkceSession = { verifier, appRedirectUri };
	await env.GATEWAY_KV.put(`pkce:${state}`, JSON.stringify(session), {
		expirationTtl: PKCE_TTL_SECONDS,
	});

	const authUrl = new URL(GITHUB_AUTH_URL);
	authUrl.searchParams.set("client_id", env.GITHUB_OAUTH_CLIENT_ID);
	authUrl.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("scope", "repo user");
	authUrl.searchParams.set("state", state);
	authUrl.searchParams.set("code_challenge", challenge);
	authUrl.searchParams.set("code_challenge_method", "S256");

	return Response.redirect(authUrl.toString(), 302);
}

export async function handleAuthCallback(request: Request, env: GatewayEnv): Promise<Response> {
	const url = new URL(request.url);
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");

	if (!code || !state) {
		return errorResponse("Missing code or state", 400);
	}
	if (!isSafeState(state)) {
		return errorResponse("state is invalid", 400);
	}

	const sessionRaw = await env.GATEWAY_KV.get(`pkce:${state}`);
	if (!sessionRaw) {
		return errorResponse("Invalid or expired session", 400);
	}
	const session = parseJson<PkceSession>(sessionRaw);
	if (!session) {
		await env.GATEWAY_KV.delete(`pkce:${state}`);
		return errorResponse("Invalid or expired session", 400);
	}
	await env.GATEWAY_KV.delete(`pkce:${state}`);

	// Exchange code for GitHub access token
	const tokenRes = await fetch(GITHUB_TOKEN_URL, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			client_id: env.GITHUB_OAUTH_CLIENT_ID,
			client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
			code,
			redirect_uri: `${url.origin}/auth/callback`,
			code_verifier: session.verifier,
		}),
	});

	if (!tokenRes.ok) {
		return errorResponse("Failed to exchange GitHub code", 502);
	}

	const tokenData = (await tokenRes.json()) as {
		access_token?: string;
		error?: string;
		scope?: string;
	};

	if (tokenData.error || !tokenData.access_token) {
		return errorResponse(tokenData.error || "GitHub auth failed", 502);
	}

	const ghToken = tokenData.access_token;

	// Fetch GitHub user profile
	const userRes = await fetch(GITHUB_USER_URL, {
		headers: { ...GITHUB_API_HEADERS, Authorization: `Bearer ${ghToken}` },
	});

	if (!userRes.ok) {
		console.error("GitHub /user failed", {
			status: userRes.status,
			body: (await userRes.text()).slice(0, 500),
			scope: tokenData.scope,
		});
		return errorResponse("Failed to fetch GitHub user", 502);
	}

	const user = (await userRes.json()) as {
		id: number;
		login: string;
		name?: string | null;
		email?: string | null;
	};

	let email = user.email;
	if (!email) {
		const emailsRes = await fetch(GITHUB_EMAILS_URL, {
			headers: { ...GITHUB_API_HEADERS, Authorization: `Bearer ${ghToken}` },
		});
		if (emailsRes.ok) {
			const emails = (await emailsRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
			const primary = emails.find((e) => e.primary && e.verified);
			if (primary) email = primary.email;
		} else {
			console.error("GitHub /user/emails failed", {
				status: emailsRes.status,
				body: (await emailsRes.text()).slice(0, 500),
				scope: tokenData.scope,
			});
		}
	}

	// Issue app JWT
	const sessionId = crypto.randomUUID();
	await env.GATEWAY_KV.put(`app-session:${sessionId}`, JSON.stringify({
		scmUserId: String(user.id),
		scmLogin: user.login,
		scmName: user.name || user.login,
		scmEmail: email ?? null,
		scmToken: ghToken,
	} satisfies StoredAppSession), {
		expirationTtl: SESSION_TTL_SECONDS,
	});
	const jwt = await signAppJwt(env, {
		sub: String(user.id),
		sessionId,
		scmUserId: String(user.id),
		scmLogin: user.login,
		scmName: user.name || user.login,
		scmEmail: email ?? null,
	});

	// Redirect back to app
	const redirect = new URL(session.appRedirectUri);
	redirect.searchParams.set("token", jwt);
	redirect.searchParams.set("state", state);

	return Response.redirect(redirect.toString(), 302);
}

export async function handleAuthSessionDelete(request: Request, env: GatewayEnv): Promise<Response> {
	const authHeader = request.headers.get("Authorization");
	if (!authHeader?.startsWith("Bearer ")) return errorResponse("Unauthorized", 401);
	const user = await verifyAppJwt(env, authHeader.slice(7));
	if (!user) return errorResponse("Invalid or expired token", 401);
	await env.GATEWAY_KV.delete(`app-session:${user.sessionId}`);
	return new Response(null, { status: 204, headers: corsHeaders });
}

/**
 * Re-issue an app JWT for the same KV-backed session. The KV record is the
 * source of truth for revocation (logging out deletes it); as long as it
 * exists, a fresh 24h JWT can be minted from it. This lets the mobile client
 * stay logged in across multi-day usage without forcing a re-OAuth.
 *
 * Auth: the caller presents their CURRENT (possibly close-to-expiry) JWT. We
 * verify it normally; if expired by less than the grace window, we still
 * accept it for refresh purposes (clockTolerance handles small drift; expired
 * tokens fail `jwtVerify` entirely so the grace path is the explicit branch).
 */
export async function handleAuthRefresh(request: Request, env: GatewayEnv): Promise<Response> {
	const authHeader = request.headers.get("Authorization");
	if (!authHeader?.startsWith("Bearer ")) return errorResponse("Unauthorized", 401);
	const presented = authHeader.slice(7);

	// 1) Fast path: token still valid → re-issue immediately.
	const valid = await verifyAppJwt(env, presented);
	if (valid) {
		const fresh = await signAppJwt(env, {
			sub: valid.sub,
			sessionId: valid.sessionId,
			scmUserId: valid.scmUserId,
			scmLogin: valid.scmLogin,
			scmName: valid.scmName,
			scmEmail: valid.scmEmail,
		});
		// Touch the KV TTL so a sliding window applies.
		const stored: StoredAppSession = {
			scmUserId: valid.scmUserId,
			scmLogin: valid.scmLogin,
			scmName: valid.scmName,
			scmEmail: valid.scmEmail,
			scmToken: valid.scmToken,
		};
		await env.GATEWAY_KV.put(`app-session:${valid.sessionId}`, JSON.stringify(stored), {
			expirationTtl: SESSION_TTL_SECONDS,
		});
		return new Response(JSON.stringify({ token: fresh }), {
			status: 200,
			headers: { ...corsHeaders, "Content-Type": "application/json" },
		});
	}

	// 2) Slow path: token expired (but otherwise well-formed and signed by us).
	// We still call `jwtVerify` — signature, issuer, and audience are all
	// enforced — but allow up to 7 days past `exp` via a wide `clockTolerance`.
	// That bounds the offline window without forcing daily re-OAuth, while
	// keeping the signing key + issuer/audience as the trust root. Anything
	// that fails signature, iss, or aud is rejected. If KV no longer holds
	// the session record we also reject (logout invalidates this path).
	const grace = await refreshFromExpiredToken(env, presented);
	if (grace) return grace;

	return errorResponse("Invalid or expired token", 401);
}

async function refreshFromExpiredToken(env: GatewayEnv, presented: string): Promise<Response | null> {
	try {
		const key = await importJwk(env.APP_JWT_SIGNING_KEY);
		const { payload } = await jwtVerify(presented, key, {
			algorithms: ["HS256"],
			issuer: JWT_ISSUER,
			audience: JWT_AUDIENCE,
			// Allow up to 7 days past expiry for graceful refresh. This bounds
			// the offline window without forcing daily re-OAuth.
			clockTolerance: 7 * 24 * 60 * 60,
		});
		const sessionId = payload.sessionId as string | undefined;
		if (!payload.sub || !sessionId) return null;
		const sessionRaw = await env.GATEWAY_KV.get(`app-session:${sessionId}`);
		if (!sessionRaw) return null;
		const session = parseJson<StoredAppSession>(sessionRaw);
		if (!session) return null;
		const fresh = await signAppJwt(env, {
			sub: payload.sub as string,
			sessionId,
			scmUserId: session.scmUserId,
			scmLogin: session.scmLogin,
			scmName: session.scmName,
			scmEmail: session.scmEmail,
		});
		await env.GATEWAY_KV.put(`app-session:${sessionId}`, JSON.stringify(session), {
			expirationTtl: SESSION_TTL_SECONDS,
		});
		return new Response(JSON.stringify({ token: fresh }), {
			status: 200,
			headers: { ...corsHeaders, "Content-Type": "application/json" },
		});
	} catch {
		return null;
	}
}

export interface AppJwtPayload {
	sub: string;
	sessionId: string;
	scmUserId: string;
	scmLogin: string;
	scmName: string;
	scmEmail: string | null;
}

export interface AuthenticatedUser extends AppJwtPayload {
	scmToken: string;
}

type StoredAppSession = Omit<AuthenticatedUser, "sub" | "sessionId">;

async function signAppJwt(env: GatewayEnv, payload: AppJwtPayload): Promise<string> {
	const key = await importJwk(env.APP_JWT_SIGNING_KEY);
	return new SignJWT({
		sessionId: payload.sessionId,
		scmUserId: payload.scmUserId,
		scmLogin: payload.scmLogin,
		scmName: payload.scmName,
		scmEmail: payload.scmEmail,
	})
		.setProtectedHeader({ alg: "HS256" })
		.setSubject(payload.sub)
		.setIssuer(JWT_ISSUER)
		.setAudience(JWT_AUDIENCE)
		.setIssuedAt()
		.setExpirationTime("24h")
		.sign(key);
}

export async function verifyAppJwt(env: GatewayEnv, token: string): Promise<AuthenticatedUser | null> {
	try {
		const key = await importJwk(env.APP_JWT_SIGNING_KEY);
		const { payload } = await jwtVerify(token, key, {
			algorithms: ["HS256"],
			clockTolerance: 60,
			issuer: JWT_ISSUER,
			audience: JWT_AUDIENCE,
		});
		const sessionId = payload.sessionId as string | undefined;
		if (!payload.sub || !sessionId) return null;
		const sessionRaw = await env.GATEWAY_KV.get(`app-session:${sessionId}`);
		if (!sessionRaw) return null;
		const session = parseJson<StoredAppSession>(sessionRaw);
		if (!session) return null;
		return {
			sub: payload.sub as string,
			sessionId,
			scmUserId: session.scmUserId,
			scmLogin: session.scmLogin,
			scmName: session.scmName,
			scmEmail: session.scmEmail,
			scmToken: session.scmToken,
		};
	} catch {
		return null;
	}
}

async function importJwk(secret: string): Promise<CryptoKey> {
	const encoder = new TextEncoder();
	return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
