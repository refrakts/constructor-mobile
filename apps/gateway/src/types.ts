export interface GatewayEnv {
	CONTROL_PLANE_URL: string;
	WS_URL: string;
	GITHUB_OAUTH_CLIENT_ID: string;
	GITHUB_OAUTH_CLIENT_SECRET: string;
	INTERNAL_CALLBACK_SECRET: string;
	APP_JWT_SIGNING_KEY: string;
	EXPO_ACCESS_TOKEN?: string;
	GATEWAY_KV: KVNamespace;
}
