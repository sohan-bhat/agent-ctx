import { useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { canPutBack, isPending, lines, originLine } from '@/lib/item';
import type { Item } from '@/lib/types';

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
