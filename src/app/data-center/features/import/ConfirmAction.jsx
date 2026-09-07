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
import { plural } from "../../lib/plural";

/**
 * What the three irreversible actions are about to do, in the module's own
 * voice rather than the browser's.
 *
 * Commit and roll back both change the sales app's inventory, which is the
 * reason they are confirmed at all. Compact and centred: a two-button question
 * stretched to fill the screen reads as an error, not a question.
 *
 * The decision stays in ImportPanel - this file only says it out loud. It is
 * handed the same `pending` object the panel holds and hands back a press.
 */

const NUMBER = new Intl.NumberFormat("en-NG");

export function confirmCopy(pending) {
  if (pending?.kind === "commit") {
    return {
      title: `Commit ${plural(pending.count, "record")}?`,
      body: `This creates ${plural(pending.count, "sale")} and marks ${
        plural(pending.count, "stove")} sold. The sales app's inventory figures will change.`,
      action: `Commit ${NUMBER.format(pending.count)}`,
    };
  }
  if (pending?.kind === "discard") {
    return {
      title: "Discard this batch?",
      body: pending.count > 0
        ? `${plural(pending.count, "part-typed record")} will be thrown away. No sales are ` +
          "affected - this batch never wrote any."
        : "This clears the batch off the list. No sales are affected - it never wrote any.",
      action: "Discard",
    };
  }
  if (!pending) return null;
  return {
    title: `Roll back ${plural(pending.count, "record")}?`,
    body: `This deletes ${plural(pending.count, "sale")} and puts ${
      plural(pending.count, "stove")} back to available.`,
    action: `Roll back ${NUMBER.format(pending.count)}`,
  };
}

export default function ConfirmAction({ pending, onCancel, onConfirm }) {
  const copy = confirmCopy(pending);
  return (
    <AlertDialog open={!!pending} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <AlertDialogContent className="dc-root" data-area="import">
        <AlertDialogHeader>
          <AlertDialogTitle>{copy?.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy?.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={
              pending?.kind === "rollback"
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-(--dc-accent) text-white hover:bg-(--dc-accent-strong)"
            }
          >
            {copy?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
