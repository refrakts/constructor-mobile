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
 *   DELETE /auth/session      → revokes the current app JWT session
 *   GET|POST /sessions/...    → HMAC-signed proxy to control plane with user injection
 */

import type { GatewayEnv } from "./types";
import { handleConfig } from "./config";
import { handleAuthStart, handleAuthCallback, handleAuthSessionDelete } from "./auth";
import { handleProxy } from "./proxy";
import { handlePushRegister, pollAndSendPushNotifications } from "./push";

export type { GatewayEnv } from "./types";

export default {
	async fetch(request: Request, env: GatewayEnv, _ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		try {
			if (request.method === "OPTIONS") {
				return handleOptions(request);
			}

			if (path === "/config") {
				return handleConfig(request, env);
			}

			if (path === "/auth/start") {
				return handleAuthStart(request, env);
			}

			if (path === "/auth/callback") {
				return handleAuthCallback(request, env);
			}

			if (path === "/auth/session" && request.method === "DELETE") {
				return handleAuthSessionDelete(request, env);
			}

			if (path === "/push/register" && request.method === "POST") {
				return handlePushRegister(request, env);
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

	async scheduled(_controller: ScheduledController, env: GatewayEnv, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(pollAndSendPushNotifications(env));
	},
} satisfies ExportedHandler<GatewayEnv>;

export const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
	"Access-Control-Allow-Headers": "Authorization,Content-Type,Accept",
	"Access-Control-Max-Age": "86400",
};

export function handleOptions(request: Request): Response {
	if (request.headers.get("Origin") && request.headers.get("Access-Control-Request-Method")) {
		return new Response(null, { headers: corsHeaders });
	}
	return new Response(null, { headers: { Allow: "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS" } });
}

export function json(body: unknown, status = 200): Response {
	return Response.json(body, {
		status,
		headers: corsHeaders,
	});
}

export function errorResponse(message: string, status = 400): Response {
	return json({ error: message }, status);
}
