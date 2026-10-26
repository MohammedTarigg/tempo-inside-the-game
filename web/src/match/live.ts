// A live screen. Opened with ?live=<the live service's address>, the match page takes its cues from the live service
// rather than from the run's files: first every cue issued so far (/cues), then each new one as it is issued, pushed
// through Azure Web PubSub. The picture is the run's own positions, and each screen releases a cue only when its picture
// reaches the frame the cue was issued on, so a screen behind the live picture never shows anything early.
import type { Cue } from '../types/run.ts';

export interface LiveFeed {
  add(c: Cue): void;
  withdraw(id: string): void;
}

// what the live service sends for a cue taken back
interface Withdrawn {
  id: string;
  status: 'withdrawn';
}

const isWithdrawn = (m: Cue | Withdrawn): m is Withdrawn => m.status === 'withdrawn' && !('form' in m);

// The cues issued so far, to build the page from.
export async function cuesSoFar(service: string): Promise<Cue[]> {
  const r = await fetch(new URL('cues', service.endsWith('/') ? service : `${service}/`), { cache: 'no-store' });
  if (!r.ok) throw new Error(`The live service answered ${r.status}`);
  return (await r.json()) as Cue[];
}

// Every cue from now on. The socket opens before the cues so far are fetched, and holds what arrives until the page is
// built and attaches to it, so nothing issued in between is lost; a cue that comes both ways is taken once. The socket's
// address comes from the service's /negotiate, a token that joins this match's group and can only listen; it is asked
// for again on every reconnect, so an expired token is never reused. A dropped connection is retried with a growing
// pause, up to half a minute.
export function subscribe(service: string) {
  let socket: WebSocket | null = null,
    feed: LiveFeed | null = null,
    pause = 1000,
    stopped = false;
  const held: (Cue | Withdrawn)[] = [];
  const deliver = (m: Cue | Withdrawn) => {
    if (!feed) held.push(m);
    else if (isWithdrawn(m)) feed.withdraw(m.id);
    else feed.add(m);
  };
  const open = async () => {
    try {
      const r = await fetch(new URL('negotiate', service.endsWith('/') ? service : `${service}/`), {
        cache: 'no-store',
      });
      const { url } = (await r.json()) as { url: string };
      socket = new WebSocket(url);
      socket.onopen = () => (pause = 1000);
      socket.onmessage = (e: MessageEvent<string>) => deliver(JSON.parse(e.data) as Cue | Withdrawn);
      socket.onclose = () => retry();
    } catch {
      retry();
    }
  };
  const retry = () => {
    if (stopped) return;
    setTimeout(open, pause);
    pause = Math.min(30_000, pause * 2);
  };
  void open();
  return {
    attach(to: LiveFeed) {
      feed = to;
      held.splice(0).forEach(deliver);
    },
    stop() {
      stopped = true;
      socket?.close();
    },
  };
}
