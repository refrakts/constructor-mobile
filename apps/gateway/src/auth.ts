import { jwtVerify, SignJWT } from "jose";
import type { GatewayEnv } from "./types";
import { errorResponse, json } from "./index";

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";

const PKCE_TTL_SECONDS = 600; // 10 minutes
const JWT_TTL_SECONDS = 24 * 60 * 60; // 24 hours

interface PkceSession {
	verifier: string;
	appRedirectUri: string;
}

function generateCodeVerifier(): string {
	const arr = new Uint8Array(64);
	crypto.getRandomValues(arr);
	return Array.from(arr)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
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

	const sessionRaw = await env.GATEWAY_KV.get(`pkce:${state}`);
	if (!sessionRaw) {
		return errorResponse("Invalid or expired session", 400);
	}
	const session = JSON.parse(sessionRaw) as PkceSession;

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
	};

	if (tokenData.error || !tokenData.access_token) {
		return errorResponse(tokenData.error || "GitHub auth failed", 502);
	}

	const ghToken = tokenData.access_token;

	// Fetch GitHub user profile
	const [userRes, emailsRes] = await Promise.all([
		fetch(GITHUB_USER_URL, {
			headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json" },
		}),
		fetch(GITHUB_EMAILS_URL, {
			headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json" },
		}),
	]);

	if (!userRes.ok) {
		return errorResponse("Failed to fetch GitHub user", 502);
	}

	const user = (await userRes.json()) as {
		id: number;
		login: string;
		name?: string | null;
		email?: string | null;
	};

	let email = user.email;
	if (!email && emailsRes.ok) {
		const emails = (await emailsRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
		const primary = emails.find((e) => e.primary && e.verified);
		if (primary) email = primary.email;
	}

	// Issue app JWT
	const jwt = await signAppJwt(env, {
		sub: String(user.id),
		scmUserId: String(user.id),
		scmLogin: user.login,
		scmName: user.name || user.login,
		scmEmail: email || `${user.id}+${user.login}@users.noreply.github.com`,
		scmToken: ghToken,
	});

	// Redirect back to app
	const redirect = new URL(session.appRedirectUri);
	redirect.searchParams.set("token", jwt);

	return Response.redirect(redirect.toString(), 302);
}

interface JwtPayload {
	sub: string;
	scmUserId: string;
	scmLogin: string;
	scmName: string;
	scmEmail: string;
	scmToken: string;
}

async function signAppJwt(env: GatewayEnv, payload: JwtPayload): Promise<string> {
	const key = await importJwk(env.APP_JWT_SIGNING_KEY);
	return new SignJWT({
		scmUserId: payload.scmUserId,
		scmLogin: payload.scmLogin,
		scmName: payload.scmName,
		scmEmail: payload.scmEmail,
		scmToken: payload.scmToken,
	})
		.setProtectedHeader({ alg: "HS256" })
		.setSubject(payload.sub)
		.setIssuedAt()
		.setExpirationTime(`${JWT_TTL_SECONDS}s`)
		.sign(key);
}

export async function verifyAppJwt(env: GatewayEnv, token: string): Promise<JwtPayload | null> {
	try {
		const key = await importJwk(env.APP_JWT_SIGNING_KEY);
		const { payload } = await jwtVerify(token, key, {
			algorithms: ["HS256"],
			clockTolerance: 60,
		});
		return {
			sub: payload.sub as string,
			scmUserId: payload.scmUserId as string,
			scmLogin: payload.scmLogin as string,
			scmName: payload.scmName as string,
			scmEmail: payload.scmEmail as string,
			scmToken: payload.scmToken as string,
		};
	} catch {
		return null;
	}
}

async function importJwk(secret: string): Promise<CryptoKey> {
	const encoder = new TextEncoder();
	return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
