import { useEffect, useRef, useState } from 'react';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Agent, Project } from '@/lib/api';

export function AgentMenu({ agent, seen, onDisconnect }: { agent: Agent; seen: string; onDisconnect: (a: Agent) => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button ref={trigger} type="button" className="-mx-1 inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-sm px-1 text-left hover:bg-accent sm:min-h-7">
            <span translate="no" className="truncate">
              {agent.label}
            </span>
            <span className="num inline-block min-w-[3ch] shrink-0 text-xs">{seen}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="text-sm">
          <DropdownMenuItem className="min-h-11 text-sm text-destructive focus:text-destructive sm:min-h-8" onSelect={() => setAsking(true)}>
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        open={asking}
        onOpenChange={(o) => {
          setAsking(o);
          if (!o) setFailed(false);
        }}
      >
        <AlertDialogContent
          className="text-sm"
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            if (!trigger.current?.isConnected) return;
            e.preventDefault();
            trigger.current.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[0.9375rem] font-bold">
              Disconnect <span translate="no">{agent.label}</span>?
            </AlertDialogTitle>
          </AlertDialogHeader>
          <p role="status" className="text-destructive empty:hidden">
            {failed ? 'Disconnecting failed. Try again.' : ''}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 sm:h-8">Cancel</AlertDialogCancel>
            <Button
              className="h-11 bg-destructive text-background hover:bg-destructive/85 sm:h-8"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setFailed(false);
                try {
                  await onDisconnect(agent);
                  setAsking(false);
                } catch {
                  setFailed(true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Disconnect
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function DeleteAccount({ open, onOpenChange, onDelete, back }: { open: boolean; onOpenChange: (o: boolean) => void; onDelete: () => Promise<void>; back?: () => void }) {
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ready = word.trim().toLowerCase() === 'delete';
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setWord('');
          setFailed(false);
        }
        onOpenChange(o);
      }}
    >
      <AlertDialogContent
        className="text-sm"
        aria-describedby={undefined}
        onCloseAutoFocus={(e) => {
          if (!back) return;
          e.preventDefault();
          back();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[0.9375rem] font-bold">{import.meta.env.MODE === 'page' ? 'Delete memory?' : 'Delete account?'}</AlertDialogTitle>
        </AlertDialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="confirm-delete" className="text-sm">
            Type delete to confirm
          </Label>
          <Input id="confirm-delete" name="confirm" value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" spellCheck={false} className="h-11 text-sm sm:h-9" />
        </div>
        <p role="status" className="text-destructive empty:hidden">
          {failed ? 'Deleting failed. Try again.' : ''}
        </p>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 sm:h-8">Cancel</AlertDialogCancel>
          <Button
            className="h-11 bg-destructive text-background hover:bg-destructive/85 sm:h-8"
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              setFailed(false);
              try {
                await onDelete();
              } catch {
                setFailed(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {import.meta.env.MODE === 'page' ? 'Delete memory' : 'Delete account'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

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
