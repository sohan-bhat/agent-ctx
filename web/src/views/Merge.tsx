import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Project } from '@/lib/types';

function Pick({ id, label, value, onChange, projects, other }: { id: string; label: string; value: string; onChange: (v: string) => void; projects: Project[]; other: string }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-11 w-full text-sm data-[size=default]:h-11 sm:data-[size=default]:h-9" data-merge={id}>
          <SelectValue placeholder="Choose a project" />
        </SelectTrigger>
        <SelectContent position="popper" className="text-sm">
          {projects.map((p) => (
            <SelectItem key={p.key} value={p.key} disabled={p.key === other} className="min-h-11 text-sm sm:min-h-8" translate="no">
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function Merge({ open, onOpenChange, projects, onMerge, back }: { open: boolean; onOpenChange: (o: boolean) => void; projects: Project[]; onMerge: (from: string, into: string) => Promise<void>; back?: () => void }) {
  const [from, setFrom] = useState('');
  const [into, setInto] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) {
      setFrom('');
      setInto('');
      setFailed(false);
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-4 p-4 text-sm sm:max-w-sm"
        aria-describedby={undefined}
        onCloseAutoFocus={(e) => {
          if (!back) return;
          e.preventDefault();
          back();
        }}
      >
        <DialogTitle className="text-[0.9375rem] font-bold">Merge projects</DialogTitle>
        <Pick id="merge-from" label="From" value={from} onChange={setFrom} projects={projects} other={into} />
        <Pick id="merge-into" label="Into" value={into} onChange={setInto} projects={projects} other={from} />
        <p role="status" className="text-destructive empty:hidden">
          {failed ? 'Merging failed. Try again.' : ''}
        </p>
        <Button
          className="h-11 justify-self-start sm:h-9"
          disabled={!from || !into || from === into || busy}
          onClick={async () => {
            setBusy(true);
            setFailed(false);
            try {
              await onMerge(from, into);
              onOpenChange(false);
            } catch {
              setFailed(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          Merge
        </Button>
      </DialogContent>
    </Dialog>
  );
}
