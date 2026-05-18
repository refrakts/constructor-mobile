import { useCallback } from 'react';

import { useProfileStore, type ProfileConfig } from '@/features/profiles/profile-store';

export interface GatewayConfig {
  controlPlaneUrl: string;
  wsUrl: string;
  githubOAuthClientId: string;
}

export function useGatewayConfig() {
  const { activeProfile, setProfileConfig } = useProfileStore();

  const fetchConfig = useCallback(async (): Promise<GatewayConfig | null> => {
    if (!activeProfile) return null;
    const url = activeProfile.gatewayUrl.replace(/\/$/, '');
    const res = await fetch(`${url}/config`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<GatewayConfig>;
    if (!data.wsUrl || !data.githubOAuthClientId) return null;

    const config: ProfileConfig = {
      wsUrl: data.wsUrl,
      githubOAuthClientId: data.githubOAuthClientId,
    };
    setProfileConfig(activeProfile.id, config);
    return {
      controlPlaneUrl: data.controlPlaneUrl ?? url,
      wsUrl: data.wsUrl,
      githubOAuthClientId: data.githubOAuthClientId,
    };
  }, [activeProfile, setProfileConfig]);

  return { fetchConfig };
}
