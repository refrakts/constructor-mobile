/** The only data entry points screens use. Lists go through TanStack Query;
 *  the live stream uses the ported pure transforms over the gateway. */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { CreateSessionRequest, SandboxEvent, SessionState } from '@constructor/protocol';
import { costDelta, foldEvent, type PendingRef } from '@/features/sessions/stream/transforms';

import { useGateway } from './provider';

export { useGateway } from './provider';

export function useSessions() {
  const gw = useGateway();
  return useQuery({ queryKey: ['sessions'], queryFn: () => gw.listSessions() });
}

export function useSession(id: string) {
  const gw = useGateway();
  return useQuery({ queryKey: ['session', id], queryFn: () => gw.getSession(id), enabled: !!id });
}

export function useCreateSession() {
  const gw = useGateway();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateSessionRequest) => gw.createSession(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
}

export type StreamStatus = 'connecting' | 'live' | 'closed';

export interface SessionStream {
  status: StreamStatus;
  state: SessionState | null;
  events: SandboxEvent[];
  cost: number;
}

export function useSessionStream(id: string): SessionStream {
  const gw = useGateway();
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [state, setState] = useState<SessionState | null>(null);
  const [events, setEvents] = useState<SandboxEvent[]>([]);
  const [cost, setCost] = useState(0);
  const pending = useRef<PendingRef['current']>(null) as PendingRef;

  useEffect(() => {
    if (!id) return;
    pending.current = null;
    setStatus('connecting');
    setEvents([]);
    const handle = gw.subscribe(id, {
      snapshot: (snap) => {
        setState(snap.state);
        setEvents(snap.replay.events);
        setStatus('live');
      },
      event: (e) => {
        setEvents((prev) => foldEvent(prev, e, pending));
        const d = costDelta(e);
        if (d) setCost((c) => c + d);
      },
      closed: () => setStatus('closed'),
    });
    return () => handle.unsubscribe();
  }, [gw, id]);

  return { status, state, events, cost };
}
