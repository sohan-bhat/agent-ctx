import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import type { Item, Read } from '@/lib/api';
import { headline, useReduced } from '@/lib/utils';
import { at, layout as plan, usePalette, type Layout, type Placed } from './layout';
import { World, type WorldApi } from './World';
import { itemId } from './Blocks';

export interface SceneProps {
  projects: { key: string; name: string }[];
  agents: string[];
  items: Item[];
  reads: Read[];
  time: number;
  span: number;
  focusKey: string | null;
  selected: string | null;
  panel: ReactNode;
  inline: boolean;
  label: string;
  onSelect: (id: string | null) => void;
  onPlate: (key: string) => void;
  onHold: (holding: boolean) => void;
  onReady: () => void;
}

export default function Scene({ projects, agents, items, reads, time, span, focusKey, selected, panel, inline, label, onSelect, onPlate, onHold, onReady }: SceneProps) {
  const palette = usePalette();
  const reduced = useReduced();
  const overlay = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const api = useRef<WorldApi>(null);
  const [aspect, setAspect] = useState(() => Math.round((innerWidth / Math.max(1, innerHeight * 0.7)) * 20) / 20);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setAspect(Math.round((r.width / r.height) * 20) / 20);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const base = useMemo(() => plan({ projects, agents, items, reads, aspect }), [projects, agents, items, reads, aspect]);
  const shown = useMemo(() => {
    const plate = focusKey ? base.plates.find((p) => p.key === focusKey) : undefined;
    if (!plate) return { plates: base.plates, base: base.base, links: base.links, corners: base.corners };
    return { plates: [plate], base: base.base.filter((b) => b.plate === plate.key), links: base.links.filter((l) => base.base.some((b) => b.plate === plate.key && l.id.startsWith(`${b.id}>`))), corners: plate.corners };
  }, [base, focusKey]);
  const view: Layout = useMemo(() => ({ plates: shown.plates, links: shown.links, box: base.box, corners: shown.corners, top: base.top, placed: at(shown.base, time, span, base.top) }), [shown, base, time, span]);
  const byId = useMemo(() => new Map(view.placed.filter((p) => !p.id.endsWith('^')).map((p) => [p.id, p])), [view]);
  const [hover, setHover] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<[number, number] | null>(null);
  const [ready, setReady] = useState(false);
  const glide = useRef(0);

  const moveCard = (x: number, y: number) => {
    const el = card.current;
    const box = wrap.current;
    if (!el || !box) return;
    const left = Math.min(Math.max(8, x + 14), box.clientWidth - el.offsetWidth - 8);
    el.style.transform = `translate(${left}px, ${Math.max(8, y - el.offsetHeight - 14)}px)`;
  };

  const openAt = (id: string) => {
    const p = byId.get(id);
    if (!p || !api.current || !p.shown) return;
    setAnchor(null);
    const token = ++glide.current;
    onSelect(id);
    void api.current.focus(p).then(() => {
      if (token !== glide.current || !api.current) return;
      setAnchor(api.current.project(p));
    });
  };

  useEffect(() => {
    if (!selected) {
      setAnchor(null);
      return;
    }
    const p = byId.get(selected);
    if (!p || !p.shown) onSelect(null);
  }, [selected, byId, onSelect]);

  useEffect(() => {
    if (hover && !byId.get(hover)?.shown) setHover(null);
  }, [hover, byId]);

  const pointing = {
    hover,
    selected,
    onHover: (id: string | null, x: number, y: number) => {
      if (selected) return;
      setHover(id);
      if (id) requestAnimationFrame(() => moveCard(x, y));
    },
    onPress: (id: string) => {
      setHover(null);
      openAt(itemId(id));
    },
  };

  const close = () => {
    glide.current++;
    setAnchor(null);
    onSelect(null);
    api.current?.back();
  };

  const shownList = () => view.placed.filter((p) => p.shown && !p.id.endsWith('^'));

  const step = (dir: string) => {
    const list = shownList();
    if (!api.current || !list.length) return;
    const cur = cursor ? byId.get(cursor) : undefined;
    if (!cur || !cur.shown) {
      const first = [...list].sort((a, b) => b.w * b.d - a.w * a.d)[0];
      setCursor(first.id);
      const [x, y] = api.current.project(first);
      setHover(first.id);
      requestAnimationFrame(() => moveCard(x, y));
      return;
    }
    const [cx, cy] = api.current.project(cur);
    let best: Placed | null = null;
    let score = Infinity;
    for (const p of list) {
      if (p.id === cur.id) continue;
      const [x, y] = api.current.project(p);
      const dx = x - cx;
      const dy = y - cy;
      const along = dir === 'ArrowRight' ? dx : dir === 'ArrowLeft' ? -dx : dir === 'ArrowDown' ? dy : -dy;
      const across = dir === 'ArrowRight' || dir === 'ArrowLeft' ? Math.abs(dy) : Math.abs(dx);
      if (along <= 2) continue;
      const s = along + across * 2;
      if (s < score) {
        score = s;
        best = p;
      }
    }
    if (!best) return;
    setCursor(best.id);
    setHover(best.id);
    const [x, y] = api.current.project(best);
    requestAnimationFrame(() => moveCard(x, y));
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const k = e.key;
    if (k.startsWith('Arrow')) {
      e.preventDefault();
      if (e.shiftKey) {
        const turn = Math.PI / 12;
        api.current?.turn(k === 'ArrowLeft' ? -turn : k === 'ArrowRight' ? turn : 0, k === 'ArrowUp' ? -turn / 2 : k === 'ArrowDown' ? turn / 2 : 0);
      } else step(k);
    } else if ((k === 'Enter' || k === ' ') && cursor) {
      e.preventDefault();
      setHover(null);
      openAt(cursor);
    } else if (k === '+' || k === '=') api.current?.zoom(1.25);
    else if (k === '-' || k === '_') api.current?.zoom(0.8);
    else if (k === 'Home') {
      e.preventDefault();
      api.current?.home(true);
    } else if (k === 'Escape') {
      setHover(null);
      setCursor(null);
      if (selected) close();
      else api.current?.home(true);
    }
  };

  useEffect(() => {
    if (import.meta.env.MODE !== 'mock') return;
    const w = window as unknown as { __space?: { spots: () => { id: string; look: string; x: number; y: number; area: number }[]; extent: () => unknown } };
    w.__space = {
      spots: () =>
        shownList().map((p) => {
          const [x, y] = api.current?.project(p) ?? [0, 0];
          return { id: p.id, look: p.look, x, y, area: p.w * p.d };
        }),
      extent: () => api.current?.extent() ?? null,
    };
    return () => {
      delete w.__space;
    };
  });

  const hovered = hover ? byId.get(hover) : undefined;
  const blocks = view.placed.filter((p) => p.shown && (p.look === 'solid' || p.look === 'post')).length;
  const flat = view.placed.filter((p) => p.shown && p.look === 'flat').length;
  const outlines = view.placed.filter((p) => p.shown && p.look === 'outline').length;

  return (
    <div
      ref={wrap}
      className={`relative size-full touch-none select-none outline-offset-[-2px] transition-opacity duration-200 focus-visible:outline-2 focus-visible:outline-ring ${ready ? 'opacity-100' : 'opacity-0'}`}
      tabIndex={0}
      role="group"
      aria-roledescription="space"
      aria-label={label}
      data-blocks={blocks}
      data-flat={flat}
      data-outlines={outlines}
      data-pins={view.placed.filter((p) => p.shown && p.item.pinned && p.look !== 'cap').length}
      data-links={view.links.filter((l) => l.at <= time).length}
      data-ready={ready ? '1' : '0'}
      onKeyDown={onKey}
      onPointerDown={() => onHold(true)}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      onPointerLeave={() => {
        setHover(null);
        onHold(false);
      }}
      onWheel={() => onHold(true)}
    >
      <Canvas
        orthographic
        frameloop="demand"
        shadows="percentage"
        flat
        dpr={[1, 2]}
        performance={{ min: 0.5, debounce: 250 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
        camera={{ position: [20, 20, 20], zoom: 40, near: 0.1, far: 300 }}
        aria-hidden
        onPointerMissed={() => {
          if (selected) close();
        }}
      >
        <World
          layout={view}
          time={time}
          palette={palette}
          portal={overlay}
          pointing={pointing}
          reduced={reduced}
          api={api}
          focusKey={focusKey}
          onPlate={(key) => {
            if (selected) close();
            onPlate(key);
          }}
          onMove={() => {
            glide.current++;
            setHover(null);
            if (selected) {
              setAnchor(null);
              onSelect(null);
            }
          }}
          onHold={onHold}
          onReady={() => {
            setReady(true);
            onReady();
          }}
        />
      </Canvas>
      <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden />
      <div
        ref={card}
        className="pointer-events-none absolute left-0 top-0 z-30 w-max max-w-64 rounded-sm bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        style={{ visibility: hovered && !selected ? 'visible' : 'hidden' }}
        aria-hidden
      >
        {hovered && (
          <>
            <p className="line-clamp-2 text-[0.8125rem] font-semibold leading-snug">{headline(hovered.item)}</p>
            <p className="num mt-0.5 text-[0.6875rem]">{hovered.item.origin.agent === 'page' ? 'you' : hovered.item.origin.agent}</p>
          </>
        )}
      </div>
      {inline && (
        <Popover
          open={!!selected && !!anchor}
          onOpenChange={(o) => {
            if (!o) close();
          }}
        >
          <PopoverAnchor asChild>
            <div className="pointer-events-none absolute size-px" style={{ left: anchor?.[0] ?? 0, top: anchor?.[1] ?? 0 }} />
          </PopoverAnchor>
          {selected && anchor && (
            <PopoverContent
              aria-labelledby="panel-title"
              side="top"
              align="center"
              collisionPadding={12}
              className="w-[22rem] gap-3 p-3.5 text-sm"
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                const el = e.currentTarget as HTMLElement | null;
                (el?.querySelector('button') ?? el)?.focus({ preventScroll: true });
              }}
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                wrap.current?.focus({ preventScroll: true });
              }}
            >
              {panel}
            </PopoverContent>
          )}
        </Popover>
      )}
    </div>
  );
}
