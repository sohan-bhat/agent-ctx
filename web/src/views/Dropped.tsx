import { useMemo, useState, type ReactNode } from 'react';
import { ArrowUUpLeft, CaretDown, FileText, PencilSimple, PushPin, Signpost, TerminalWindow } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { send, type Compaction, type Dropped, type Item } from '@/lib/api';
import { ago, rel, tokens } from '@/lib/format';

const ICON = { decision: Signpost, edit: PencilSimple, file: FileText, command: TerminalWindow } as const;
const KIND = { decision: 'Decision', edit: 'Edited', file: 'File read', command: 'Command output' } as const;
export const VISIBLE = 8;

export function payload(session: string, d: Dropped) {
  if (d.kind === 'decision') return { session, kind: 'decision', label: 'Decision', text: d.text };
  if (d.kind === 'command') return { session, kind: 'command', label: d.label, text: d.text };
  return { session, kind: 'file', label: d.label, text: '' };
}

function matches(it: Item, d: Dropped): boolean {
  const kind = d.kind === 'edit' ? 'file' : d.kind;
  if (it.kind !== kind) return false;
  return d.kind === 'decision' ? it.text === d.text : it.label === d.label;
}

function meta(d: Dropped): string {
  if (d.kind === 'edit') return d.runs && d.runs > 1 ? `${d.runs} edits` : '1 edit';
  if (d.kind === 'command') {
    const runs = d.runs && d.runs > 1 ? `ran ${d.runs} times` : '';
    return [d.error ? 'error' : '', runs].filter(Boolean).join(', ') || `${tokens(d.tok)} tokens`;
  }
  return `${tokens(d.tok)} tokens`;
}

interface BlockProps {
  root?: string;
  index: number;
  total: number;
  c: Compaction;
  queued: Item[];
  pins: Item[];
  picked: Map<string, Dropped>;
  onToggle: (key: string, d: Dropped, on: boolean) => void;
}

