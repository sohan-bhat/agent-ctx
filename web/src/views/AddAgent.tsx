import { useEffect, useState } from 'react';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { address, PRODUCTS, type Product, type Step } from '@/agents';
import { api } from '@/lib/api';

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
      <code className="num select-all whitespace-pre-wrap break-normal rounded-sm bg-field px-2.5 py-2 text-xs leading-relaxed [overflow-wrap:normal]">{text}</code>
      <Button
        variant="outline"
        className="h-11 w-[5.5rem] justify-self-start sm:h-9"
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

export function AddAgent({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [chosen, setChosen] = useState<Product | null>(null);
  useEffect(() => {
    if (!open) setChosen(null);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[12dvh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-md" aria-describedby={undefined}>
        {chosen ? (
          <Path product={chosen} onBack={() => setChosen(null)} />
        ) : (
          <Command className="bg-popover" label="Agent products">
            <DialogTitle className="px-4 pb-2 pt-4 text-[0.9375rem] font-bold">Add agent</DialogTitle>
            <div className="px-2">
              <CommandInput placeholder="Search" aria-label="Search agents" className="text-sm" />
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
