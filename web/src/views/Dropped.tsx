import { useMemo, useState } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { send, type Compaction, type Dropped, type Item } from '@/lib/api';
import { rel, tokens } from '@/lib/format';

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

function detail(d: Dropped): string {
  if (d.kind === 'decision') return 'Decision from a prompt';
  if (d.kind === 'edit') return d.runs && d.runs > 1 ? `Edited ${d.runs} times` : 'Edited once';
  if (d.kind === 'file') return `File read, ${tokens(d.tok)} tokens`;
  const runs = d.runs && d.runs > 1 ? `ran ${d.runs} times` : 'ran once';
  return `Command output${d.error ? ' with an error' : ''}, ${runs}`;
}

const TEXT_BUTTON = 'text-[0.8125rem] font-semibold underline decoration-foreground/35 underline-offset-4 transition-colors duration-150 hover:decoration-foreground disabled:opacity-50';

interface Props {
  session: string;
  root?: string;
  c: Compaction;
  queued: Item[];
  pins: Item[];
  onDone: () => void;
}

export function DroppedList({ session, root, c, queued, pins, onDone }: Props) {
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const state = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of c.dropped) {
      if (queued.some((q) => matches(q, d))) m.set(d.id, 'Queued for your next prompt');
      else if (pins.some((p) => matches(p, d))) m.set(d.id, 'Pinned');
    }
    return m;
  }, [c.dropped, queued, pins]);

  const act = async (kind: 'putback' | 'pin', d: Dropped) => {
    setBusy(`${kind}:${d.id}`);
    setFailed(false);
    try {
      await send(kind, payload(session, d));
      onDone();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  const rows = all ? c.dropped : c.dropped.slice(0, VISIBLE);

  return (
    <div>
      {c.summary && (
        <Collapsible>
          <CollapsibleTrigger className="group inline-flex items-center gap-1.5 text-sm font-semibold underline decoration-foreground/35 underline-offset-4 transition-colors duration-150 hover:decoration-foreground">
            <CaretDown aria-hidden className="size-3.5 transition-transform duration-150 group-data-[state=open]:rotate-180" />
            Read the summary
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="mt-2 max-w-[68ch] whitespace-pre-line text-sm leading-relaxed">{c.summary}</p>
          </CollapsibleContent>
        </Collapsible>
      )}

      <h3 className="mt-6 text-[0.9375rem] font-semibold">Left out of the summary</h3>
      {c.dropped.length === 0 ? (
        <p className="mt-2 text-sm">The summary names every tracked item.</p>
      ) : (
        <>
          <ul className="mt-2 grid">
            {rows.map((d) => {
              const st = state.get(d.id);
              const label = d.kind === 'decision' ? d.text : d.kind === 'command' ? d.label : rel(d.label, root);
              return (
                <li key={d.id} className="flex flex-col gap-x-6 gap-y-1 py-2 sm:flex-row sm:items-baseline">
                  <div className="min-w-0 flex-1">
                    <p className={d.kind === 'decision' ? 'font-medium' : 'num break-all text-[0.8125rem] font-medium'}>{label}</p>
                    <p className="text-xs text-muted-foreground">{detail(d)}</p>
                  </div>
                  <div className="flex shrink-0 items-baseline gap-4">
                    {st ? (
                      <span className="text-xs text-muted-foreground">{st}</span>
                    ) : (
                      <>
                        <button type="button" className={TEXT_BUTTON} disabled={!!busy} onClick={() => void act('putback', d)}>
                          {busy === `putback:${d.id}` ? 'Putting back…' : 'Put back'}
                        </button>
                        <button type="button" className={TEXT_BUTTON} disabled={!!busy} onClick={() => void act('pin', d)}>
                          {busy === `pin:${d.id}` ? 'Pinning…' : 'Pin'}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {c.dropped.length > VISIBLE && (
            <button type="button" className={`mt-2 ${TEXT_BUTTON}`} onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show ${c.dropped.length - VISIBLE} more`}
            </button>
          )}
          <p aria-live="polite" className="mt-2 text-sm text-destructive">
            {failed ? 'Saving failed, maybe because the agent-ctx server stopped.' : ''}
          </p>
        </>
      )}
    </div>
  );
}
