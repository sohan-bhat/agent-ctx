import { useState } from 'react';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
          <AlertDialogTitle className="text-[0.9375rem] font-bold">Delete account?</AlertDialogTitle>
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
            Delete account
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
