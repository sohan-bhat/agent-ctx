import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { layout, type Cell, type Node } from '@/lib/context';
import { exact, rel, tokens } from '@/lib/format';

export interface PinState {
  pinned: (label: string) => boolean;
  pin: (label: string) => Promise<void>;
}

interface Props {
  root: Node;
  total: number;
  window?: number | null;
  scaleMax?: number;
  depth?: number;
  cwdRoot?: string;
  focusId?: string;
  onFocus?: (id: string) => void;
  pins?: PinState;
  label: string;
}

const KIND_VAR = (kind: string) => `var(--kind-${kind})`;

export function pinnable(n: Node): boolean {
  return !!n.item && (n.item.kind === 'file' || n.item.kind === 'edit');
}

export function display(n: Node, cwdRoot?: string): string {
  if (!n.item) return n.label;
  const l = n.item.label.startsWith('/') ? rel(n.item.label, cwdRoot) : n.item.label;
  return n.item.count && n.item.count > 1 ? `${l} ×${n.item.count}` : l;
}

export function fill(c: Cell, sibling: number): string {
  const base = KIND_VAR(c.data.kind);
  if (c.depth <= 1) return base;
  const mix = c.depth === 2 ? (sibling % 2 ? 44 : 60) : sibling % 2 ? 26 : 36;
  return `color-mix(in oklab, ${base} ${mix}%, var(--background))`;
}

function background(c: Cell, sibling: number): string {
  const f = fill(c, sibling);
  const kept = c.data.kept;
  if (kept === undefined) return f;
  const at = `${Math.round(kept * 1000) / 10}%`;
  const faint = `color-mix(in oklab, ${KIND_VAR(c.data.kind)} 14%, var(--background))`;
  return `linear-gradient(to right, ${f} 0 ${at}, ${faint} ${at} 100%)`;
}

