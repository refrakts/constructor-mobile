/**
 * Real HTTP/WS SessionGateway. Talks to the gateway worker (not directly to
 * the control plane). Auth token is read from secure store on every request
 * so the gateway instance is stateless and survives token rotation.
 *
 * Error handling: every non-2xx response is parsed into a `GatewayError`
 * carrying status / code / requestId so screens can branch on kind and
 * LogRocket gets correlated request ids.
 *
 * Subscribe semantics: open WS immediately AND start a REST snapshot fetch
 * in parallel. Whichever delivers a usable snapshot first paints the UI; the
 * other is discarded. This avoids the dead-screen failure mode where WS
 * setup is slow or broken and the user sees "connecting..." forever.
 */
import * as SecureStore from 'expo-secure-store';
import type {
	CreateSessionRequest,
	SandboxEvent,
	Session,
	SessionState,
} from '@constructor/protocol';

import { authTokenKey } from '../auth';
import type {
	ListSessionsResult,
	SessionGateway,
	StreamHandle,
	StreamListeners,
	SubscribeSnapshot,
} from '../gateway';
import {
	GatewayError,
	gatewayErrorFromNetwork,
	gatewayErrorFromResponse,
} from '../errors';
import { captureException, logEvent, trackEvent } from '@/observability/logrocket';

const SNAPSHOT_RACE_DELAY_MS = 1200;

async function getToken(key: string): Promise<string | null> {
	try {
		return await SecureStore.getItemAsync(key);
	} catch {
		return null;
	}
}

function buildHeaders(token: string): HeadersInit {
	return {
		Accept: 'application/json',
		'Content-Type': 'application/json',
		Authorization: `Bearer ${token}`,
	};
}

function asObject(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function normalizeList(body: unknown): ListSessionsResult {
	const obj = asObject(body);
	const sessions = Array.isArray(obj?.sessions)
		? obj.sessions
		: Array.isArray(obj?.items)
			? obj.items
			: [];
	return {
		sessions: sessions as Session[],
		total: typeof obj?.total === 'number' ? obj.total : sessions.length,
		hasMore: Boolean(obj?.hasMore),
	};
}

function normalizeSessionState(body: unknown): SessionState {
	const obj = asObject(body);
	const state = asObject(obj?.state) ?? obj;
	const session = asObject(obj?.session);
	const sandbox = asObject(obj?.sandbox);

	return {
		...(session ?? {}),
		...state,
		sandboxStatus:
			typeof state?.sandboxStatus === 'string'
				? state.sandboxStatus
				: typeof sandbox?.status === 'string'
					? sandbox.status
					: 'pending',
		messageCount: typeof state?.messageCount === 'number' ? state.messageCount : 0,
	} as SessionState;
}

function normalizeEvents(body: unknown): SandboxEvent[] {
	const obj = asObject(body);
	if (Array.isArray(obj?.events)) return obj.events as SandboxEvent[];
	if (Array.isArray(obj?.items)) return obj.items as SandboxEvent[];
	return [];
}

async function request<T>(
	method: string,
	url: string,
	init: Omit<RequestInit, 'method'>,
	{ allowEmpty = false, expectJson = true }: { allowEmpty?: boolean; expectJson?: boolean } = {},
): Promise<T> {
	let response: Response;
	try {
		response = await fetch(url, { ...init, method });
	} catch (err) {
		const gerr = gatewayErrorFromNetwork(err, url, method);
		captureException(gerr, { phase: 'fetch' });
		throw gerr;
	}

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		const gerr = gatewayErrorFromResponse(response, text, url, method);
		logEvent('warn', 'gateway.request.failed', {
			method,
			url,
			status: response.status,
			kind: gerr.kind,
			requestId: gerr.requestId,
			upstreamRequestId: gerr.upstreamRequestId,
		});
		throw gerr;
	}

	if (!expectJson) return undefined as unknown as T;

	const text = await response.text();
	if (!text) {
		if (allowEmpty) return undefined as unknown as T;
		return undefined as unknown as T;
	}
	try {
		return JSON.parse(text) as T;
	} catch (err) {
		const gerr = new GatewayError({
			kind: 'unknown',
			status: response.status,
			message: 'Gateway returned malformed JSON',
			url,
			method,
			body: text,
		});
		captureException(gerr, { phase: 'parse', error: err });
		throw gerr;
	}
}

export class HttpSessionGateway implements SessionGateway {
	constructor(
		private baseUrl: string,
		private tokenKey = authTokenKey(),
		private wsBaseUrl?: string,
	) {}

