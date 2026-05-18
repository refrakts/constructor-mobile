/**
 * Constructor Mobile Gateway
 *
 * Compatibility layer between the mobile app and the background-agents control
 * plane. No changes are made to background-agents — all transforms happen here.
 *
 * Endpoints:
 *   GET  /config              → public config (controlPlaneUrl, wsUrl, githubOAuthClientId)
 *   GET  /auth/start          → begins GitHub OAuth PKCE flow
 *   GET  /auth/callback       → GitHub OAuth callback, issues app JWT
 *   GET|POST /sessions/...    → HMAC-signed proxy to control plane with user injection
 */

import { jwtVerify, SignJWT } from "jose";
import type { GatewayEnv } from "./types";
import { handleConfig } from "./config";
import { handleAuthStart, handleAuthCallback } from "./auth";
import { handleProxy } from "./proxy";

export type { GatewayEnv } from "./types";

export default {
	async fetch(request: Request, env: GatewayEnv, _ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		try {
			if (path === "/config") {
				return handleConfig(request, env);
			}

			if (path === "/auth/start") {
				return handleAuthStart(request, env);
			}

			if (path === "/auth/callback") {
				return handleAuthCallback(request, env);
			}

			if (path.startsWith("/sessions")) {
				return handleProxy(request, env);
			}

			return json({ error: "Not found" }, 404);
		} catch (e) {
			console.error("Gateway error:", e);
			return json({ error: "Internal server error" }, 500);
		}
	},
} satisfies ExportedHandler<GatewayEnv>;

export function json(body: unknown, status = 200): Response {
	return Response.json(body, {
		status,
		headers: { "Access-Control-Allow-Origin": "*" },
	});
}

export function errorResponse(message: string, status = 400): Response {
	return json({ error: message }, status);
}
