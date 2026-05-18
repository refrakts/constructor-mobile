import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { SignJWT } from "jose";
import { afterEach, describe, it, expect, vi } from "vitest";
import { handleAuthCallback, handleAuthSessionDelete, verifyAppJwt } from "../src/auth";
import { handleProxy } from "../src/proxy";
import worker from "../src/index";
import type { GatewayEnv } from "../src/types";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const TEST_STATE = "test-state-123456";

function testEnv(): GatewayEnv {
	const kv = new Map<string, string>();
	return {
		CONTROL_PLANE_URL: "https://control.example",
		WS_URL: "wss://ws.example",
		GITHUB_OAUTH_CLIENT_ID: "client-id",
		GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
		INTERNAL_CALLBACK_SECRET: "callback-secret",
		APP_JWT_SIGNING_KEY: "test-signing-key-with-enough-length",
		GATEWAY_KV: {
			get: async (key: string) => kv.get(key) ?? null,
			put: async (key: string, value: string) => {
				kv.set(key, value);
			},
			delete: async (key: string) => {
				kv.delete(key);
			},
		} as unknown as KVNamespace,
	};
}

async function appJwt(authEnv: GatewayEnv): Promise<string> {
	await authEnv.GATEWAY_KV.put("app-session:test-session", JSON.stringify({
		scmUserId: "123",
		scmLogin: "octocat",
		scmName: "Octo Cat",
		scmEmail: "octo@example.com",
		scmToken: "gh-token",
	}));
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(authEnv.APP_JWT_SIGNING_KEY),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
	return new SignJWT({
		sessionId: "test-session",
		scmUserId: "123",
		scmLogin: "octocat",
		scmName: "Octo Cat",
		scmEmail: "octo@example.com",
	})
		.setProtectedHeader({ alg: "HS256" })
		.setSubject("123")
		.setIssuer("constructor-gateway")
		.setAudience("constructor-mobile")
		.setIssuedAt()
		.setExpirationTime("1h")
		.sign(key);
}

