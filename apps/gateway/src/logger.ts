/**
 * Structured logger + trace context for the gateway worker.
 *
 * Why: Cloudflare Workers logs are JSON-shaped (Logpush, Workers Logs). Plain
 * `console.log("foo", obj)` produces stringly-typed events that are painful to
 * grep across. A single helper that always emits a structured object with a
 * stable shape (level, msg, traceId, spanId, durationMs, ...) makes triage
 * realistic and lets us correlate gateway logs to upstream `x-request-id`s.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface TraceContext {
	traceId: string;
	spanId: string;
	requestId: string;
	method: string;
	path: string;
	userId?: string;
}

export interface LogFields {
	[key: string]: unknown;
}

function emit(level: LogLevel, ctx: TraceContext | null, msg: string, fields?: LogFields): void {
	const payload = {
		level,
		msg,
		ts: new Date().toISOString(),
		traceId: ctx?.traceId,
		spanId: ctx?.spanId,
		requestId: ctx?.requestId,
		method: ctx?.method,
		path: ctx?.path,
		userId: ctx?.userId,
		...fields,
	};
	const line = JSON.stringify(payload);
	if (level === "error") console.error(line);
	else if (level === "warn") console.warn(line);
	else console.log(line);
}

export interface Logger {
	debug(msg: string, fields?: LogFields): void;
	info(msg: string, fields?: LogFields): void;
	warn(msg: string, fields?: LogFields): void;
	error(msg: string, fields?: LogFields): void;
	child(extra: Partial<TraceContext>): Logger;
	context(): TraceContext;
	startSpan<T>(name: string, fn: (span: Logger) => Promise<T>): Promise<T>;
}

export function createLogger(ctx: TraceContext): Logger {
	return {
		debug: (msg, fields) => emit("debug", ctx, msg, fields),
		info: (msg, fields) => emit("info", ctx, msg, fields),
		warn: (msg, fields) => emit("warn", ctx, msg, fields),
		error: (msg, fields) => emit("error", ctx, msg, fields),
		child: (extra) => createLogger({ ...ctx, ...extra, spanId: extra.spanId ?? ctx.spanId }),
		context: () => ctx,
		async startSpan<T>(name: string, fn: (span: Logger) => Promise<T>): Promise<T> {
			const spanId = newSpanId();
			const span = createLogger({ ...ctx, spanId });
			const t0 = Date.now();
			span.info("span.start", { span: name });
			try {
				const result = await fn(span);
				span.info("span.end", { span: name, durationMs: Date.now() - t0, ok: true });
				return result;
			} catch (err) {
				span.error("span.end", {
					span: name,
					durationMs: Date.now() - t0,
					ok: false,
					error: errToFields(err),
				});
				throw err;
			}
		},
	};
}

export function buildTraceContext(request: Request): TraceContext {
	const url = new URL(request.url);
	// Prefer Cloudflare's ray id as the request id; fall back to a uuid so we
	// always have something to grep on.
	const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
	const traceId =
		request.headers.get("x-trace-id") ??
		request.headers.get("traceparent")?.split("-")[1] ??
		crypto.randomUUID();
	return {
		traceId,
		spanId: newSpanId(),
		requestId,
		method: request.method,
		path: url.pathname,
	};
}

export function newSpanId(): string {
	// 16-hex span id, plenty for correlation inside a single trace.
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function errToFields(err: unknown): Record<string, unknown> {
	if (err instanceof Error) {
		return { name: err.name, message: err.message, stack: err.stack };
	}
	return { value: String(err) };
}
