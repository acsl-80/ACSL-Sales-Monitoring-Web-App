import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * The one shape an "are you sure" takes in this module.
 *
 * Slice 7b of the 2026-09-02 review (finding F19). Five levers went straight
 * through on one click: clearing somebody's unfinished form, moving a record
 * onto another stove, running the assignment, reclaiming quiet batches and
 * moving records between agents. Unassign alone asked first, with this
 * shape. Now they all do, through one component, so a question reads the
 * same wherever it is asked: what will happen, a way out that does nothing,
 * and one action named for what it does.
 *
 * Cancel never has a side effect. The action calls back and leaves closing
 * to the caller, so a caller that wants to stay open on failure can.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  cancelLabel = "Cancel",
  actionLabel = "Continue",
  busy = false,
  destructive = false,
  onCancel,
  onConfirm,
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel?.();
      }}
    >
      <AlertDialogContent className="dc-root" data-area="call-centre">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className={destructive ? "bg-red-600 text-white hover:bg-red-700" : undefined}
            onClick={(e) => {
              e.preventDefault();
              onConfirm?.();
            }}
          >
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