	async listSessions(): Promise<ListSessionsResult> {
		const token = await getToken(this.tokenKey);
		if (!token) throw unauthenticated('GET /sessions');
		const body = await request<unknown>('GET', `${this.baseUrl}/sessions`, {
			headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
		});
		const result = normalizeList(body);
		trackEvent('sessions.list', { count: result.sessions.length });
		return result;
	}

	async getSession(id: string): Promise<SessionState> {
		const token = await getToken(this.tokenKey);
		if (!token) throw unauthenticated('GET /sessions/:id');
		const body = await request<unknown>('GET', `${this.baseUrl}/sessions/${id}`, {
			headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
		});
		return normalizeSessionState(body);
	}

	async createSession(req: CreateSessionRequest): Promise<{ sessionId: string }> {
		const token = await getToken(this.tokenKey);
		if (!token) throw unauthenticated('POST /sessions');
		const result = await request<{ sessionId: string }>(
			'POST',
			`${this.baseUrl}/sessions`,
			{
				headers: buildHeaders(token),
				body: JSON.stringify(req),
			},
		);
		trackEvent('sessions.create', { sessionId: result.sessionId, repo: `${req.repoOwner}/${req.repoName}` });
		return result;
	}

	subscribe(id: string, on: StreamListeners): StreamHandle {
		// Fail fast if WS isn't configured. Connecting to the gateway as WS
		// silently goes nowhere; better to surface it.
		if (!this.wsBaseUrl) {
			const err = new GatewayError({
				kind: 'unknown',
				status: 0,
				message: 'WebSocket URL is not configured. Open Settings and reselect this profile to discover it.',
				url: this.baseUrl,
				method: 'WS',
			});
			captureException(err, { phase: 'subscribe.missing_ws_url' });
			on.closed?.(err.message);
			return { unsubscribe: () => undefined };
		}

		let ws: WebSocket | null = null;
		let closed = false;
		let delivered = false;
		let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

		const deliverSnapshot = (snap: SubscribeSnapshot, via: 'ws' | 'rest'): void => {
			if (closed || delivered) return;
			delivered = true;
			if (snapshotTimer) {
				clearTimeout(snapshotTimer);
				snapshotTimer = null;
			}
			logEvent('log', 'stream.snapshot', { sessionId: id, via });
			on.snapshot(snap);
		};

		const startRestFallback = async (token: string) => {
			try {
				const snapshot = await this.fetchSnapshot(id, token);
				deliverSnapshot(snapshot, 'rest');
			} catch (err) {
				// Don't bubble — WS may still arrive. Just record it.
				logEvent('warn', 'stream.rest_snapshot_failed', {
					sessionId: id,
					error: err instanceof GatewayError ? err.toJSON() : String(err),
				});
			}
		};

		const connect = async () => {
			const token = await getToken(this.tokenKey);
			if (!token || closed) {
				if (!token) on.closed?.('Not authenticated');
				return;
			}

			// Kick off a delayed REST fallback. If WS subscribes first, this
			// is cancelled. Otherwise it paints the UI while WS continues.
			snapshotTimer = setTimeout(() => {
				if (!delivered) void startRestFallback(token);
			}, SNAPSHOT_RACE_DELAY_MS);

			let wsToken: string;
			try {
				const tokenRes = await request<{ token: string }>(
					'POST',
					`${this.baseUrl}/sessions/${id}/ws-token`,
					{
						headers: buildHeaders(token),
						body: JSON.stringify({}),
					},
				);
				wsToken = tokenRes.token;
			} catch (err) {
				logEvent('warn', 'stream.ws_token_failed', {
					sessionId: id,
					error: err instanceof GatewayError ? err.toJSON() : String(err),
				});
				// Last-ditch REST snapshot so the screen at least shows state.
				void startRestFallback(token);
				on.closed?.(err instanceof GatewayError ? err.userMessage() : 'WebSocket auth failed');
				return;
			}

			const wsUrl = `${this.wsBaseUrl}/sessions/${id}/ws`;
			try {
				ws = new WebSocket(wsUrl);
			} catch (err) {
				captureException(err, { phase: 'ws.construct', wsUrl });
				void startRestFallback(token);
				on.closed?.('Failed to open WebSocket');
				return;
			}

			ws.onopen = () => {
				ws?.send(
					JSON.stringify({
						type: 'subscribe',
						token: wsToken,
						clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
					}),
				);
			};

			ws.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);
					if (data.type === 'subscribed') {
						deliverSnapshot(
							{
								state: data.state,
								artifacts: data.artifacts ?? [],
								replay: data.replay ?? { events: [], hasMore: false, cursor: null },
							},
							'ws',
						);
					} else if (data.type === 'sandbox_event') {
						on.event(data.event as SandboxEvent);
					} else if (data.type === 'error') {
						logEvent('warn', 'stream.ws_error_message', { sessionId: id, code: data.code, message: data.message });
					}
				} catch (err) {
					logEvent('warn', 'stream.ws_parse_failed', { sessionId: id, error: String(err) });
				}
			};

			ws.onclose = (event) => {
				if (closed) return;
				if (snapshotTimer) {
					clearTimeout(snapshotTimer);
					snapshotTimer = null;
				}
				const reason = wsCloseReason(event);
				logEvent('warn', 'stream.ws_closed', { sessionId: id, code: event.code, reason });
				// If we never delivered a snapshot, try REST so the screen
				// shows something usable rather than dying silently.
				if (!delivered) void startRestFallback(token);
				on.closed?.(reason);
			};

			ws.onerror = () => {
				if (closed) return;
				logEvent('warn', 'stream.ws_errored', { sessionId: id });
				if (!delivered) void startRestFallback(token);
			};
		};

		void connect();

		return {
			unsubscribe: () => {
				closed = true;
				if (snapshotTimer) clearTimeout(snapshotTimer);
				ws?.close();
			},
		};
	}

	async sendFollowUp(id: string, content: string): Promise<void> {
		const token = await getToken(this.tokenKey);
		if (!token) throw unauthenticated('POST /sessions/:id/prompt');
		await request<unknown>('POST', `${this.baseUrl}/sessions/${id}/prompt`, {
			headers: buildHeaders(token),
			body: JSON.stringify({ content }),
		});
		trackEvent('sessions.follow_up', { sessionId: id, length: content.length });
	}

	async stop(id: string): Promise<void> {
		const token = await getToken(this.tokenKey);
		if (!token) throw unauthenticated('POST /sessions/:id/stop');
		await request<unknown>('POST', `${this.baseUrl}/sessions/${id}/stop`, {
			headers: buildHeaders(token),
			body: JSON.stringify({}),
		});
		trackEvent('sessions.stop', { sessionId: id });
	}

	private async fetchSnapshot(id: string, token: string): Promise<SubscribeSnapshot> {
		const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };
		const [stateBody, eventsBody] = await Promise.all([
			request<unknown>('GET', `${this.baseUrl}/sessions/${id}`, { headers }),
			request<unknown>('GET', `${this.baseUrl}/sessions/${id}/events`, { headers }).catch(() => null),
		]);

		const stateObj = asObject(stateBody);
		const eventsObj = asObject(eventsBody);

		return {
			state: normalizeSessionState(stateBody),
			artifacts: Array.isArray(stateObj?.artifacts) ? stateObj.artifacts : [],
			replay: {
				events: normalizeEvents(eventsBody),
				hasMore: Boolean(eventsObj?.hasMore),
				cursor:
					eventsObj?.cursor && typeof eventsObj.cursor === 'object'
						? (eventsObj.cursor as { timestamp: number; id: string })
						: null,
			},
		};
	}
}

function unauthenticated(op: string): GatewayError {
	return new GatewayError({
		kind: 'unauthorized',
		status: 401,
		message: `Not authenticated for ${op}`,
		method: op,
	});
}

function wsCloseReason(event: { code?: number; reason?: string }): string {
	if (event.reason) return event.reason;
	switch (event.code) {
		case 1000:
			return 'Closed normally';
		case 1006:
			return 'Connection lost';
		case 4001:
			return 'Session token invalid or expired';
		case 4002:
			return 'Session expired';
		case 4008:
			return 'WebSocket auth timed out';
		default:
			return event.code ? `WebSocket closed (${event.code})` : 'WebSocket closed';
	}
}

/** Public helper: attempt to refresh the app JWT. Returns the new token or null. */
export async function refreshAppJwt(baseUrl: string, tokenKey: string): Promise<string | null> {
	const token = await getToken(tokenKey);
	if (!token) return null;
	try {
		const res = await fetch(`${baseUrl}/auth/refresh`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
		});
		if (!res.ok) return null;
		const body = (await res.json()) as { token?: string };
		if (!body.token) return null;
		await SecureStore.setItemAsync(tokenKey, body.token);
		return body.token;
	} catch {
		return null;
	}
}
