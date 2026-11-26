import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ruleLine } from '@core/model.ts';
import { ApiError, type Item, type NewRule, type Project, type RuleBody } from '@/lib/api';
import { stamp, useNarrow } from '@/lib/utils';

export interface RuleActions {
  add: (rule: NewRule) => Promise<void>;
  set: (id: string, status: 'active' | 'off', line?: string) => Promise<void>;
  reload: () => Promise<void>;
}

export const lineOf = (i: Item) => i.line ?? ruleLine(i.body as RuleBody);

const body = (i: Item) => i.body as RuleBody;
const where = (i: Item, projects: Project[]) => (body(i).scope === 'all' ? 'all projects' : (projects.find((p) => p.key === i.project)?.name ?? 'this project'));

export function Rules({ open, onOpenChange, items, projects, actions, back }: { open: boolean; onOpenChange: (o: boolean) => void; items: Item[]; projects: Project[]; actions: RuleActions; back?: () => void }) {
  const narrow = useNarrow();
  const [text, setText] = useState('');
  const [scope, setScope] = useState('all');
  const [later, setLater] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [failed, setFailed] = useState(false);
  const [changed, setChanged] = useState(false);
  const rules = items.filter((i) => i.kind === 'rule').sort((a, b) => b.created - a.created);
  const pending = rules.filter((i) => body(i).status === 'pending').sort((a, b) => Number(later.has(a.id)) - Number(later.has(b.id)));
  const kept = rules.filter((i) => body(i).status !== 'pending');
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    setChanged(false);
    try {
      await f();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setChanged(true);
        await actions.reload().catch(() => {});
      } else setFailed(true);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) {
      input.current?.focus();
      return;
    }
    const rule: NewRule = scope === 'all' ? { text: t, scope: 'all' } : { text: t, scope: 'project', project: scope };
    if (await run(() => actions.add(rule))) setText('');
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={narrow ? 'bottom' : 'right'}
        className="max-h-[85dvh] gap-0 overflow-y-auto overscroll-contain text-sm sm:max-w-md"
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => {
          if (window.matchMedia('(pointer: coarse)').matches) e.preventDefault();
        }}
        onCloseAutoFocus={(e) => {
          if (!back) return;
          e.preventDefault();
          back();
        }}
      >
        <SheetHeader className="p-4 pb-2 pr-12">
          <SheetTitle className="text-[0.9375rem] font-bold">Rules</SheetTitle>
        </SheetHeader>
        <p role="status" className="px-4 pb-3 text-sm font-semibold empty:hidden" data-changed>
          {changed ? 'This rule changed. Read the rule again before you accept.' : ''}
        </p>
        {pending.length > 0 && (
          <ul className="grid gap-4 px-4 pb-5" aria-label="Pending">
            {pending.map((i) => (
              <li key={i.id} className="grid gap-2" data-pending={i.id}>
                <p className="break-words leading-snug" data-line>
                  {lineOf(i)}
                </p>
                <p className="num text-xs">
                  <span translate="no">{i.origin.agent}</span> {stamp(i.created)}, {where(i, projects)}
                </p>
                {later.has(i.id) ? (
                  <p className="text-sm font-semibold">Later</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button className="h-11 sm:h-8" disabled={busy} onClick={() => void run(() => actions.set(i.id, 'active', lineOf(i)))}>
                      Accept
                    </Button>
                    <Button variant="outline" className="h-11 sm:h-8" disabled={busy} onClick={() => void run(() => actions.set(i.id, 'off'))}>
                      Reject
                    </Button>
                    <Button variant="ghost" className="h-11 sm:h-8" disabled={busy} onClick={() => setLater((s) => new Set(s).add(i.id))}>
                      Later
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <ul className="grid gap-1 px-4 pb-5" aria-label="Rules">
          {kept.map((i) => (
            <li key={i.id} className="flex min-h-11 items-start justify-between gap-4 py-1" data-rule={i.id}>
              <label htmlFor={`rule-${i.id}`} className="grid gap-0.5">
                <span className="break-words leading-snug" data-line>
                  {lineOf(i)}
                </span>
                <span className="num text-xs">{where(i, projects)}</span>
              </label>
              <Switch id={`rule-${i.id}`} className="mt-0.5" checked={body(i).status === 'active'} disabled={busy} onCheckedChange={(on) => void run(() => actions.set(i.id, on ? 'active' : 'off', lineOf(i)))} />
            </li>
          ))}
        </ul>
        <form onSubmit={submit} className="mt-auto grid gap-2.5 border-t p-4">
          <Input ref={input} name="rule" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} aria-label="New rule" placeholder="Run the tests before each commit…" maxLength={300} className="h-11 text-sm sm:h-9" />
          <ToggleGroup type="single" variant="outline" spacing={0} value={scope} onValueChange={(v) => v && setScope(v)} className="max-w-full flex-wrap" aria-label="Projects for the new rule">
            {projects.map((p) => (
              <ToggleGroupItem key={p.key} value={p.key} className="h-11 px-3 text-[0.8125rem] sm:h-8">
                {p.name}
              </ToggleGroupItem>
            ))}
            <ToggleGroupItem value="all" className="h-11 px-3 text-[0.8125rem] sm:h-8">
              All projects
            </ToggleGroupItem>
          </ToggleGroup>
          <Button type="submit" variant="outline" className="h-11 justify-self-start sm:h-9" disabled={busy}>
            Add
          </Button>
          <p role="status" className="text-sm text-destructive empty:hidden">
            {failed ? 'Saving failed. Try again.' : ''}
          </p>
        </form>
      </SheetContent>
    </Sheet>
  );
}