describe("Gateway worker", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("GET /config returns JSON", async () => {
		const request = new IncomingRequest("http://example.com/config");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/json");
		const body = (await response.json()) as Record<string, unknown>;
		expect(typeof body).toBe("object");
	});

	it("unknown paths return 404", async () => {
		const response = await SELF.fetch("https://example.com/unknown");
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "Not found" });
	});

	it("rejects untrusted OAuth redirect URIs", async () => {
		const response = await SELF.fetch("https://example.com/auth/start?redirect_uri=https%3A%2F%2Fevil.example%2Fcallback");
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "redirect_uri is not allowed" });
	});

	it("handles CORS preflight requests", async () => {
		const response = await SELF.fetch("https://example.com/sessions", {
			method: "OPTIONS",
			headers: {
				Origin: "https://app.example",
				"Access-Control-Request-Method": "POST",
				"Access-Control-Request-Headers": "Authorization,Content-Type",
			},
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
	});

	it("requires auth for push registration", async () => {
		const response = await SELF.fetch("https://example.com/push/register", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ expoToken: "ExpoPushToken[test]" }),
		});
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Unauthorized" });
	});

	it("sends required GitHub API headers when fetching OAuth user details", async () => {
		const authEnv = testEnv();
		await authEnv.GATEWAY_KV.put(`pkce:${TEST_STATE}`, JSON.stringify({
			verifier: "verifier",
			appRedirectUri: "mobile://auth/callback",
		}));

		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = typeof input === "string" ? input : input.url;
			if (url === "https://github.com/login/oauth/access_token") {
				return Response.json({ access_token: "gh-token", scope: "repo,user" });
			}
			if (url === "https://api.github.com/user") {
				const headers = new Headers(init?.headers);
				expect(headers.get("Authorization")).toBe("Bearer gh-token");
				expect(headers.get("Accept")).toBe("application/vnd.github+json");
				expect(headers.get("User-Agent")).toBe("constructor-gateway");
				expect(headers.get("X-GitHub-Api-Version")).toBe("2022-11-28");
				return Response.json({ id: 123, login: "octocat", name: "Octo Cat", email: null });
			}
			if (url === "https://api.github.com/user/emails") {
				const headers = new Headers(init?.headers);
				expect(headers.get("User-Agent")).toBe("constructor-gateway");
				return Response.json([{ email: "octo@example.com", primary: true, verified: true }]);
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});

		const response = await handleAuthCallback(
			new Request(`https://gateway.example/auth/callback?code=code&state=${TEST_STATE}`),
			authEnv,
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toContain("mobile://auth/callback?token=");
		expect(fetchSpy).toHaveBeenCalledTimes(3);
	});
	it("reports a misconfigured control plane worker clearly", async () => {
		const authEnv = testEnv();
		const token = await appJwt(authEnv);
		vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
			cloudflare_error: true,
			error_code: 1042,
			detail: "No Workers script was found for this host on workers.dev.",
		}, { status: 404 }));

		const response = await handleProxy(new Request("https://gateway.example/sessions", {
			headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
		}), authEnv);

		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({
			error: "Control plane worker is unavailable: No Workers script was found for this host on workers.dev.",
		});
	});

	it("does not forward gateway-specific headers to the control plane", async () => {
		const authEnv = testEnv();
		const token = await appJwt(authEnv);
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ sessions: [] }));

		const response = await handleProxy(new Request("https://gateway.example/sessions", {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
				Host: "gateway.example",
				"CF-Ray": "test-ray",
				"X-Forwarded-Proto": "https",
			},
		}), authEnv);

		expect(response.status).toBe(200);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const upstream = fetchSpy.mock.calls[0][0] as Request;
		expect(upstream.url).toBe("https://control.example/sessions");
		expect(upstream.headers.has("Host")).toBe(false);
		expect(upstream.headers.has("CF-Ray")).toBe(false);
		expect(upstream.headers.has("X-Forwarded-Proto")).toBe(false);
		expect(upstream.headers.get("Authorization")).not.toBe(`Bearer ${token}`);
		expect(upstream.headers.get("Authorization")).toMatch(/^Bearer /);
	});

	it("stores null email instead of fabricating a noreply address", async () => {
		const authEnv = testEnv();
		await authEnv.GATEWAY_KV.put(`pkce:${TEST_STATE}`, JSON.stringify({
			verifier: "verifier",
			appRedirectUri: "mobile://auth/callback",
		}));
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = typeof input === "string" ? input : input.url;
			if (url === "https://github.com/login/oauth/access_token") {
				return Response.json({ access_token: "gh-token", scope: "repo,user" });
			}
			if (url === "https://api.github.com/user") {
				return Response.json({ id: 123, login: "octocat", name: "Octo Cat", email: null });
			}
			if (url === "https://api.github.com/user/emails") {
				return Response.json([]);
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});

		const response = await handleAuthCallback(
			new Request(`https://gateway.example/auth/callback?code=code&state=${TEST_STATE}`),
			authEnv,
		);
		const location = response.headers.get("location");
		const token = location ? new URL(location).searchParams.get("token") : null;

		expect(token).toBeTruthy();
		expect(await verifyAppJwt(authEnv, token!)).toMatchObject({ scmEmail: null });
	});

	it("rejects corrupted OAuth sessions", async () => {
		const authEnv = testEnv();
		await authEnv.GATEWAY_KV.put(`pkce:${TEST_STATE}`, "not-json");

		const response = await handleAuthCallback(
			new Request(`https://gateway.example/auth/callback?code=code&state=${TEST_STATE}`),
			authEnv,
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Invalid or expired session" });
	});

	it("revokes the app session on logout", async () => {
		const authEnv = testEnv();
		await authEnv.GATEWAY_KV.put(`pkce:${TEST_STATE}`, JSON.stringify({
			verifier: "verifier",
			appRedirectUri: "mobile://auth/callback",
		}));
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = typeof input === "string" ? input : input.url;
			if (url === "https://github.com/login/oauth/access_token") {
				return Response.json({ access_token: "gh-token", scope: "repo,user" });
			}
			if (url === "https://api.github.com/user") {
				return Response.json({ id: 123, login: "octocat", name: "Octo Cat", email: "octo@example.com" });
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});

		const callback = await handleAuthCallback(
			new Request(`https://gateway.example/auth/callback?code=code&state=${TEST_STATE}`),
			authEnv,
		);
		const location = callback.headers.get("location");
		const token = location ? new URL(location).searchParams.get("token") : null;
		expect(await verifyAppJwt(authEnv, token!)).not.toBeNull();

		const logout = await handleAuthSessionDelete(new Request("https://gateway.example/auth/session", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		}), authEnv);

		expect(logout.status).toBe(204);
		expect(await verifyAppJwt(authEnv, token!)).toBeNull();
	});
});
