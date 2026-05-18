import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("Gateway worker", () => {
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
});
