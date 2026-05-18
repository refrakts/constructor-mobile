import type { SandboxEvent, Session } from "@constructor/protocol";
import type { JwtPayload } from "./auth";
import { verifyAppJwt } from "./auth";
import { errorResponse, json } from "./index";
import { internalAuthHeaders } from "./internal-auth";
import type { GatewayEnv } from "./types";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_DEVICES_PER_USER = 5;
const MAX_TRACKED_SESSIONS_PER_USER = 25;
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "archived"]);
const NOTIFY_EVENT_TYPES = new Set(["execution_complete", "error", "artifact", "push_complete", "push_error"]);

type Device = { expoToken: string; addedAt: number };
type TrackedSession = {
	id: string;
	title: string | null;
	repoOwner: string;
	repoName: string;
	cursor: { timestamp: number; id: string } | null;
	notified: Record<string, true>;
};
type UserRegistry = { user: Pick<JwtPayload, "sub" | "scmLogin" | "scmName" | "scmEmail">; devices: Device[]; sessions: Record<string, TrackedSession> };

function userKey(userId: string): string {
	return `user:${userId}`;
}

async function loadRegistry(env: GatewayEnv, user: JwtPayload): Promise<UserRegistry> {
	const raw = await env.GATEWAY_KV.get(userKey(user.sub));
	if (raw) return JSON.parse(raw) as UserRegistry;
	return {
		user: { sub: user.sub, scmLogin: user.scmLogin, scmName: user.scmName, scmEmail: user.scmEmail },
		devices: [],
		sessions: {},
	};
}

async function saveRegistry(env: GatewayEnv, registry: UserRegistry): Promise<void> {
	await env.GATEWAY_KV.put(userKey(registry.user.sub), JSON.stringify(registry));
}

export async function handlePushRegister(request: Request, env: GatewayEnv): Promise<Response> {
	const authHeader = request.headers.get("Authorization");
	if (!authHeader?.startsWith("Bearer ")) return errorResponse("Unauthorized", 401);
	const user = await verifyAppJwt(env, authHeader.slice(7));
	if (!user) return errorResponse("Invalid or expired token", 401);

	const body = (await request.json().catch(() => null)) as { expoToken?: string } | null;
	if (!body?.expoToken?.startsWith("ExponentPushToken[") && !body?.expoToken?.startsWith("ExpoPushToken[")) {
		return errorResponse("expoToken is required", 400);
	}

	const registry = await loadRegistry(env, user);
	registry.user = { sub: user.sub, scmLogin: user.scmLogin, scmName: user.scmName, scmEmail: user.scmEmail };
	registry.devices = [
		{ expoToken: body.expoToken, addedAt: Date.now() },
		...registry.devices.filter((d) => d.expoToken !== body.expoToken),
	].slice(0, MAX_DEVICES_PER_USER);
	await saveRegistry(env, registry);
	return json({ ok: true });
}

export async function recordUserSessions(env: GatewayEnv, user: JwtPayload, body: unknown): Promise<void> {
	const sessions = Array.isArray((body as { sessions?: unknown }).sessions) ? (body as { sessions: Session[] }).sessions : [];
	if (sessions.length === 0) return;
	const registry = await loadRegistry(env, user);
	for (const session of sessions.slice(0, MAX_TRACKED_SESSIONS_PER_USER)) {
		if (TERMINAL_STATUSES.has(session.status)) continue;
		const existing = registry.sessions[session.id];
		registry.sessions[session.id] = {
			id: session.id,
			title: session.title,
			repoOwner: session.repoOwner,
			repoName: session.repoName,
			cursor: existing?.cursor ?? null,
			notified: existing?.notified ?? {},
		};
	}
	await saveRegistry(env, registry);
}

export async function pollAndSendPushNotifications(env: GatewayEnv): Promise<void> {
	let cursor: string | undefined;
	do {
		const page = await env.GATEWAY_KV.list({ prefix: "user:", cursor, limit: 100 });
		await Promise.all(page.keys.map(async (key) => {
			const raw = await env.GATEWAY_KV.get(key.name);
			if (!raw) return;
			await pollUser(env, JSON.parse(raw) as UserRegistry);
		}));
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);
}

async function pollUser(env: GatewayEnv, registry: UserRegistry): Promise<void> {
	if (registry.devices.length === 0) return;
	let changed = false;
	for (const session of Object.values(registry.sessions)) {
		const result = await fetchSessionEvents(env, session);
		if (!result) continue;
		for (const event of result.events) {
			if (!NOTIFY_EVENT_TYPES.has(event.type)) continue;
			const key = notificationKey(session.id, event);
			if (session.notified[key]) continue;
			const sent = await sendExpoPush(env, registry.devices, summarizeEvent(session, event));
			if (!sent) return;
			session.notified[key] = true;
			changed = true;
		}
		if (result.cursor) {
			session.cursor = result.cursor;
			changed = true;
		}
	}
	if (changed) await env.GATEWAY_KV.put(userKey(registry.user.sub), JSON.stringify(registry));
}

async function fetchSessionEvents(env: GatewayEnv, session: TrackedSession): Promise<{ events: SandboxEvent[]; cursor: { timestamp: number; id: string } | null } | null> {
	const url = new URL(`${env.CONTROL_PLANE_URL.replace(/\/$/, "")}/sessions/${session.id}/events`);
	url.searchParams.set("limit", "50");
	if (session.cursor) url.searchParams.set("cursor", JSON.stringify(session.cursor));
	const response = await fetch(url, { headers: await internalAuthHeaders(env.INTERNAL_CALLBACK_SECRET) });
	if (!response.ok) return null;
	const body = (await response.json()) as { events?: SandboxEvent[]; items?: SandboxEvent[]; cursor?: { timestamp: number; id: string } | null };
	return { events: body.events ?? body.items ?? [], cursor: body.cursor ?? null };
}

function notificationKey(sessionId: string, event: SandboxEvent): string {
	const id = "messageId" in event ? event.messageId : "artifactId" in event ? event.artifactId : "branchName" in event ? event.branchName : event.timestamp;
	return `${sessionId}:${event.type}:${id}:${event.timestamp}`;
}

function summarizeEvent(session: TrackedSession, event: SandboxEvent): { title: string; body: string; data: Record<string, string> } {
	const name = session.title || `${session.repoOwner}/${session.repoName}`;
	if (event.type === "execution_complete") {
		return { title: event.success ? "Session completed" : "Session failed", body: name, data: { sessionId: session.id, url: `/s/${session.id}` } };
	}
	if (event.type === "artifact") {
		return { title: "New session artifact", body: `${event.artifactType} created for ${name}`, data: { sessionId: session.id, url: `/s/${session.id}` } };
	}
	if (event.type === "push_complete") {
		return { title: "Branch pushed", body: event.branchName, data: { sessionId: session.id, url: `/s/${session.id}` } };
	}
	return { title: "Session needs attention", body: name, data: { sessionId: session.id, url: `/s/${session.id}` } };
}

async function sendExpoPush(env: GatewayEnv, devices: Device[], message: { title: string; body: string; data: Record<string, string> }): Promise<boolean> {
	const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
	if (env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
	const response = await fetch(EXPO_PUSH_URL, {
		method: "POST",
		headers,
		body: JSON.stringify(devices.map((device) => ({ to: device.expoToken, ...message, sound: "default", channelId: "session-updates" }))),
	});
	return response.ok;
}
