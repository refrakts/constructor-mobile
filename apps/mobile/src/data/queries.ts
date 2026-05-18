/** The only data entry points screens use. Lists go through TanStack Query;
 *  the live stream uses the ported pure transforms over the gateway. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { CreateSessionRequest, SandboxEvent, SessionState } from '@constructor/protocol';
import { collapseTokenEvents, costDelta, foldEvent, type PendingToken } from '@/features/sessions/stream/transforms';

import { useGateway, useGatewayScope } from './provider';

export { useGateway } from './provider';

export function useSessions() {
  const gw = useGateway();
  const scope = useGatewayScope();
  return useQuery({
    queryKey: ['sessions', scope],
    queryFn: async () => {
      const result = await gw.listSessions();
      return result.sessions;
    },
  });
}

export function useSession(id: string) {
  const gw = useGateway();
  const scope = useGatewayScope();
  return useQuery({ queryKey: ['session', scope, id], queryFn: () => gw.getSession(id), enabled: !!id });
}

export function useCreateSession() {
  const gw = useGateway();
  const scope = useGatewayScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateSessionRequest) => gw.createSession(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions', scope] }),
  });
}

export type StreamStatus = 'connecting' | 'live' | 'closed';

export interface SessionStream {
  status: StreamStatus;
  state: SessionState | null;
  events: SandboxEvent[];
  cost: number;
  /** Reason for the most recent close, if any. */
  closeReason: string | null;
  /** Force a fresh subscribe attempt; safe to call from a UI button. */
  reconnect: () => void;
}

export function useSessionStream(id: string): SessionStream {
  const gw = useGateway();
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [state, setState] = useState<SessionState | null>(null);
  const [events, setEvents] = useState<SandboxEvent[]>([]);
  const [cost, setCost] = useState(0);
  const [closeReason, setCloseReason] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<PendingToken | null>(null);

  useEffect(() => {
    if (!id) return;
    pending.current = null;
    setStatus('connecting');
    setState(null);
    setEvents([]);
    setCost(0);
    setCloseReason(null);
    const handle = gw.subscribe(id, {
      snapshot: (snap) => {
        setState(snap.state);
        setEvents(collapseTokenEvents(snap.replay.events, pending));
        setStatus('live');
        setCloseReason(null);
      },
      event: (e) => {
        setEvents((prev) => foldEvent(prev, e, pending));
        const d = costDelta(e);
        if (d) setCost((c) => c + d);
      },
      closed: (reason) => {
        setStatus('closed');
        if (reason) setCloseReason(reason);
      },
    });
    return () => handle.unsubscribe();
  }, [gw, id, attempt]);

  const reconnect = useCallback(() => setAttempt((n) => n + 1), []);

  return { status, state, events, cost, closeReason, reconnect };
}
