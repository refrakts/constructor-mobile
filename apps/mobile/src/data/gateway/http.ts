/**
 * Real HTTP/WS SessionGateway implementation. Talks to the gateway worker
 * (not directly to the control plane). Auth token is read from secure store
 * on every request so the gateway instance is stateless.
 */
import * as SecureStore from 'expo-secure-store';

import type {
  CreateSessionRequest,
  SandboxEvent,
  Session,
  SessionState,
} from '@constructor/protocol';
import type {
  ListSessionsResult,
  SessionGateway,
  StreamHandle,
  StreamListeners,
  SubscribeSnapshot,
} from '../gateway';

const AUTH_KEY = 'constructor.auth_token';

async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(AUTH_KEY);
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

export class HttpSessionGateway implements SessionGateway {
  constructor(private baseUrl: string) {}

  async listSessions(): Promise<ListSessionsResult> {
    const token = await getToken();
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(`${this.baseUrl}/sessions`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as ListSessionsResult;
  }

  async getSession(id: string): Promise<SessionState> {
    const token = await getToken();
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(`${this.baseUrl}/sessions/${id}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as SessionState;
  }

  async createSession(req: CreateSessionRequest): Promise<{ sessionId: string }> {
    const token = await getToken();
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(`${this.baseUrl}/sessions`, {
      method: 'POST',
      headers: buildHeaders(token),
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as { sessionId: string };
  }

  subscribe(id: string, on: StreamListeners): StreamHandle {
    // WebSocket is opened directly against the control plane's WS URL,
    // but the auth token is fetched via the gateway's /sessions/:id/ws-token proxy.
    // For simplicity, we fetch the ws-token via HTTP first, then connect.
    let ws: WebSocket | null = null;
    let closed = false;

    const connect = async () => {
      const token = await getToken();
      if (!token || closed) return;

      // Fetch WS auth token from gateway
      const tokenRes = await fetch(`${this.baseUrl}/sessions/${id}/ws-token`, {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify({}), // user identity injected by gateway proxy
      });
      if (!tokenRes.ok) {
        on.closed?.('Failed to get WebSocket token');
        return;
      }
      const { token: wsToken } = (await tokenRes.json()) as { token: string };

      // Connect to WS — use wss:// if gateway is https://
      const wsUrl = this.baseUrl.replace(/^http/, 'ws') + `/sessions/${id}/ws`;
      ws = new WebSocket(wsUrl);

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
            const snapshot: SubscribeSnapshot = {
              state: data.state,
              artifacts: data.artifacts ?? [],
              replay: data.replay ?? { events: [], hasMore: false, cursor: null },
            };
            on.snapshot(snapshot);
          } else if (data.type === 'sandbox_event') {
            on.event(data.event as SandboxEvent);
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        if (!closed) on.closed?.('WebSocket closed');
      };

      ws.onerror = () => {
        if (!closed) on.closed?.('WebSocket error');
      };
    };

    connect();

    return {
      unsubscribe: () => {
        closed = true;
        ws?.close();
      },
    };
  }

  async sendFollowUp(id: string, content: string): Promise<void> {
    const token = await getToken();
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(`${this.baseUrl}/sessions/${id}/prompt`, {
      method: 'POST',
      headers: buildHeaders(token),
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async stop(id: string): Promise<void> {
    const token = await getToken();
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(`${this.baseUrl}/sessions/${id}/stop`, {
      method: 'POST',
      headers: buildHeaders(token),
    });
    if (!res.ok) throw new Error(await res.text());
  }
}
