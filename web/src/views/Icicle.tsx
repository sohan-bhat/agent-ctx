import { useMemo, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { useParentSize } from '@visx/responsive';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { layout, type Cell, type Node } from '@/lib/context';
import { base, exact, rel, tokens } from '@/lib/format';

export interface PinState {
  pinned: (label: string) => boolean;
  pin: (label: string) => Promise<void>;
}

interface Props {
  root: Node;
  total: number;
  scaleMax?: number;
  from?: number;
  depth?: number;
  cwdRoot?: string;
  focusId?: string;
  onFocus?: (id: string) => void;
  pins?: PinState;
  label: string;
}

const NAME_PX = 52;
const COUNT_PX = 128;
const USED = 'color-mix(in oklab, var(--foreground) 14%, var(--background))';
const KIND = (kind: string) => `var(--kind-${kind})`;

export function pinnable(n: Node): boolean {
  return !!n.item && (n.item.kind === 'file' || n.item.kind === 'edit');
}

export function display(n: Node, cwdRoot?: string): string {
  if (!n.item) return n.label;
  const l = n.item.label.startsWith('/') ? rel(n.item.label, cwdRoot) : n.item.label;
  return n.item.count && n.item.count > 1 ? `${l} ×${n.item.count}` : l;
}

function short(n: Node): string {
  if (!n.item) return n.label;
  const l = n.item.label.startsWith('/') ? base(n.item.label) : n.item.label;
  return n.item.count && n.item.count > 1 ? `${l} ×${n.item.count}` : l;
}

export function fill(c: Cell, sibling: number): string {
  if (c.depth === 0) return USED;
  if (c.depth === 1) return KIND(c.data.kind);
  const mix = c.depth === 2 ? (sibling % 2 ? 46 : 62) : sibling % 2 ? 30 : 40;
  return `color-mix(in oklab, ${KIND(c.data.kind)} ${mix}%, var(--background))`;
}

const faint = (kind: string) => `color-mix(in oklab, ${KIND(kind)} 16%, var(--background))`;

export function Icicle({ root, total, scaleMax, from = 0, depth = 3, cwdRoot, focusId, onFocus, pins, label }: Props) {
  const { parentRef, width: px } = useParentSize({ debounceTime: 30 });
  const cells = useMemo(() => layout(root), [root]);
  const focus = (focusId && cells.descendants().find((d) => d.data.id === focusId)) || cells;
  const ancestors = new Set(focus.ancestors().map((a) => a.data.id));
  const span = focus.x1 - focus.x0 || 1;
  const scale = scaleMax ? Math.max(0.005, Math.min(1, total / scaleMax)) : 1;
  const rowPx = px * scale;

  const frac = (c: Cell): [number, number] => {
    if (ancestors.has(c.data.id)) return [0, 1];
    return [Math.max(0, (c.x0 - focus.x0) / span), Math.min(1, (c.x1 - focus.x0) / span)];
  };

  const rows: Cell[][] = [];
  for (const c of cells.descendants()) {
    if (c.depth < from || c.depth > depth) continue;
    const inside = c.x0 >= focus.x0 - 1e-9 && c.x1 <= focus.x1 + 1e-9;
    if (!inside && !ancestors.has(c.data.id)) continue;
    (rows[c.depth] ??= []).push(c);
  }
  const shown = rows.filter((row, d) => {
    if (!row || d < 2 || !px) return !!row;
    return row.some((c) => {
      const [a, b] = frac(c);
      return (b - a) * rowPx >= NAME_PX;
    });
  });

  const place = (a: number, b: number): CSSProperties => ({ left: `${a * 100}%`, width: `max(0px, calc(${(b - a) * 100}% - 2px))` });

  return (
    <div ref={parentRef} role="group" aria-label={label} className="grid gap-[2px]">
      {shown.map((row) => (
        <div key={row[0].depth} className="relative h-8" style={{ width: `${scale * 100}%` }}>
          {row.flatMap((c) => {
            const sib = c.parent ? c.parent.children!.indexOf(c) : 0;
            const leaf = !c.children?.length;
            const isFocus = c === focus;
            const full = c.depth === 0 ? 'Used' : display(c.data, cwdRoot);
            const visible = c.depth === 0 ? 'Used' : short(c.data);
            const [a, b] = frac(c);
            const wide = (b - a) * rowPx;
            const share = total > 0 && c.depth > 0 ? `${c.value! / total < 0.01 ? '<1' : Math.round((c.value! / total) * 100)}% of used` : undefined;
            const press = onFocus && !leaf ? () => onFocus(isFocus ? c.parent?.data.id ?? 'used' : c.data.id) : undefined;
            const kept = c.data.kept;
            if (kept !== undefined && c.depth >= 1) {
              const cut = a + (b - a) * kept;
              const keptBig = kept >= 0.5;
              const parts: ReactElement[] = [];
              if (kept > 0)
                parts.push(
                  <Block
                    key={`${c.data.id}#kept`}
                    style={{ ...place(a, cut), background: fill(c, sib), color: c.depth === 1 ? 'var(--kind-ink)' : 'var(--foreground)' }}
                    name={`${full} kept`}
                    text={keptBig && wide * kept >= NAME_PX ? visible : null}
                    count={keptBig && wide * kept >= COUNT_PX ? c.value! * kept : null}
                    value={c.value! * kept}
                  />,
                );
              if (kept < 1)
                parts.push(
                  <Block
                    key={`${c.data.id}#gone`}
                    style={{ ...place(cut, b), background: faint(c.data.kind), color: 'var(--foreground)' }}
                    name={`${full} dropped`}
                    text={!keptBig && wide * (1 - kept) >= NAME_PX ? visible : null}
                    count={!keptBig && wide * (1 - kept) >= COUNT_PX ? c.value! * (1 - kept) : null}
                    value={c.value! * (1 - kept)}
                  />,
                );
              return parts;
            }
            const style = { ...place(a, b), background: fill(c, sib), color: c.depth === 1 ? 'var(--kind-ink)' : 'var(--foreground)' };
            const text = wide >= NAME_PX ? visible : null;
            const count = wide >= COUNT_PX ? c.value! : null;
            if (leaf && c.data.item && pins) {
              return [
                <Popover key={c.data.id}>
                  <Block style={style} name={full} text={text} count={count} value={c.value!} share={share} mono asPopover>
                    <PopoverContent align="start" className="w-80 gap-2 text-sm">
                      <p className="num break-all text-[0.8125rem] font-semibold">{full}</p>
                      <p className="num text-xs text-muted-foreground">{exact(c.value!)} tokens</p>
                      {pinnable(c.data) &&
                        (pins.pinned(c.data.item.label) ? (
                          <p className="text-xs font-semibold">Pinned for the next compaction</p>
                        ) : (
                          <Button variant="outline" size="sm" className="justify-self-start" onClick={() => void pins.pin(c.data.item!.label)}>
                            Pin for the next compaction
                          </Button>
                        ))}
                    </PopoverContent>
                  </Block>
                </Popover>,
              ];
            }
            const rootPress = c.depth === 0 && focus !== cells && onFocus ? () => onFocus('used') : undefined;
            return [<Block key={c.data.id} style={style} name={full} text={text} count={count} value={c.value!} share={share} mono={!!c.data.item} onPress={rootPress ?? press} pressed={isFocus && c !== cells ? true : undefined} />];
          })}
        </div>
      ))}
    </div>
  );
}

interface BlockProps {
  style: CSSProperties;
  name: string;
  text: string | null;
  count: number | null;
  value: number;
  share?: string;
  mono?: boolean;
  onPress?: () => void;
  pressed?: boolean;
  asPopover?: boolean;
  children?: ReactNode;
}

function Block({ style, name, text, count, value, share, mono, onPress, pressed, asPopover, children }: BlockProps) {
  const cls = 'absolute inset-y-0 min-w-0 overflow-hidden rounded-[2px] p-0 text-left text-xs outline-offset-2 transition-[filter] duration-150 hover:brightness-110 focus-visible:z-10 dark:hover:brightness-125';
  const inner = (
    <span className="flex h-full min-w-0 items-center gap-2 px-1.5">
      {text && <span className={`min-w-0 truncate font-semibold ${mono ? 'num text-[0.6875rem]' : ''}`}>{text}</span>}
      {count != null && <span className="num ml-auto shrink-0 text-[0.6875rem]">{tokens(count)}</span>}
    </span>
  );
  const props = { type: 'button' as const, className: cls, style, 'aria-label': `${name}, ${exact(value)} tokens` };
  const trigger = asPopover ? (
    <PopoverTrigger asChild>
      <button {...props}>{inner}</button>
    </PopoverTrigger>
  ) : (
    <button {...props} aria-pressed={pressed} onClick={onPress}>
      {inner}
    </button>
  );
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent side="top" className="grid gap-0.5 text-left">
          <span className={`max-w-72 break-all font-semibold ${mono ? 'num' : ''}`}>{name}</span>
          <span className="num">
            {exact(value)} tokens{share ? `, ${share}` : ''}
          </span>
        </TooltipContent>
      </Tooltip>
      {children}
    </>
  );
}

