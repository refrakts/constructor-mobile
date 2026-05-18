import type { GatewayEnv } from "./types";
import { errorResponse, json } from "./index";
import { verifyAppJwt } from "./auth";

const TOKEN_VALIDITY_MS = 5 * 60 * 1000;

async function computeHmacHex(data: string, secret: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	);
	const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
	return Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

async function generateInternalToken(secret: string): Promise<string> {
	const timestamp = Date.now().toString();
	const signatureHex = await computeHmacHex(timestamp, secret);
	return `${timestamp}.${signatureHex}`;
}

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

	// Pass through CORS
	const corsHeaders = new Headers(response.headers);
	corsHeaders.set("Access-Control-Allow-Origin", "*");

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: corsHeaders,
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
