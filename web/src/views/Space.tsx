import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Item, Project, Read } from '@/lib/api';
import { clock, headline, stamp, useNarrow } from '@/lib/utils';
import { ItemList, Panel, type Actions } from './Panel';

const loadScene = () => import('./scene/Scene');
const Scene = lazy(loadScene);

export function preloadScene(): void {
  void loadScene().catch(() => {});
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Placeholder() {
  const n = 8;
  const top = [50, 18];
  const right = [92, 41.4];
  const left = [8, 41.4];
  const at = (u: number, v: number) => [top[0] + u * (right[0] - top[0]) + v * (left[0] - top[0]), top[1] + u * (right[1] - top[1]) + v * (left[1] - top[1])];
  const lines = [];
  for (let k = 1; k < n; k++) {
    const a = at(k / n, 0);
    const b = at(k / n, 1);
    const c = at(0, k / n);
    const d = at(1, k / n);
    lines.push(<line key={`u${k}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />, <line key={`v${k}`} x1={c[0]} y1={c[1]} x2={d[0]} y2={d[1]} />);
  }
  const bottom = at(1, 1);
  return (
    <svg viewBox="0 0 100 66" preserveAspectRatio="xMidYMid meet" className="absolute inset-0 m-auto size-full max-h-full max-w-full p-6" aria-hidden>
      <polygon points={`${left[0]},${left[1]} ${bottom[0]},${bottom[1]} ${right[0]},${right[1]} ${right[0]},${right[1] + 1.4} ${bottom[0]},${bottom[1] + 1.4} ${left[0]},${left[1] + 1.4}`} fill="var(--table)" style={{ filter: 'brightness(0.92)' }} />
      <polygon points={`${top[0]},${top[1]} ${right[0]},${right[1]} ${bottom[0]},${bottom[1]} ${left[0]},${left[1]}`} fill="var(--table)" />
      <g stroke="var(--foreground)" strokeOpacity="0.12" strokeWidth="0.12">{lines}</g>
    </svg>
  );
}

export interface SpaceProps {
  projects: Project[];
  agents: string[];
  items: Item[];
  reads: Read[];
  queue: Set<string>;
  start: number;
  end: number;
  time: number;
  clockOnly?: boolean;
  actions?: Actions;
  notice?: ReactNode;
  aside?: ReactNode;
  label: string;
  onTime: (t: number) => void;
  onHold?: (holding: boolean) => void;
  onPanel?: (open: boolean) => void;
  prefer?: string | null;
  segments?: boolean;
}

export function Space({ projects, agents, items, reads, queue, start, end, time, clockOnly = false, actions, notice, aside, label, onTime, onHold, onPanel, prefer = null, segments = true }: SpaceProps) {
  const narrow = useNarrow();
  const webgl = useMemo(hasWebGL, []);
  const [ready, setReady] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'scene' | 'list'>('scene');
  const [broken, setBroken] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const item = selected ? items.find((i) => i.id === selected) : undefined;
  const chose = useRef(false);
  useEffect(() => {
    if (focus && !projects.some((p) => p.key === focus)) setFocus(null);
  }, [focus, projects]);
  useEffect(() => {
    if (!chose.current && narrow && prefer && projects.length > 1 && projects.some((p) => p.key === prefer)) {
      chose.current = true;
      setFocus(prefer);
    }
  }, [narrow, prefer, projects]);
  useEffect(() => {
    if (selected && !item) setSelected(null);
  }, [selected, item]);
  useEffect(() => {
    onPanel?.(!!item);
  }, [item, onPanel]);
  const select = useCallback((id: string | null) => {
    setMode('scene');
    setSelected(id);
  }, []);
  const span = Math.max(end - start, 60 * 60_000);
  const sheet = !!item && (narrow || mode === 'list' || !webgl || broken);
  const panel = item ? <Panel item={item} queued={queue.has(item.id)} actions={actions} headingId="panel-title" /> : null;
  const list = (visible: boolean) => (
    <ItemList
      projects={projects}
      agents={agents}
      items={items}
      time={time}
      visible={visible}
      onOpen={(id) => {
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setMode('list');
        setSelected(id);
      }}
    />
  );
  const readout = clockOnly ? clock(time) : stamp(time);
  return (
    <div className="flex size-full min-h-0 flex-col">
      {segments && projects.length > 1 && (
        <ToggleGroup type="single" variant="outline" spacing={0} value={focus ?? 'all'} onValueChange={(v) => {
            chose.current = true;
            setFocus(!v || v === 'all' ? null : v);
          }} className="max-w-full flex-wrap" aria-label="Projects">
          <ToggleGroupItem value="all" className="h-11 px-3 text-[0.8125rem] sm:h-8">
            All
          </ToggleGroupItem>
          {projects.map((p) => (
            <ToggleGroupItem key={p.key} value={p.key} className="h-11 px-3 text-[0.8125rem] sm:h-8">
              {p.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      <div id="space" tabIndex={-1} className="relative min-h-0 flex-1 outline-none" data-space>
        {webgl && !broken && !ready && <Placeholder />}
        {webgl && !broken ? (
          <>
            <Fallback fallback={<FailedScene onFail={() => setBroken(true)} />}>
              <Suspense fallback={null}>
                <Scene
                  projects={projects}
                  agents={agents}
                  items={items}
                  reads={reads}
                  time={time}
                  span={span}
                  focusKey={focus}
                  selected={mode === 'scene' ? selected : null}
                  panel={panel}
                  inline={!narrow}
                  label={label}
                  onSelect={select}
                  onPlate={(key) => setFocus(key)}
                  onHold={(h) => onHold?.(h)}
                  onReady={() => setReady(true)}
                />
              </Suspense>
            </Fallback>
            {list(false)}
          </>
        ) : (
          list(true)
        )}
        <div role="status" className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-4 text-center">
          {notice}
        </div>
        {aside}
      </div>
      <div className="flex items-center gap-4 pt-1">
        <Slider
          className="h-11 flex-1"
          min={start}
          max={Math.max(end, start + 1)}
          step={Math.max(1, Math.round(span / 600))}
          value={[Math.min(Math.max(time, start), end)]}
          onValueChange={([v]) => onTime(v)}
          onPointerDown={() => onHold?.(true)}
          onPointerUp={() => onHold?.(false)}
          thumbLabel="Time"
          valueText={readout}
        />
        <span className="num min-w-[16ch] shrink-0 whitespace-nowrap text-right text-xs" data-readout>
          {readout}
        </span>
      </div>
      <Sheet
        open={sheet}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
      >
        <SheetContent
          side={narrow ? 'bottom' : 'right'}
          className="max-h-[70dvh] gap-0 overflow-y-auto overscroll-contain p-4 pt-5 pr-12 text-sm"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            if (window.matchMedia('(pointer: coarse)').matches) e.preventDefault();
          }}
          onCloseAutoFocus={(e) => {
            const el = opener.current;
            opener.current = null;
            if (!el || !document.contains(el)) return;
            e.preventDefault();
            el.focus();
          }}
        >
          <SheetTitle className="sr-only">{item ? headline(item) : 'Item'}</SheetTitle>
          {panel}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FailedScene({ onFail }: { onFail: () => void }) {
  useEffect(onFail, [onFail]);
  return null;
}