interface BreakdownProps {
  root: Node;
  total: number;
  cwdRoot?: string;
  focusId?: string;
  onFocus: (id: string) => void;
  pins?: PinState;
}

export function Breakdown({ root, total, cwdRoot, focusId, onFocus, pins }: BreakdownProps) {
  const cells = useMemo(() => layout(root), [root]);
  const focus = (focusId && cells.descendants().find((d) => d.data.id === focusId)) || cells;
  const kids = [...(focus.children ?? [])].sort((a, b) => b.value! - a.value!);
  const rest = focus.value! - kids.reduce((a, c) => a + c.value!, 0);
  const pct = (v: number) => (total > 0 ? `${v / total < 0.01 && v > 0 ? '<1' : Math.round((v / total) * 100)}%` : '');
  const row = (key: string, swatch: string | null, name: ReactNode, value: number, action?: ReactNode, onPress?: () => void) => {
    const body = (
      <>
        <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: swatch ?? 'transparent' }} />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="num shrink-0 text-xs text-muted-foreground">{exact(value)}</span>
        <span className="num w-9 shrink-0 text-right text-xs">{pct(value)}</span>
      </>
    );
    return (
      <li key={key} className="flex items-center gap-3">
        {onPress ? (
          <button type="button" onClick={onPress} className="-mx-1.5 flex min-w-0 flex-1 items-center gap-3 rounded-sm px-1.5 py-1 text-left transition-colors duration-150 hover:bg-accent">
            {body}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3 py-1">{body}</div>
        )}
        {action}
      </li>
    );
  };
  return (
    <div className="grid gap-2">
      {focus !== cells && (
        <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
          <span className="font-semibold">{focus.ancestors().reverse().slice(1).map((a) => display(a.data, cwdRoot)).join(', ')}</span>
          <button type="button" className="font-semibold underline decoration-foreground/35 underline-offset-4 transition-colors duration-150 hover:decoration-foreground" onClick={() => onFocus(focus.parent?.data.id ?? 'used')}>
            Up one level
          </button>
        </div>
      )}
      <ul className="grid text-sm">
        {kids.map((c) =>
          row(
            c.data.id,
            fill(c, c.parent ? c.parent.children!.indexOf(c) : 0),
            <span className={c.data.item ? 'num text-[0.8125rem]' : ''}>{display(c.data, cwdRoot)}</span>,
            c.value!,
            pins && pinnable(c.data) ? (
              pins.pinned(c.data.item!.label) ? (
                <span className="shrink-0 text-xs text-muted-foreground">Pinned</span>
              ) : (
                <button type="button" className="shrink-0 text-xs font-semibold underline decoration-foreground/35 underline-offset-4 transition-colors duration-150 hover:decoration-foreground" onClick={() => void pins.pin(c.data.item!.label)}>
                  Pin
                </button>
              )
            ) : undefined,
            c.children?.length ? () => onFocus(c.data.id) : undefined,
          ),
        )}
        {rest > 0.5 && kids.length > 0 && row('rest', null, <span className="text-muted-foreground">Smaller items</span>, rest)}
      </ul>
    </div>
  );
}
