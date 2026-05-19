/**
 * Constructor Mobile Gateway
 *
 * Compatibility layer between the mobile app and the background-agents control
 * plane. No changes are made to background-agents — all transforms happen here.
 *
 * Endpoints:
 *   GET    /config              → public config (controlPlaneUrl, wsUrl, githubOAuthClientId)
 *   GET    /auth/start          → begins GitHub OAuth PKCE flow
 *   GET    /auth/callback       → GitHub OAuth callback, issues app JWT
 *   POST   /auth/refresh        → re-issues an app JWT for the same KV session
 *   DELETE /auth/session        → revokes the current app JWT session
 *   GET|POST /sessions/...      → HMAC-signed proxy to control plane with user injection
 */

import type { GatewayEnv } from "./types";
import { handleConfig } from "./config";
import {
	handleAuthStart,
	handleAuthCallback,
	handleAuthRefresh,
	handleAuthSessionDelete,
} from "./auth";
import { handleProxy } from "./proxy";
import { handlePushRegister, pollAndSendPushNotifications } from "./push";
import { buildTraceContext, createLogger, errToFields } from "./logger";

export type { GatewayEnv } from "./types";

export default {
	async fetch(request: Request, env: GatewayEnv, ctx: ExecutionContext): Promise<Response> {
		const log = createLogger(buildTraceContext(request));
		const t0 = Date.now();
		const url = new URL(request.url);
		const path = url.pathname;

		log.info("request.start");

		try {
			let response: Response;
			if (request.method === "OPTIONS") {
				response = handleOptions(request);
			} else if (path === "/config") {
				response = handleConfig(request, env);
			} else if (path === "/auth/start") {
				response = await handleAuthStart(request, env);
			} else if (path === "/auth/callback") {
				response = await handleAuthCallback(request, env);
			} else if (path === "/auth/refresh" && request.method === "POST") {
				response = await handleAuthRefresh(request, env);
			} else if (path === "/auth/session" && request.method === "DELETE") {
				response = await handleAuthSessionDelete(request, env);
			} else if (path === "/push/register" && request.method === "POST") {
				response = await handlePushRegister(request, env);
			} else if (path.startsWith("/sessions")) {
				response = await handleProxy(request, env, ctx);
			} else {
				response = json({ error: "Not found" }, 404);
			}

			log.info("request.end", {
				status: response.status,
				durationMs: Date.now() - t0,
			});
			return response;
		} catch (e) {
			log.error("request.unhandled", {
				durationMs: Date.now() - t0,
				error: errToFields(e),
			});
			return json(
				{
					error: "Internal server error",
					requestId: log.context().requestId,
				},
				500,
			);
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
