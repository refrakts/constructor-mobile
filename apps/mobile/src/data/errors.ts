/**
 * Structured error type for everything that crosses the network seam.
 *
 * The gateway returns rich JSON envelopes — `{ error, code, upstreamStatus,
 * requestId, upstreamRequestId }`. We surface those fields here so screens
 * can branch on `kind` instead of grepping the message string, and so logs
 * (LogRocket + console) get correlation ids automatically.
 */

export type GatewayErrorKind =
	| 'network'
	| 'unauthorized'
	| 'forbidden'
	| 'not_found'
	| 'control_plane_unavailable'
	| 'control_plane_5xx'
	| 'upstream_unreachable'
	| 'bad_request'
	| 'unknown';

export interface GatewayErrorInit {
	kind: GatewayErrorKind;
	status: number;
	message: string;
	code?: string;
	requestId?: string | null;
	upstreamStatus?: number;
	upstreamRequestId?: string | null;
	url?: string;
	method?: string;
	body?: unknown;
}

export class GatewayError extends Error {
	readonly kind: GatewayErrorKind;
	readonly status: number;
	readonly code?: string;
	readonly requestId?: string | null;
	readonly upstreamStatus?: number;
	readonly upstreamRequestId?: string | null;
	readonly url?: string;
	readonly method?: string;
	readonly body?: unknown;

	constructor(init: GatewayErrorInit) {
		super(init.message);
		this.name = 'GatewayError';
		this.kind = init.kind;
		this.status = init.status;
		this.code = init.code;
		this.requestId = init.requestId ?? null;
		this.upstreamStatus = init.upstreamStatus;
		this.upstreamRequestId = init.upstreamRequestId ?? null;
		this.url = init.url;
		this.method = init.method;
		this.body = init.body;
	}

	/** Brief, user-safe summary for empty/error UI. */
	userMessage(): string {
		switch (this.kind) {
			case 'unauthorized':
				return 'Your session expired. Please sign in again.';
			case 'forbidden':
				return 'You don’t have access to this resource.';
			case 'not_found':
				return 'Not found.';
			case 'control_plane_unavailable':
				return 'The agent service is currently unavailable.';
			case 'control_plane_5xx':
				return 'The agent service hit an error. Try again shortly.';
			case 'upstream_unreachable':
				return 'Can’t reach the agent service right now.';
			case 'network':
				return 'Network request failed. Check your connection.';
			case 'bad_request':
				return this.message || 'Request was rejected.';
			default:
				return this.message || 'Something went wrong.';
		}
	}

	/** JSON-safe payload for logs/breadcrumbs. */
	toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			kind: this.kind,
			status: this.status,
			code: this.code,
			message: this.message,
			requestId: this.requestId,
			upstreamStatus: this.upstreamStatus,
			upstreamRequestId: this.upstreamRequestId,
			url: this.url,
			method: this.method,
		};
	}
}

function kindForStatus(status: number, code?: string): GatewayErrorKind {
	if (code === 'control_plane_unavailable') return 'control_plane_unavailable';
	if (code === 'control_plane_5xx') return 'control_plane_5xx';
	if (code === 'upstream_unreachable') return 'upstream_unreachable';
	if (status === 401) return 'unauthorized';
	if (status === 403) return 'forbidden';
	if (status === 404) return 'not_found';
	if (status === 0) return 'network';
	if (status >= 500) return 'control_plane_5xx';
	if (status >= 400) return 'bad_request';
	return 'unknown';
}

export function gatewayErrorFromResponse(
	response: Response,
	bodyText: string,
	url: string,
	method: string,
): GatewayError {
	let parsed: Record<string, unknown> | null = null;
	try {
		parsed = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : null;
	} catch {
		parsed = null;
	}
	const code = typeof parsed?.code === 'string' ? parsed.code : undefined;
	const message =
		(typeof parsed?.error === 'string' && parsed.error) ||
		(typeof parsed?.message === 'string' && parsed.message) ||
		bodyText ||
		`${method} ${url} failed: ${response.status}`;
	const requestId =
		(typeof parsed?.requestId === 'string' && parsed.requestId) ||
		response.headers.get('x-gateway-request-id') ||
		response.headers.get('cf-ray') ||
		null;
	const upstreamRequestId =
		(typeof parsed?.upstreamRequestId === 'string' && parsed.upstreamRequestId) ||
		response.headers.get('x-upstream-request-id') ||
		null;
	const upstreamStatus = typeof parsed?.upstreamStatus === 'number' ? parsed.upstreamStatus : undefined;
	return new GatewayError({
		kind: kindForStatus(response.status, code),
		status: response.status,
		code,
		message: String(message),
		requestId,
		upstreamRequestId,
		upstreamStatus,
		url,
		method,
		body: parsed ?? bodyText,
	});
}

export function gatewayErrorFromNetwork(err: unknown, url: string, method: string): GatewayError {
	const message = err instanceof Error ? err.message : String(err);
	return new GatewayError({
		kind: 'network',
		status: 0,
		message,
		url,
		method,
	});
}
