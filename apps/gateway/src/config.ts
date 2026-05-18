import type { GatewayEnv } from "./types";
import { json } from "./index";

export function handleConfig(_request: Request, env: GatewayEnv): Response {
	return json({
		controlPlaneUrl: env.CONTROL_PLANE_URL,
		wsUrl: env.WS_URL,
		githubOAuthClientId: env.GITHUB_OAUTH_CLIENT_ID,
	});
}
