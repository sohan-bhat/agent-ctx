import { useRef, useState } from 'react';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { Agent } from '@/lib/api';

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