export function CompactionBlock({ root, index, total, c, queued, pins, picked, onToggle }: BlockProps) {
  const [all, setAll] = useState(false);
  const [openCmds, setOpenCmds] = useState(false);
  const [allCmds, setAllCmds] = useState(false);
  const main = c.dropped.filter((d) => d.kind !== 'command');
  const cmds = c.dropped.filter((d) => d.kind === 'command');
  const state = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of c.dropped) {
      if (queued.some((q) => matches(q, d))) m.set(d.id, 'Queued for your next prompt');
      else if (pins.some((p) => matches(p, d))) m.set(d.id, 'Pinned');
    }
    return m;
  }, [c.dropped, queued, pins]);

  const row = (d: Dropped) => {
    const Icon = ICON[d.kind];
    const st = state.get(d.id);
    const key = `${index}:${d.id}`;
    const id = `pick-${index}-${d.id}`;
    const text = d.kind === 'decision' ? d.text : d.kind === 'command' ? d.label : rel(d.label, root);
    return (
      <li key={d.id} className="flex items-start gap-3 px-4 py-3">
        <Checkbox id={id} className="mt-0.5" checked={picked.has(key)} onCheckedChange={(v) => onToggle(key, d, v === true)} disabled={!!st} />
        <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {d.kind !== 'command' && <Icon aria-hidden className="size-3.5" />}
            {d.kind !== 'command' && KIND[d.kind]}
            <span className="num">{meta(d)}</span>
          </span>
          <span className={d.kind === 'decision' ? 'mt-0.5 block text-[0.95rem]' : 'num mt-0.5 block break-all text-[0.82rem]'} title={d.kind === 'decision' ? undefined : d.label}>
            {text}
          </span>
        </label>
        {st && <span className="shrink-0 pt-0.5 text-xs font-medium">{st}</span>}
      </li>
    );
  };

  const rows: ReactNode[] = main.map(row);
  if (cmds.length)
    rows.push(
      <li key="commands" className="px-4 py-3">
        <button type="button" aria-expanded={openCmds} onClick={() => setOpenCmds(!openCmds)} className="flex w-full items-start gap-3 text-left">
          <CaretDown aria-hidden className={`mt-1 size-4 shrink-0 transition-transform ${openCmds ? 'rotate-180' : ''}`} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <TerminalWindow aria-hidden className="size-3.5" />
              Command output
            </span>
            <span className="mt-0.5 block text-[0.95rem]">
              {cmds.length} of {c.commands} commands, only those with an error or run more than once
            </span>
          </span>
        </button>
        {openCmds && (
          <>
            <ul className="mt-2 divide-y border-t">{(allCmds ? cmds : cmds.slice(0, VISIBLE)).map(row)}</ul>
            {cmds.length > VISIBLE && (
              <button type="button" className="ml-7 mt-1 text-sm font-medium underline underline-offset-4" onClick={() => setAllCmds(!allCmds)}>
                {allCmds ? 'Show fewer' : `Show ${cmds.length - VISIBLE} more`}
              </button>
            )}
          </>
        )}
      </li>,
    );

  return (
    <article className="border-t pt-7" aria-labelledby={`cmp-${index}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 id={`cmp-${index}`} className="font-heading text-[1.25rem] font-bold tracking-[-0.015em]">
          Compaction {total - index} at call {c.n}
        </h3>
        <p className="num text-[0.85rem] text-muted-foreground">
          <span className="font-semibold text-foreground">{tokens(c.pre)}</span> to <span className="font-semibold text-foreground">{tokens(c.post)}</span> tokens, {c.trigger}, {ago(c.t)}
        </p>
      </div>

      {c.summary && (
        <Collapsible className="mt-3">
          <CollapsibleTrigger className="group inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline">
            <CaretDown aria-hidden className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
            Read the summary
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="mt-2 max-w-[75ch] whitespace-pre-line text-[0.92rem] leading-relaxed text-muted-foreground">{c.summary}</p>
          </CollapsibleContent>
        </Collapsible>
      )}

      <h4 className="mt-6 font-heading text-base font-semibold">Left out of the summary</h4>

      {rows.length === 0 ? (
        <p className="mt-4 text-[0.92rem]">The summary names every tracked item.</p>
      ) : (
        <>
          <ul className="mt-4 divide-y rounded-lg border bg-card">{all ? rows : rows.slice(0, VISIBLE)}</ul>
          {rows.length > VISIBLE && (
            <button type="button" className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline" onClick={() => setAll(!all)}>
              <CaretDown aria-hidden className={all ? 'size-3.5 rotate-180' : 'size-3.5'} />
              {all ? 'Show fewer' : `Show ${rows.length - VISIBLE} more`}
            </button>
          )}
        </>
      )}
    </article>
  );
}

interface BarProps {
  session: string;
  picked: Map<string, Dropped>;
  onDone: () => void;
}

export function ActionBar({ session, picked, onDone }: BarProps) {
  const [busy, setBusy] = useState<'putback' | 'pin' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const count = picked.size;

  const act = async (kind: 'putback' | 'pin') => {
    setBusy(kind);
    setError(false);
    try {
      const seen = new Set<string>();
      let n = 0;
      for (const d of picked.values()) {
        const p = payload(session, d);
        const k = `${p.kind}:${p.label}:${p.text}`;
        if (seen.has(k)) continue;
        seen.add(k);
        await send(kind, p);
        n++;
      }
      setNote(kind === 'putback' ? `${n} queued for your next prompt.` : `${n} pinned for the next compaction.`);
      onDone();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  };

  const show = count > 0 || note || error;
  return (
    <div aria-live="polite" className={`pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-5 transition-[translate,opacity] duration-200 ease-out ${show ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}>
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-3 rounded-[1.4rem] border bg-popover py-2 pl-2 pr-4 text-popover-foreground shadow-[0_10px_30px_-12px_oklch(0.2_0.04_220/0.45)]">
        {count > 0 ? (
          <>
            <Button className="h-10 rounded-full bg-kelp px-5 text-[0.92rem] font-semibold text-kelp-ink hover:bg-kelp/85" disabled={!!busy} onClick={() => act('putback')}>
              <ArrowUUpLeft weight="bold" aria-hidden />
              {busy === 'putback' ? 'Putting back…' : `Put back ${count}`}
            </Button>
            <Button variant="ghost" className="h-10 rounded-full px-4 text-[0.92rem]" disabled={!!busy} onClick={() => act('pin')}>
              <PushPin aria-hidden />
              {busy === 'pin' ? 'Pinning…' : `Pin ${count}`}
            </Button>
            <span className="text-[0.85rem] text-muted-foreground">{error ? <span className="text-destructive">Saving failed, maybe because the claude-ctx server stopped.</span> : 'Put back goes in with your next prompt.'}</span>
          </>
        ) : (
          <span className="px-2 py-2 text-[0.88rem]">
            {error ? <span className="text-destructive">Saving failed, maybe because the claude-ctx server stopped.</span> : note}
            <button type="button" className="ml-3 text-sm font-medium underline underline-offset-4" onClick={() => { setNote(null); setError(false); }}>
              Close
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
