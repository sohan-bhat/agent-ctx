import { useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { canPutBack, day, headline, isPending, lines, originLine } from '@/lib/utils';
import type { Item, Project } from '@/lib/api';

export interface Actions {
  pin: (id: string, on: boolean) => Promise<void>;
  putBack: (id: string) => Promise<void>;
  keep: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function Panel({ item, queued, actions, headingId }: { item: Item; queued: boolean; actions?: Actions; headingId?: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    try {
      await f();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const [head, ...rest] = lines(item);
  const keepable = item.held || isPending(item);
  return (
    <div className="grid gap-3" data-panel={item.id}>
      <div className="grid gap-1.5">
        <h2 id={headingId} className="break-words text-[0.9375rem] font-bold leading-snug text-pretty">
          {head?.text}
        </h2>
        {rest.map((l, i) => (
          <p key={i} translate={l.mono ? 'no' : undefined} className={l.mono ? 'num break-words text-xs leading-relaxed' : 'break-words text-sm leading-snug text-pretty'}>
            {l.text}
          </p>
        ))}
        <p className="num mt-0.5 whitespace-pre-wrap text-xs">{originLine(item)}</p>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-h-11 items-center gap-2 sm:min-h-8">
            <Switch id={`pin-${item.id}`} checked={item.pinned} disabled={busy} onCheckedChange={(on) => void run(() => actions.pin(item.id, on))} />
            <Label htmlFor={`pin-${item.id}`} className="text-sm">
              Pin
            </Label>
          </div>
          {keepable && (
            <Button variant="outline" className="h-11 sm:h-8" disabled={busy} onClick={() => void run(() => actions.keep(item.id))}>
              Keep
            </Button>
          )}
          {canPutBack(item) &&
            !keepable &&
            (queued ? (
              <span className="text-sm font-semibold">Queued</span>
            ) : (
              <Button variant="outline" className="h-11 sm:h-8" disabled={busy} onClick={() => void run(() => actions.putBack(item.id))}>
                Put back
              </Button>
            ))}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="ml-auto h-11 sm:h-8" disabled={busy}>
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this item?</AlertDialogTitle>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="h-11 sm:h-8">Cancel</AlertDialogCancel>
                <AlertDialogAction className="h-11 bg-destructive text-background hover:bg-destructive/85 sm:h-8" onClick={() => void run(() => actions.remove(item.id))}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
      <p role="status" className="text-sm text-destructive empty:hidden">
        {failed ? 'Saving failed. Try again.' : ''}
      </p>
    </div>
  );
}

export function ItemList({ projects, agents, items, time, visible, onOpen }: { projects: Project[]; agents: string[]; items: Item[]; time: number; visible: boolean; onOpen: (id: string) => void }) {
  const shown = items.filter((i) => i.created <= time);
  const groups = projects
    .map((p) => {
      const mine = shown.filter((i) => i.project === p.key);
      const names = [...new Set(mine.map((i) => i.origin.agent))].sort((a, b) => agents.indexOf(a) - agents.indexOf(b));
      return { p, rows: names.map((name) => ({ name, list: mine.filter((i) => i.origin.agent === name).sort((a, b) => b.created - a.created) })) };
    })
    .filter((g) => g.rows.length);
  return (
    <div className={visible ? 'size-full overflow-y-auto overscroll-contain px-1 py-2' : 'sr-only'} data-list>
      {groups.map(({ p, rows }) => (
        <section key={p.key} aria-label={p.name} className="mb-6 [content-visibility:auto]">
          <h2 className="mb-2 text-[0.9375rem] font-bold">{p.name}</h2>
          {rows.map(({ name, list }) => (
            <div key={name} className="mb-3">
              <h3 translate="no" className="num mb-1 text-xs">
                {name === 'page' ? 'you' : name}
              </h3>
              <ul className="grid grid-cols-1">
                {list.map((i) => (
                  <li key={i.id}>
                    <button type="button" className="flex min-h-11 w-full items-baseline gap-3 rounded-sm px-1 text-left hover:bg-accent sm:min-h-8" onClick={() => onOpen(i.id)}>
                      <span className="min-w-0 flex-1 truncate">{headline(i)}</span>
                      <span className="num shrink-0 text-xs">{day(i.created)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
