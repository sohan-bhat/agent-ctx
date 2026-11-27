import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { address, PRODUCTS, type Product, type Step } from '@/agents';
import { api, ApiError } from '@/lib/api';
import { found, labelOf, planFor, write, type Found, type Plan } from '@/lib/local';

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyLine({ step, at, onUse }: { step: Extract<Step, { type: 'copy' }>; at: string; onUse: () => void }) {
  const text = step.text(at);
  const [done, setDone] = useState(false);
  return (
    <div className="grid gap-1.5">
      <p className="text-sm">{step.label}</p>
      <code translate="no" className="num select-all whitespace-pre-wrap break-normal rounded-sm bg-field px-2.5 py-2 text-xs leading-relaxed [overflow-wrap:normal]">{text}</code>
      <Button
        variant="outline"
        className="h-11 w-[5.5rem] justify-self-start sm:h-9"
        aria-live="polite"
        onClick={async () => {
          onUse();
          setDone(await copy(text));
        }}
      >
        {done ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

function OpenStep({ step, at, onUse }: { step: Extract<Step, { type: 'open' }>; at: string; onUse: () => void }) {
  const href = step.href(at);
  const web = href.startsWith('https:');
  return (
    <Button asChild size="lg" className="h-11 justify-self-start rounded-full px-5 text-[0.9375rem]">
      <a
        href={href}
        target={web ? '_blank' : undefined}
        rel={web ? 'noreferrer' : undefined}
        data-href={href}
        onClick={() => {
          onUse();
          if (step.copy) void copy(at);
        }}
      >
        {step.label}
      </a>
    </Button>
  );
}

function Path({ product, onBack }: { product: Product; onBack: () => void }) {
  const at = address();
  const use = () => api.hint(product.label);
  return (
    <div className="grid gap-4 p-4 pt-3" data-path={product.id}>
      <div className="flex items-center gap-1.5 pr-8">
        <Button variant="ghost" size="icon" className="-ml-2 size-11 sm:size-8" aria-label="All agents" onClick={onBack}>
          <ArrowLeftIcon />
        </Button>
        <DialogTitle className="text-[0.9375rem] font-bold">{product.label}</DialogTitle>
      </div>
      {product.path.map((s, i) =>
        s.type === 'open' ? (
          <OpenStep key={i} step={s} at={at} onUse={use} />
        ) : s.type === 'copy' ? (
          <CopyLine key={i} step={s} at={at} onUse={use} />
        ) : (
          <ol key={i} className="grid list-decimal gap-1 pl-5 text-sm marker:font-mono marker:text-xs">
            {s.items.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

export function AddAgent({ open, onOpenChange, back }: { open: boolean; onOpenChange: (open: boolean) => void; back?: () => void }) {
  const [chosen, setChosen] = useState<Product | null>(null);
  useEffect(() => {
    if (!open) setChosen(null);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[12dvh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-md"
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
        {chosen ? (
          <Path product={chosen} onBack={() => setChosen(null)} />
        ) : (
          <Command className="bg-popover" label="Agent products">
            <DialogTitle className="px-4 pb-2 pt-4 text-[0.9375rem] font-bold">Add agent</DialogTitle>
            <div className="px-2">
              <CommandInput placeholder="Search…" aria-label="Search agents" className="text-sm" />
            </div>
            <CommandList className="max-h-[60dvh] p-2">
              <CommandEmpty className="py-4 text-sm">No match</CommandEmpty>
              {PRODUCTS.map((p) => (
                <CommandItem key={p.id} value={p.label} onSelect={() => setChosen(p)} className="min-h-11 rounded-sm px-2.5 text-sm sm:min-h-9" data-product={p.id}>
                  {p.label}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function Agents({ open, onOpenChange, back }: { open: boolean; onOpenChange: (open: boolean) => void; back?: () => void }) {
  const [list, setList] = useState<Found[] | null>(null);
  const [chosen, setChosen] = useState<{ id: string; plan: Plan } | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [failed, setFailed] = useState('');
  const load = useCallback(async () => {
    try {
      setList(await found());
    } catch {
      setFailed('The agents could not be read. Try again.');
    }
  }, []);
  useEffect(() => {
    setChosen(null);
    setSaid('');
    setFailed('');
    if (open) void load();
  }, [open, load]);
  const run = async (f: () => Promise<void>, miss: string) => {
    setBusy(true);
    setFailed('');
    try {
      await f();
    } catch (e) {
      setFailed(e instanceof ApiError && e.status === 409 ? 'These changes are different now. Read the lines again.' : miss);
      if (chosen && e instanceof ApiError && e.status === 409) setChosen({ id: chosen.id, plan: await planFor(chosen.id).catch(() => chosen.plan) });
    } finally {
      setBusy(false);
    }
  };
  const choose = (id: string) =>
    run(async () => {
      setSaid('');
      setChosen({ id, plan: await planFor(id) });
    }, 'The agents could not be read. Try again.');
  const go = ({ id, plan }: { id: string; plan: Plan }) =>
    run(
      async () => {
        const { connected } = await write(id, !plan.connected, plan.lines);
        await load();
        setChosen(null);
        setSaid(connected ? `Open a new session in ${labelOf(id)} so the memory is loaded.` : '');
      },
      plan.connected ? 'Disconnecting failed. Try again.' : 'Connecting failed. Try again.',
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[12dvh] max-h-[70dvh] translate-y-0 gap-0 overflow-y-auto overscroll-contain p-0 sm:max-w-md"
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
        {chosen ? (
          <div className="grid grid-cols-1 gap-4 p-4 pt-3" data-plan={chosen.id}>
            <div className="flex items-center gap-1.5 pr-8">
              <Button variant="ghost" size="icon" className="-ml-2 size-11 sm:size-8" aria-label="All agents" onClick={() => setChosen(null)}>
                <ArrowLeftIcon />
              </Button>
              <DialogTitle translate="no" className="text-[0.9375rem] font-bold">
                {labelOf(chosen.id)}
              </DialogTitle>
            </div>
            {chosen.plan.command ? (
              <CopyLine step={{ type: 'copy', label: 'Type this command in a terminal', text: () => chosen.plan.command ?? '' }} at="" onUse={() => {}} />
            ) : (
              <ul className="grid grid-cols-1 gap-2 text-sm" data-lines>
                {chosen.plan.lines.map((line) => (
                  <li key={line} className="break-words leading-snug">
                    {line}
                  </li>
                ))}
              </ul>
            )}
            {chosen.plan.ready && (
              <Button size="lg" className={`h-11 justify-self-start rounded-full px-5 text-[0.9375rem] ${chosen.plan.connected ? 'bg-destructive text-background hover:bg-destructive/85' : ''}`} disabled={busy} onClick={() => void go(chosen)}>
                {chosen.plan.connected ? 'Disconnect' : 'Connect'}
              </Button>
            )}
            <p role="status" className="text-sm text-destructive empty:hidden">
              {failed}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 p-4" aria-busy={!list}>
            <DialogTitle className="pr-8 text-[0.9375rem] font-bold">Agents on this computer</DialogTitle>
            <ul className="grid">
              {(list ?? []).map((a) => (
                <li key={a.id} className="flex min-h-11 items-center justify-between gap-4 py-1 sm:min-h-9" data-found={a.id} data-connected={a.connected ? '1' : '0'}>
                  <span translate="no" className="min-w-0 truncate text-sm">
                    {labelOf(a.id)}
                  </span>
                  <Button variant={a.connected ? 'outline' : 'default'} className="h-11 min-w-[96px] px-2.5 sm:h-8" disabled={busy} onClick={() => void choose(a.id)}>
                    {a.connected ? 'Disconnect' : 'Connect'}
                  </Button>
                </li>
              ))}
            </ul>
            <p className="text-sm empty:hidden">{list && !list.length ? 'No agent was found on this computer.' : ''}</p>
            <p role="status" className="text-sm empty:hidden" data-said>
              {said}
            </p>
            <p role="status" className="text-sm text-destructive empty:hidden">
              {failed}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