export function Icicle({ root, total, window, scaleMax, depth = 3, cwdRoot, focusId, onFocus, pins, label }: Props) {
  const cells = useMemo(() => layout(root), [root]);
  const focus = (focusId && cells.descendants().find((d) => d.data.id === focusId)) || cells;
  const ancestors = new Set(focus.ancestors().map((a) => a.data.id));
  const span = focus.x1 - focus.x0 || 1;
  const rows: Cell[][] = [];
  for (const c of cells.descendants()) {
    if (c.depth === 0 || c.depth > depth) continue;
    const inside = c.x0 >= focus.x0 - 1e-9 && c.x1 <= focus.x1 + 1e-9;
    if (!inside && !ancestors.has(c.data.id)) continue;
    (rows[c.depth - 1] ??= []).push(c);
  }
  const width = scaleMax ? `${Math.max(0.5, Math.min(100, (total / scaleMax) * 100))}%` : '100%';
  const used = window ? Math.min(1, total / window) : 1;

  const place = (c: Cell): CSSProperties => {
    if (ancestors.has(c.data.id) && c !== focus) return { left: 0, width: 'calc(100% - 2px)' };
    const x0 = Math.max(0, (c.x0 - focus.x0) / span);
    const x1 = Math.min(1, (c.x1 - focus.x0) / span);
    return { left: `${x0 * 100}%`, width: `max(0px, calc(${(x1 - x0) * 100}% - 2px))` };
  };

  return (
    <div role="group" aria-label={label} className="grid gap-[2px]">
      {window !== undefined && (
        <div className="relative h-8">
          <Block
            style={{ left: 0, width: `max(0px, calc(${used * 100}% - 2px))`, background: 'color-mix(in oklab, var(--foreground) 16%, var(--background))' }}
            name="Used"
            value={total}
            share={window ? `${Math.round(used * 100)}% of ${tokens(window)}` : undefined}
            onPress={focus !== cells ? () => onFocus?.('used') : undefined}
          />
          {window && used < 1 && (
            <Block style={{ left: `${used * 100}%`, width: `${(1 - used) * 100}%`, background: 'transparent', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--muted-foreground)' }} name="Free" value={window - total} />
          )}
        </div>
      )}
      {rows.map((row, i) => (
        <div key={i} className="relative h-8" style={{ width }}>
          {row.map((c) => {
            const sib = c.parent ? c.parent.children!.indexOf(c) : 0;
            const leaf = !c.children?.length;
            const isFocus = c === focus;
            const name = display(c.data, cwdRoot);
            const ink = c.depth === 1 && (c.data.kept === undefined || c.data.kept >= 0.5) ? `var(--ink-${c.data.kind})` : 'var(--foreground)';
            const share = total > 0 ? `${Math.max(c.value! / total < 0.005 ? 0 : 1, Math.round((c.value! / total) * 100))}% of used` : undefined;
            const style = { ...place(c), background: background(c, sib), color: ink };
            const press = onFocus && !leaf ? () => onFocus(isFocus ? c.parent?.data.id ?? 'used' : c.data.id) : undefined;
            if (leaf && c.data.item && pins) {
              return (
                <Popover key={c.data.id}>
                  <Block style={style} name={name} value={c.value!} share={share} mono asPopover>
                    <PopoverContent align="start" className="w-80 gap-2 text-sm">
                      <p className="num break-all text-[0.8125rem] font-semibold">{name}</p>
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
                </Popover>
              );
            }
            return <Block key={c.data.id} style={style} name={name} value={c.value!} share={share} mono={!!c.data.item} onPress={press} pressed={isFocus && c !== cells} />;
          })}
        </div>
      ))}
    </div>
  );
}

interface BlockProps {
  style: CSSProperties;
  name: string;
  value: number;
  share?: string;
  mono?: boolean;
  onPress?: () => void;
  pressed?: boolean;
  asPopover?: boolean;
  children?: ReactNode;
}

function Block({ style, name, value, share, mono, onPress, pressed, asPopover, children }: BlockProps) {
  const [open, setOpen] = useState(false);
  const cls =
    '@container absolute inset-y-0 min-w-0 overflow-hidden rounded-[2px] p-0 text-left text-xs outline-offset-2 transition-[filter] duration-150 hover:brightness-110 focus-visible:z-10 dark:hover:brightness-125';
  const inner = (
    <span className="flex h-full min-w-0 items-center gap-2 px-2">
      <span className={`hidden min-w-0 truncate font-semibold @min-[3.5rem]:block ${mono ? 'num text-[0.6875rem]' : ''}`}>{name}</span>
      <span className="num ml-auto hidden shrink-0 text-[0.6875rem] opacity-80 @min-[8rem]:block">{tokens(value)}</span>
    </span>
  );
  const trigger = asPopover ? (
    <PopoverTrigger asChild>
      <button type="button" className={cls} style={style} aria-label={`${name}, ${exact(value)} tokens`}>
        {inner}
      </button>
    </PopoverTrigger>
  ) : (
    <button type="button" className={cls} style={style} aria-label={`${name}, ${exact(value)} tokens`} aria-pressed={pressed} onClick={onPress}>
      {inner}
    </button>
  );
  return (
    <>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent side="top" className="grid gap-0.5 text-left">
          <span className={`max-w-72 break-all font-semibold ${mono ? 'num' : ''}`}>{name}</span>
          <span className="num opacity-80">
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
  window?: number | null;
  cwdRoot?: string;
  focusId?: string;
  onFocus: (id: string) => void;
  pins?: PinState;
}

export function Breakdown({ root, total, window, cwdRoot, focusId, onFocus, pins }: BreakdownProps) {
  const cells = useMemo(() => layout(root), [root]);
  const focus = (focusId && cells.descendants().find((d) => d.data.id === focusId)) || cells;
  const kids = [...(focus.children ?? [])].sort((a, b) => b.value! - a.value!);
  const rest = focus.value! - kids.reduce((a, c) => a + c.value!, 0);
  const pct = (v: number) => (total > 0 ? `${v / total < 0.01 && v > 0 ? '<1' : Math.round((v / total) * 100)}%` : '');
  const row = (key: string, swatch: string | null, name: ReactNode, value: number, action?: ReactNode, onPress?: () => void, share = pct(value)) => {
    const body = (
      <>
        <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: swatch ?? 'transparent' }} />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="num shrink-0 text-xs text-muted-foreground">{exact(value)}</span>
        <span className="num w-9 shrink-0 text-right text-xs">{share}</span>
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
        {kids.map((c, i) =>
          row(
            c.data.id,
            fill(c, i),
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
        {focus === cells && window && window > total && row('free', null, <span className="text-muted-foreground">Free</span>, window - total, undefined, undefined, '')}
      </ul>
    </div>
  );
}
