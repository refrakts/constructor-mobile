import type { GatewayEnv } from "./types";
import { corsHeaders as defaultCorsHeaders, errorResponse, json } from "./index";
import { verifyAppJwt, type AuthenticatedUser } from "./auth";
import { generateInternalToken } from "./internal-auth";
import { recordUserSessions } from "./push";
import { buildTraceContext, createLogger, errToFields, type Logger } from "./logger";
import type { Session } from "@constructor/protocol";

/**
 * Identity-injection allowlist. Background-agents accepts these fields as the
 * authenticated user when present; we MUST set them on these paths and MUST
 * NOT silently mutate the payload on others (a few control-plane handlers
 * reject unknown keys, and we want predictability for everything else).
 */
const ENRICH_RULES: { method: string; matches: (path: string) => boolean }[] = [
	{ method: "POST", matches: (p) => p === "/sessions" },
	{ method: "POST", matches: (p) => /^\/sessions\/[^/]+\/ws-token$/.test(p) },
	{ method: "POST", matches: (p) => /^\/sessions\/[^/]+\/prompt$/.test(p) },
];

function shouldEnrich(method: string, path: string): boolean {
	return ENRICH_RULES.some((rule) => rule.method === method && rule.matches(path));
}

export async function handleProxy(
	request: Request,
	env: GatewayEnv,
	ctx: ExecutionContext,
): Promise<Response> {
	const log = createLogger(buildTraceContext(request));
	const t0 = Date.now();

	const authHeader = request.headers.get("Authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		log.warn("proxy.unauthorized", { reason: "missing_bearer" });
		return errorResponse("Unauthorized", 401);
	}

	const appToken = authHeader.slice(7);
	const user = await verifyAppJwt(env, appToken);
	if (!user) {
		log.warn("proxy.unauthorized", { reason: "invalid_token" });
		return errorResponse("Invalid or expired token", 401);
	}

	const userLog = log.child({ userId: user.sub });

	const url = new URL(request.url);
	const upstreamPath = url.pathname + url.search;
	const upstreamUrl = `${env.CONTROL_PLANE_URL.replace(/\/$/, "")}${upstreamPath}`;

	// Copy headers; strip request-specific + CF junk; swap user JWT for HMAC.
	const headers = new Headers(request.headers);
	headers.delete("Authorization");
	stripRequestSpecificHeaders(headers);

	const internalToken = await generateInternalToken(env.INTERNAL_CALLBACK_SECRET);
	headers.set("Authorization", `Bearer ${internalToken}`);
	// Carry trace ids through to background-agents so logs there can be
	// correlated to ours (it ignores them today, that's fine).
	headers.set("x-trace-id", log.context().traceId);
	headers.set("x-request-id", log.context().requestId);
	headers.set("x-forwarded-user", user.sub);

	// Build upstream request body.
	let body: BodyInit | null = null;
	if (["POST", "PUT", "PATCH"].includes(request.method)) {
		const contentType = headers.get("Content-Type") || "";
		if (contentType.includes("application/json")) {
			const text = await request.text();
			const original = text ? safeParseJson(text) : {};
			const enrich = shouldEnrich(request.method, url.pathname);
			const enriched = enrich ? enrichBody(original, user) : original;
			body = JSON.stringify(enriched ?? {});
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

	userLog.info("proxy.upstream.request", {
		upstreamUrl,
		upstreamMethod: request.method,
		enriched: shouldEnrich(request.method, url.pathname),
	});

	let response: Response;
	try {
		response = await userLog.startSpan("upstream.fetch", () => fetch(upstream));
	} catch (err) {
		userLog.error("proxy.upstream.fetch_failed", { error: errToFields(err) });
		return json(
			{
				error: "Failed to reach control plane",
				code: "upstream_unreachable",
				requestId: log.context().requestId,
			},
			502,
		);
	}

	const upstreamRequestId =
		response.headers.get("x-request-id") ?? response.headers.get("cf-ray");

	if (!response.ok) {
		// Read the body once for both logging and (when appropriate) for
		// rewriting into a structured error envelope. Use clone for the body
		// pass-through so streaming still works for successful responses.
		const bodyText = await response.clone().text().catch(() => "");
		const failureKind = classifyUpstreamFailure(response, bodyText);
		userLog.warn("proxy.upstream.error", {
			status: response.status,
			kind: failureKind.kind,
			upstreamRequestId,
			bodyPreview: bodyText.slice(0, 500),
		});
		if (failureKind.kind !== "passthrough") {
			return json(
				{
					error: failureKind.message,
					code: failureKind.kind,
					upstreamStatus: response.status,
					requestId: log.context().requestId,
					upstreamRequestId,
				},
				failureKind.status,
			);
		}
		// passthrough: still preserve CORS + add upstream-request-id header
		return passthrough(response, log.context().requestId, upstreamRequestId);
	}

	// `GET /sessions` requires server-side per-user filtering. Background-agents
	// does NOT filter by user, so we must do it here.
	if (request.method === "GET" && url.pathname === "/sessions") {
		const filtered = await filterSessionsForUser(response, user, userLog);
		// fire-and-forget: persist the user's session list for push polling.
		ctx.waitUntil(
			recordUserSessions(env, user, filtered).catch((err) =>
				userLog.warn("proxy.recordUserSessions.failed", { error: errToFields(err) }),
			),
		);
		userLog.info("proxy.complete", {
			status: 200,
			durationMs: Date.now() - t0,
			sessionsReturned: filtered.sessions.length,
		});
		return json(filtered, 200);
	}

	const finalResponse = passthrough(response, log.context().requestId, upstreamRequestId);
	userLog.info("proxy.complete", {
		status: response.status,
		durationMs: Date.now() - t0,
	});
	return finalResponse;
}

function passthrough(
	response: Response,
	gatewayRequestId: string,
	upstreamRequestId: string | null,
): Response {
	const headers = new Headers(response.headers);
	for (const [k, v] of Object.entries(defaultCorsHeaders)) headers.set(k, v);
	headers.set("x-gateway-request-id", gatewayRequestId);
	if (upstreamRequestId) headers.set("x-upstream-request-id", upstreamRequestId);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function safeParseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return {};
	}
}

function stripRequestSpecificHeaders(headers: Headers): void {
	for (const header of [
		"Host",
		"Connection",
		"Content-Length",
		"CF-Connecting-IP",
		"CF-IPCountry",
		"CF-Ray",
		"CF-Visitor",
		"X-Forwarded-Proto",
		"X-Forwarded-For",
		"X-Real-IP",
	]) {
		headers.delete(header);
	}
}

type UpstreamFailure =
	| { kind: "passthrough" }
	| { kind: "control_plane_unavailable"; status: 502; message: string }
	| { kind: "control_plane_5xx"; status: 502; message: string }
	| { kind: "control_plane_unreachable"; status: 503; message: string };

function classifyUpstreamFailure(response: Response, bodyText: string): UpstreamFailure {
	const ct = response.headers.get("Content-Type") || "";

	// Cloudflare-level "no Workers script": background-agents is mis-deployed.
	if (response.status === 404 && ct.includes("application/json")) {
		const body = safeParseJson(bodyText) as
			| { cloudflare_error?: boolean; error_code?: number; detail?: string }
			| null;
		if (body?.cloudflare_error && body.error_code === 1042) {
			return {
				kind: "control_plane_unavailable",
				status: 502,
				message: body.detail || "Control plane worker is unavailable.",
			};
		}
	}

	// Anything 5xx from the control plane gets a structured envelope so the
	// app can distinguish gateway/control-plane outages from real 4xx errors.
	if (response.status >= 500) {
		return {
			kind: "control_plane_5xx",
			status: 502,
			message: "Control plane returned an internal error.",
		};
	}

	// 1xxx Cloudflare HTML error pages on the upstream Worker.
	if (
		response.status === 530 ||
		(response.status === 403 && bodyText.startsWith("error code:"))
	) {
		return {
			kind: "control_plane_unreachable",
			status: 503,
			message: "Control plane is unreachable.",
		};
	}

	return { kind: "passthrough" };
}

interface SessionListBody {
	sessions: Session[];
	total?: number;
	hasMore?: boolean;
	cursor?: string;
}

/**
 * Background-agents `GET /sessions` returns ALL sessions known to the control
 * plane — there is no per-user filter at the DO boundary (see
 * docs/handoff/02-control-plane.md). Until that changes, we filter in the
 * gateway by matching the userId we just injected on creation.
 *
 * Trade-off: this only works for sessions created via this gateway (which
 * sets `userId` to the gateway user.sub). For pre-existing/web-created
 * sessions we cannot attribute ownership — those are dropped from the list
 * to avoid leaking other users' sessions to mobile.
 */
async function filterSessionsForUser(
	response: Response,
	user: AuthenticatedUser,
	log: Logger,
): Promise<SessionListBody> {
	let body: SessionListBody;
	try {
		body = (await response.json()) as SessionListBody;
	} catch (err) {
		log.warn("proxy.sessions.parse_failed", { error: errToFields(err) });
		return { sessions: [], total: 0, hasMore: false };
	}

	const all = Array.isArray(body.sessions) ? body.sessions : [];
	const mine = all.filter((s) => {
		// `Session.userId` may not be in the vendored protocol type; cast for
		// the runtime check. Background-agents stores ownership but does not
		// always surface it; if it's missing we conservatively drop.
		const owner = (s as unknown as { userId?: string; ownerUserId?: string }).userId
			?? (s as unknown as { ownerUserId?: string }).ownerUserId;
		return owner === user.sub;
	});

	log.info("proxy.sessions.filtered", {
		upstreamCount: all.length,
		ownedCount: mine.length,
	});

	return {
		sessions: mine,
		total: mine.length,
		hasMore: false,
	};
}

function enrichBody(body: unknown, user: AuthenticatedUser): unknown {
	if (body && typeof body === "object" && !Array.isArray(body)) {
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
