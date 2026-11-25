import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Canvas } from '@react-three/fiber';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import type { Dropped, Item } from '@/lib/api';
import { nameOf } from '@/lib/context';
import { exact, rel, tokens } from '@/lib/format';
import { plan, piecesAt, piecesBefore, siblingKey, type Block, type Line } from '@/lib/model';
import { usePalette } from './palette';
import { framing, heightAt, place, SIDE, type Placed } from './layout';
import { World, type WorldApi } from './World';

export interface Payload {
  kind: string;
  label: string;
  text: string;
}

export interface SceneProps {
  line: Line;
  call: number;
  total: number;
  cut: { n: number; index: number; before: number; after: number } | null;
  plate: number;
  peak: number;
  last: number;
  label: string;
  root?: string;
  pins: Item[];
  queued: Item[];
  dropped: Dropped[];
  reading?: string;
  hidden?: boolean;
  onSend: (kind: 'pin' | 'putback', payload: Payload) => Promise<void>;
}

function useReduced(): boolean {
  const q = '(prefers-reduced-motion: reduce)';
  const [r, setR] = useState(() => window.matchMedia?.(q).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setR(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return r;
}

const head = (s: string) => s.slice(0, Math.min(40, s.length));

function matches(it: Item, b: Block): boolean {
  if (b.group) return false;
  if (b.file) return it.kind === 'file' && it.label === b.label;
  if (b.cat === 'tool:Bash') return it.kind === 'command' && it.label === b.label;
  if (b.kind === 'prompts') return it.kind === 'decision' && !!it.text && b.label.includes(head(it.text));
  return false;
}

function putBackOf(b: Block, dropped: Dropped[]): Payload | null {
  if (b.group) return null;
  if (b.file) return { kind: 'file', label: b.label, text: '' };
  if (b.cat === 'tool:Bash') {
    const d = dropped.find((x) => x.kind === 'command' && x.label === b.label);
    return d ? { kind: 'command', label: d.label, text: d.text } : null;
  }
  if (b.kind === 'prompts') {
    const d = dropped.find((x) => x.kind === 'decision' && b.label.includes(head(x.text)));
    return d ? { kind: 'decision', label: 'Decision', text: d.text } : null;
  }
  return null;
}

function pinOf(b: Block, dropped: Dropped[], gone: boolean): Payload | null {
  if (b.group) return null;
  if (b.file) return { kind: 'file', label: b.label, text: '' };
  return gone ? putBackOf(b, dropped) : null;
}

const calls = (n: number) => (n === 1 ? '1 call' : `${exact(n)} calls`);

function Details({ p, placed, root, cut }: { p: Placed; placed: Placed[]; root?: string; cut: SceneProps['cut'] }) {
  const b = p.piece.block;
  const key = siblingKey(b);
  const sibs = key ? placed.filter((q) => siblingKey(q.piece.block) === key && q.piece.state === p.piece.state) : [];
  const name = b.label.startsWith('/') ? rel(b.label, root) : nameOf(b);
  const when = p.piece.state === 'gone' ? `dropped at compaction ${(cut?.index ?? 0) + 1}` : b.members ? '' : b.kind === 'system' && !b.group ? 'sent with every call' : p.piece.age === 0 ? 'entered at this call' : `carried ${calls(p.piece.age)}`;
  const verb = b.file ? 'Read' : b.cat === 'tool:Bash' ? 'Ran' : 'Seen';
  const members = b.members ? [...b.members].sort((x, y) => y.tok - x.tok) : [];
  return (
    <div className="grid gap-1">
      <p className={`break-all font-semibold leading-snug ${b.label.startsWith('/') || b.cat === 'tool:Bash' ? 'num text-[0.8125rem]' : 'text-sm'}`}>{name}</p>
      <p className="num text-xs">
        {exact(p.piece.size)} tokens{when ? `, ${when}` : ''}
      </p>
      {sibs.length > 1 && (
        <p className="num text-xs">
          {verb} {sibs.length} times, {exact(sibs.reduce((a, q) => a + q.piece.size, 0))} tokens in all
        </p>
      )}
      {members.length > 0 && (
        <ul className="mt-1 grid gap-0.5 text-xs">
          {members.slice(0, 8).map((m) => (
            <li key={m.id} className="flex gap-3">
              <span className="num min-w-0 flex-1 truncate">{m.label.startsWith('/') ? rel(m.label, root) : nameOf(m)}</span>
              <span className="num shrink-0 text-muted-foreground">{tokens(m.tok)}</span>
            </li>
          ))}
          {members.length > 8 && <li className="text-muted-foreground">{members.length - 8} more</li>}
        </ul>
      )}
    </div>
  );
}

export default function Scene({ line, call, total, cut, plate, peak, last, label, root, pins, queued, dropped, reading, hidden = false, onSend }: SceneProps) {
  const palette = usePalette();
  const reduced = useReduced();
  const overlay = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const api = useRef<WorldApi>(null);
  const shown = useDeferredValue(useMemo(() => ({ line, call, total }), [line, call, total]));
  const placed = useMemo(() => {
    if (!cut) return place(plan(piecesAt(shown.line, shown.call, shown.total), plate, SIDE));
    const now = place(plan(piecesAt(line, cut.n, cut.after), plate, SIDE, undefined, true));
    const was = place(plan(piecesBefore(line, cut.n, cut.before), plate, SIDE)).filter((p) => p.piece.state === 'gone');
    return [...was, ...now];
  }, [line, shown, cut, plate]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);
  const force = useMemo(() => new Set(cut ? placed.filter((p) => p.piece.state === 'stand' && p.piece.block.kind === 'summary').map((p) => p.id) : []), [placed, cut]);
  const reach = useMemo(() => placed.reduce((m, p) => Math.max(m, -(p.cx - p.w / 2), -(p.cz - p.d / 2)), 0), [placed]);
  const f = useMemo(() => framing(peak, plate, last), [peak, plate, last]);
  const version = useRef({ placed, n: 0 });
  if (version.current.placed !== placed) version.current = { placed, n: version.current.n + 1 };
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const framed = useRef<string | null>(null);
  const glide = useRef(0);
  const [ready, setReady] = useState(false);
  const marked = useRef(false);
  const plateSeen = useRef(false);
  if (ready && reading && !hidden) plateSeen.current = true;
  useEffect(() => {
    if (!ready || hidden) return;
    if (reading) performance.mark('plate-ready');
    else if (!marked.current) {
      marked.current = true;
      performance.mark('model-ready');
    }
  }, [ready, reading, hidden]);

  const queuedIds = useMemo(() => {
    const out = new Set<string>();
    for (const q of queued) {
      let best: Placed | null = null;
      for (const p of placed) if (p.piece.state === 'gone' && matches(q, p.piece.block) && (!best || p.piece.size > best.piece.size)) best = p;
      if (best) out.add(best.id);
    }
    return out;
  }, [placed, queued]);
  const pinnedIds = useMemo(() => new Set(placed.filter((p) => pins.some((q) => matches(q, p.piece.block))).map((p) => p.id)), [placed, pins]);
  const outline = useCallback((p: Placed) => heightAt(Math.max(0, (cut?.n ?? call) - 1 - p.piece.block.birth)), [cut, call]);

  useEffect(() => {
    if (hover && !byId.has(hover)) setHover(null);
    if (selected && !byId.has(selected)) setSelected(null);
    if (menu && !byId.has(menu.id)) setMenu(null);
  }, [byId, hover, selected, menu]);

  const moveCard = (x: number, y: number) => {
    const el = card.current;
    const box = wrap.current;
    if (!el || !box) return;
    const left = Math.min(Math.max(8, x + 14), box.clientWidth - el.offsetWidth - 8);
    el.style.transform = `translate(${left}px, ${Math.max(8, y - el.offsetHeight - 14)}px)`;
  };

  const pointing = {
    hover,
    selected,
    onHover: (id: string | null, x: number, y: number) => {
      if (menu) return;
      setHover(id);
      if (id) requestAnimationFrame(() => moveCard(x, y));
    },
    onPress: (id: string) => {
      setHover(null);
      setSelected(id);
      openAt(id);
    },
    onFrame: (id: string) => {
      const p = byId.get(id);
      if (!p) return;
      glide.current++;
      setMenu(null);
      if (framed.current === p.piece.block.kind) {
        framed.current = id;
        api.current?.frame([p]);
      } else {
        framed.current = p.piece.block.kind;
        api.current?.frame(placed.filter((q) => q.piece.block.kind === p.piece.block.kind));
      }
    },
  };

  const openAt = (id: string) => {
    const p = byId.get(id);
    if (!p || !api.current) return;
    setFailed(false);
    setMenu(null);
    const token = ++glide.current;
    void api.current.focus(p).then(() => {
      if (token !== glide.current || !api.current) return;
      const [x, y] = api.current.project(p);
      setMenu({ id, x, y });
    });
  };

  const escape = () => {
    glide.current++;
    setHover(null);
    if (menu) setMenu(null);
    if (api.current?.back()) return;
    if (selected) setSelected(null);
    else {
      framed.current = null;
      api.current?.home(true);
    }
  };

  const select = (id: string) => {
    setSelected(id);
    const p = byId.get(id);
    if (!p || !api.current) return;
    const [x, y] = api.current.project(p);
    setHover(id);
    requestAnimationFrame(() => moveCard(x, y));
  };

  const step = (dir: string) => {
    const order = [...placed].sort((a, b) => b.w * b.d - a.w * a.d);
    if (!api.current || !order.length) return;
    const cur = selected ? byId.get(selected) : undefined;
    if (!cur) {
      select(order[0].id);
      return;
    }
    const [cx, cy] = api.current.project(cur);
    let best: Placed | null = null;
    let score = Infinity;
    for (const p of order) {
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
    if (best) select(best.id);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const k = e.key;
    if (k.startsWith('Arrow')) {
      e.preventDefault();
      if (e.shiftKey) {
        setHover(null);
        const turn = Math.PI / 12;
        api.current?.turn(k === 'ArrowLeft' ? -turn : k === 'ArrowRight' ? turn : 0, k === 'ArrowUp' ? -turn / 2 : k === 'ArrowDown' ? turn / 2 : 0);
      } else step(k);
    } else if ((k === 'Enter' || k === ' ') && selected) {
      e.preventDefault();
      openAt(selected);
    } else if (k === '+' || k === '=') {
      setHover(null);
      api.current?.zoom(1.25);
    } else if (k === '-' || k === '_') {
      setHover(null);
      api.current?.zoom(0.8);
    } else if (k === 'Home') {
      e.preventDefault();
      framed.current = null;
      api.current?.home(true);
    } else if (k === 'Escape') escape();
  };

  const act = async (kind: 'pin' | 'putback', payload: Payload) => {
    setBusy(true);
    setFailed(false);
    try {
      await onSend(kind, payload);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const hovered = hover ? byId.get(hover) : undefined;
  const open = menu ? byId.get(menu.id) : undefined;
  const sel = selected ? byId.get(selected) : undefined;
  const gone = open?.piece.state === 'gone';
  const back = open && gone ? putBackOf(open.piece.block, dropped) : null;
  const pin = open ? pinOf(open.piece.block, dropped, !!gone) : null;

  return (
    <div
      ref={wrap}
      className={`relative h-[16rem] select-none rounded-[2px] outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring sm:h-[27rem] ${ready ? '' : 'pointer-events-none opacity-0'}`}
      tabIndex={0}
      role="group"
      aria-roledescription="model"
      aria-label={label}
      data-blocks={placed.length - placed.filter((p) => p.piece.state === 'gone').length}
      data-gone={placed.filter((p) => p.piece.state === 'gone').length}
      onKeyDown={onKey}
      onPointerLeave={() => setHover(null)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(null);
      }}
    >
      <Canvas
        orthographic
        frameloop="demand"
        shadows="percentage"
        flat
        dpr={[1, 2]}
        performance={{ min: 0.5, debounce: 250 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
        camera={{ position: [20, 20, 20], zoom: 40, near: 0.1, far: 200 }}
        onPointerMissed={() => {
          glide.current++;
          setMenu(null);
          setSelected(null);
        }}
      >
        <World
          placed={placed}
          palette={palette}
          portal={overlay}
          framing={f}
          plateLabel={`${tokens(plate)} window`}
          version={version.current.n}
          pointing={pointing}
          reduced={reduced}
          queued={queuedIds}
          pinned={pinnedIds}
          outline={outline}
          api={api}
          onMove={() => {
            glide.current++;
            setMenu(null);
            setHover(null);
          }}
          force={force}
          reach={reach}
          reading={reading}
          glideIn={plateSeen.current}
          onReady={() => setReady(true)}
        />
      </Canvas>
      <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden" />
      <div
        ref={card}
        className="pointer-events-none absolute left-0 top-0 z-30 w-max max-w-72 rounded-sm bg-popover px-2.5 py-2 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        style={{ visibility: hovered && !menu ? 'visible' : 'hidden' }}
        aria-hidden
      >
        {hovered && <Details p={hovered} placed={placed} root={root} cut={cut} />}
      </div>
      <Popover
        open={!!open}
        onOpenChange={(o) => {
          if (!o) setMenu(null);
        }}
      >
        <PopoverAnchor asChild>
          <div className="pointer-events-none absolute size-px" style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }} />
        </PopoverAnchor>
        {open && (
          <PopoverContent
            side="top"
            align="center"
            collisionPadding={12}
            className="w-80 gap-2.5 text-sm"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              const el = e.currentTarget as HTMLElement | null;
              (el?.querySelector('button') ?? el)?.focus({ preventScroll: true });
            }}
            onEscapeKeyDown={(e) => {
              e.preventDefault();
              escape();
            }}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              wrap.current?.focus();
            }}
          >
            <Details p={open} placed={placed} root={root} cut={cut} />
            {gone && queued.some((q) => matches(q, open.piece.block)) ? (
              <p className="text-xs font-semibold">Queued for your next prompt</p>
            ) : gone && back ? (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void act('putback', back)}>
                  Put back
                </Button>
                {pin && !pinnedIds.has(open.id) && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act('pin', pin)}>
                    Pin
                  </Button>
                )}
              </div>
            ) : null}
            {!gone &&
              pin &&
              (pinnedIds.has(open.id) ? (
                <p className="text-xs font-semibold">Pinned for the next compaction</p>
              ) : (
                <Button variant="outline" size="sm" className="justify-self-start" disabled={busy} onClick={() => void act('pin', pin)}>
                  Pin for the next compaction
                </Button>
              ))}
            {gone && pinnedIds.has(open.id) && <p className="text-xs font-semibold">Pinned for the next compaction</p>}
            {failed && <p className="text-xs text-destructive">Saving failed, maybe because the claude-ctx server stopped.</p>}
          </PopoverContent>
        )}
      </Popover>
      <p className="sr-only" aria-live="polite">
        {sel ? `${nameOf(sel.piece.block)}, ${exact(sel.piece.size)} tokens${sel.piece.state === 'gone' ? ', dropped' : ''}` : ''}
      </p>
    </div>
  );
}
