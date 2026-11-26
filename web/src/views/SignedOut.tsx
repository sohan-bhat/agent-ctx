import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DEMO_AGENTS, DEMO_END, DEMO_ITEMS, DEMO_PROJECTS, DEMO_START } from '@/demo';
import { Link } from '@/router';
import { useReduced } from '@/lib/hooks';
import { Space } from './Space';

const PLAY_MS = 30_000;
const RATE = (DEMO_END - DEMO_START) / PLAY_MS;
const AGENTS = DEMO_AGENTS.map((a) => a.label);
const NONE = new Set<string>();

export function SignedOut() {
  const reduced = useReduced();
  const [time, setTime] = useState(reduced ? DEMO_END : DEMO_START);
  const held = useRef(false);
  const open = useRef(false);
  const [tick, setTick] = useState(0);
  const wake = () => setTick((n) => n + 1);
  useEffect(() => {
    if (reduced || time >= DEMO_END) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const step = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      if (!held.current && !open.current) {
        acc += dt;
        if (acc >= 33) {
          const by = acc * RATE;
          acc = 0;
          setTime((t) => Math.min(DEMO_END, t + by));
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [reduced, time >= DEMO_END, tick]);
  const onHold = useCallback((h: boolean) => {
    held.current = h;
    if (!h) wake();
  }, []);
  const onPanel = useCallback((o: boolean) => {
    open.current = o;
    if (!o) wake();
  }, []);
  return (
    <div className="flex h-dvh flex-col px-4 pb-3 pt-5 sm:px-8 md:px-12 md:pt-8">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <h1 translate="no" className="text-[1.75rem] font-bold leading-none tracking-[-0.02em] md:text-[2.25rem]">
            agent-ctx
          </h1>
          <p className="mt-2 text-[0.9375rem] leading-snug md:text-base">Shared memory across agents from different vendors</p>
        </div>
        <Button asChild size="lg" className="h-11 rounded-full px-5 text-[0.9375rem]">
          <a href="/login">Sign in with GitHub</a>
        </Button>
      </header>
      <main className="relative mt-4 min-h-0 flex-1 md:mt-6">
        <Space
          projects={DEMO_PROJECTS}
          agents={AGENTS}
          items={DEMO_ITEMS}
          queue={NONE}
          start={DEMO_START}
          end={DEMO_END}
          time={time}
          clockOnly
          segments={false}
          label="Demo of the shared space, one day of work by three agents"
          onTime={(t) => setTime(t)}
          onHold={onHold}
          onPanel={onPanel}
          aside={<span className="num pointer-events-none absolute right-0 top-0 text-xs">demo</span>}
        />
      </main>
      <footer className="flex gap-5 pt-1 text-xs">
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
      </footer>
    </div>
  );
}
