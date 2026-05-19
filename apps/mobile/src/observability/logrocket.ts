/**
 * LogRocket integration for the mobile app.
 *
 * Why this shape: `@logrocket/react-native` ships native modules and requires
 * a development client (cannot run in Expo Go). To keep `expo start` usable
 * for local UI work we lazy-load the SDK and silently no-op when it isn't
 * present. The app id is fixed per docs (r4xp5n/constructor).
 *
 * Docs: https://docs.logrocket.com/reference/react-native
 */

const APP_ID = 'r4xp5n/constructor';

type LogRocketAPI = {
	init: (appId: string) => void;
	identify: (id: string, traits?: Record<string, string | number | boolean>) => void;
	captureMessage: (msg: string) => void;
	captureException: (err: unknown) => void;
	log: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
	track: (event: string, properties?: Record<string, unknown>) => void;
	getSessionURL: (cb: (url: string) => void) => void;
};

let sdk: LogRocketAPI | null = null;
let initialized = false;
let sessionUrl: string | null = null;

function loadSdk(): LogRocketAPI | null {
	if (sdk !== null) return sdk;
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const mod = require('@logrocket/react-native');
		sdk = (mod?.default ?? mod) as LogRocketAPI;
		return sdk;
	} catch {
		return null;
	}
}

/** Idempotent init. Call once at app startup, before screens mount. */
export function initLogRocket(): void {
	if (initialized) return;
	initialized = true;
	const lr = loadSdk();
	if (!lr) {
		 
		console.info(
			'[logrocket] @logrocket/react-native not installed; events will only go to console. ' +
				'Install with `pnpm add @logrocket/react-native` and rebuild with a dev client.',
		);
		return;
	}
	try {
		lr.init(APP_ID);
		lr.getSessionURL?.((url) => {
			sessionUrl = url;
			 
			console.info('[logrocket] session', url);
		});
	} catch (err) {
		 
		console.warn('[logrocket] init failed', err);
	}
}

export function identifyUser(
	id: string,
	traits?: Record<string, string | number | boolean | null | undefined>,
): void {
	const lr = loadSdk();
	const safe: Record<string, string | number | boolean> = {};
	if (traits) {
		for (const [k, v] of Object.entries(traits)) {
			if (v === null || v === undefined) continue;
			safe[k] = v;
		}
	}
	try {
		lr?.identify?.(id, safe);
	} catch {
		// ignore
	}
}

export function trackEvent(name: string, properties?: Record<string, unknown>): void {
	const lr = loadSdk();
	try {
		lr?.track?.(name, properties);
	} catch {
		// ignore
	}
	if (__DEV__) {
		 
		console.log('[track]', name, properties ?? {});
	}
}

export function logEvent(level: 'log' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>): void {
	const lr = loadSdk();
	try {
		if (level === 'error') lr?.error?.(msg, fields);
		else if (level === 'warn') lr?.warn?.(msg, fields);
		else lr?.log?.(msg, fields);
	} catch {
		// ignore
	}
	const payload = fields ? { msg, ...fields } : msg;
	 
	(level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(
		'[mobile]',
		payload,
	);
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
	const lr = loadSdk();
	try {
		if (context) lr?.log?.('error.context', context);
		lr?.captureException?.(err);
	} catch {
		// ignore
	}
	 
	console.error('[exception]', err, context);
}

export function getSessionUrl(): string | null {
	return sessionUrl;
}
