import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { afterEach, describe, it, expect, vi } from "vitest";
import { handleAuthCallback } from "../src/auth";
import worker from "../src/index";
import type { GatewayEnv } from "../src/types";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

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
		await authEnv.GATEWAY_KV.put("pkce:test-state", JSON.stringify({
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
				return Response.json({ id: 123, login: "octocat", name: "Octo Cat", email: "octo@example.com" });
			}
			if (url === "https://api.github.com/user/emails") {
				const headers = new Headers(init?.headers);
				expect(headers.get("User-Agent")).toBe("constructor-gateway");
				return Response.json([]);
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});

		const response = await handleAuthCallback(
			new Request("https://gateway.example/auth/callback?code=code&state=test-state"),
			authEnv,
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toContain("mobile://auth/callback?token=");
		expect(fetchSpy).toHaveBeenCalledTimes(3);
	});
});
