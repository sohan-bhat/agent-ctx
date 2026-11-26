import type { Live } from './types';

const STEPS = [1000, 2000, 4000, 8000, 15000];

function parse(raw: unknown): Live | null {
  if (typeof raw !== 'string') return null;
  try {
    const m = JSON.parse(raw) as Live;
    if (m && (m.type === 'item' || m.type === 'remove' || m.type === 'agent' || m.type === 'reset')) return m;
  } catch {}
  return null;
}

export function socket(on: (m: Live) => void, state: (open: boolean) => void): () => void {
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let tries = 0;
  let stopped = false;
  let dropped = false;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`;
  const open = () => {
    if (stopped) return;
    ws = new WebSocket(url);
    ws.onopen = () => {
      tries = 0;
      state(true);
      if (dropped) on({ type: 'reset' });
      dropped = false;
    };
    ws.onmessage = (e) => {
      const m = parse(e.data);
      if (m) on(m);
    };
    ws.onclose = () => {
      ws = null;
      if (stopped) return;
      dropped = true;
      state(false);
      timer = setTimeout(open, STEPS[Math.min(tries++, STEPS.length - 1)]);
    };
  };
  const wake = () => {
    if (document.visibilityState === 'visible' && !ws && timer) {
      clearTimeout(timer);
      timer = null;
      open();
    }
  };
  document.addEventListener('visibilitychange', wake);
  open();
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', wake);
    if (timer) clearTimeout(timer);
    ws?.close();
  };
}
