import type { GatewayEnv } from "./types";
import { corsHeaders as defaultCorsHeaders, errorResponse } from "./index";
import { verifyAppJwt } from "./auth";
import { generateInternalToken } from "./internal-auth";
import { recordUserSessions } from "./push";

export async function handleProxy(request: Request, env: GatewayEnv): Promise<Response> {
	const authHeader = request.headers.get("Authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		return errorResponse("Unauthorized", 401);
	}

	const appToken = authHeader.slice(7);
	const user = await verifyAppJwt(env, appToken);
	if (!user) {
		return errorResponse("Invalid or expired token", 401);
	}

	// Build the upstream URL
	const url = new URL(request.url);
	const upstreamPath = url.pathname + url.search;
	const upstreamUrl = `${env.CONTROL_PLANE_URL.replace(/\/$/, "")}${upstreamPath}`;

	// Copy headers and inject HMAC auth
	const headers = new Headers(request.headers);
	headers.delete("Authorization"); // remove app JWT

	const internalToken = await generateInternalToken(env.INTERNAL_CALLBACK_SECRET);
	headers.set("Authorization", `Bearer ${internalToken}`);
	headers.set("x-request-id", crypto.randomUUID().slice(0, 8));
	headers.set("x-trace-id", crypto.randomUUID());

	// Build upstream request body
	let body: BodyInit | null = null;
	if (["POST", "PUT", "PATCH"].includes(request.method)) {
		const contentType = headers.get("Content-Type") || "";
		if (contentType.includes("application/json")) {
			const originalBody = await request.json();
			const enrichedBody = enrichBody(originalBody, user);
			body = JSON.stringify(enrichedBody);
			headers.set("Content-Type", "application/json");
		} else if (contentType.includes("multipart/form-data")) {
			body = request.body;
		} else {
			body = await request.text();
		}
	}

	const upstream = new Request(upstreamUrl, {
		method: request.method,
		headers,
		body,
	});

	const response = await fetch(upstream);
	if (request.method === "GET" && url.pathname === "/sessions" && response.ok) {
		const cloned = response.clone();
		await cloned.json().then((body) => recordUserSessions(env, user, body)).catch(() => undefined);
	}

	// Pass through CORS
	const responseHeaders = new Headers(response.headers);
	for (const [key, value] of Object.entries(defaultCorsHeaders)) {
		responseHeaders.set(key, value);
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: responseHeaders,
	});
}

function enrichBody(body: unknown, user: {
	sub: string;
	scmUserId: string;
	scmLogin: string;
	scmName: string;
	scmEmail: string;
	scmToken: string;
}): unknown {
	if (body && typeof body === "object") {
		return {
			...body,
			userId: user.sub,
			scmUserId: user.scmUserId,
			scmLogin: user.scmLogin,
			scmName: user.scmName,
			scmEmail: user.scmEmail,
			scmToken: user.scmToken,
		};
	}
	return body;
}
