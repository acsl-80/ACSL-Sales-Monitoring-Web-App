import { useCallback, useEffect, useState } from "react";
import { dataCenterImport, DataCenterError } from "../../lib/client";
import { plural } from "../../lib/plural";
import { usePeriod } from "../../lib/usePeriod";
import CallSheetsTable from "./CallSheetsTable";
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
 * Every call sheet that has been uploaded, and what each one still needs.
 *
 * WHY THIS EXISTS
 *
 * The call sheet held its batch in `useState` and nothing else. Close the tab
 * and a staged batch became unreachable: it was not in this panel because
 * there was no panel, and it was not in the receipt panel either once that
 * started filtering by source. Work that had been uploaded but not attached
 * simply disappeared from view while continuing to exist in the database.
 *
 * AND THE GAP IT CLOSES
 *
 * The reasons `validateCallRows` writes were rendered nowhere until AFTER a
 * commit. The receipt panel's whole premise is the opposite - see what is
 * wrong while it is still cheap to fix - and that premise was missing on this
 * side entirely. Exceptions are now grouped and readable the moment a sheet is
 * checked, and they can leave as a correction file.
 *
 * SPLIT FROM ITS OWN RENDERING (import redesign, 2026-09-07)
 *
 * This file keeps the batch list, the period, the polling and every client
 * call. `CallSheetsTable` turns that into the card, the chips, the table (or a
 * stack of cards on a phone) and the exceptions underneath; it renders from
 * props and calls back rather than holding a state machine of its own.
 */

const CALL_SOURCE = "call_center";

export default function CallBatches({ canCommit, canResolve = false, reloadKey = 0, onChanged }) {
  const [batches, setBatches] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(null);
  const { period, setPeriod, resolved, earliest } = usePeriod("/data-center/import");

  const refresh = useCallback(async () => {
    try {
      const all = await dataCenterImport.batches({
        ...(resolved.dateFrom ? { dateFrom: resolved.dateFrom } : {}),
        ...(resolved.dateTo ? { dateTo: resolved.dateTo } : {}),
      });
      setBatches(all.filter((b) => b.source === CALL_SOURCE));
      setError(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not load call batches.");
      setBatches([]);
    }
  }, [resolved.dateFrom, resolved.dateTo]);

  useEffect(() => {
    refresh();
  }, [refresh, reloadKey]);

  /*
   * Keep the list fresh while a chain is working.
   *
   * The second clause matters as much as the first: between links the lease
   * clears for a breath, so a page that only watched `committing` would freeze
   * on stale numbers the moment it mounted inside that gap.
   */
  useEffect(() => {
    const live = (batches ?? []).some(
      (b) => b.committing || (b.state === "validated" && b.valid_rows > 0 && b.committed_rows > 0),
    );
    if (!live) return undefined;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [batches, refresh]);

  const run = async (kind, batchId) => {
    setBusy(batchId);
    setError(null);
    setNotice(null);
    try {
      if (kind === "validate") {
        const out = await dataCenterImport.callValidate(batchId);
        setNotice(
          `${plural(out.valid, "row is", "rows are")} ready` +
            (out.updating ? ` (${out.updating} updating an existing record)` : "") +
            (out.exceptions ? `, ${plural(out.exceptions, "needs", "need")} a person` : "") +
            (out.rejected ? `, ${plural(out.rejected, "could not be read")}` : "") +
            ".",
        );
      } else if (kind === "commit") {
        const kick = await dataCenterImport.callCommit(batchId);
        if (kick.stopped) {
          setError("The run hit its safety cap. Press Attach again to carry on.");
        } else {
          setNotice(
            "Attaching on the server. This continues without the page, and the " +
              "numbers below update as it goes.",
          );
        }
      } else if (kind === "undo") {
        const out = await dataCenterImport.callRollback(batchId);
        setNotice(
          `${plural(out.reversed, "call record")} removed.` +
            (out.notReversed
              ? ` ${plural(out.notReversed, "row")} updated a record that already existed, ` +
                "and those cannot be undone this way."
              : ""),
        );
      } else if (kind === "discard") {
        await dataCenterImport.callDiscard(batchId);
        setNotice("That batch has been cleared away.");
      }
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "That did not go through.");
    } finally {
      setBusy("");
    }
  };

  const confirmText = (() => {
    if (!pending) return null;
    const b = pending.batch;
    if (pending.kind === "commit") {
      return {
        title: `Attach ${b.valid_rows} call ${b.valid_rows === 1 ? "record" : "records"}?`,
        body:
          "This writes to records the call centre reads. Rows updating a record that " +
          "already exists will replace what it currently says. Undo removes only the " +
          "records this sheet created.",
      };
    }
    if (pending.kind === "undo") {
      return {
        title: `Undo ${b.committed_rows} attached ${b.committed_rows === 1 ? "record" : "records"}?`,
        body:
          "The call records this sheet created are deleted. The sales are untouched. " +
          "Rows that updated a record somebody else had already worked cannot be " +
          "undone this way and stay as they are.",
      };
    }
    return {
      title: "Clear this batch away?",
      body: `${plural(b.total_rows, "staged row")} are removed. Nothing has been attached from this batch, so nothing in the call centre changes.`,
    };
  })();

  return (
    <>
      <CallSheetsTable
        batches={batches}
        busy={busy}
        error={error}
        notice={notice}
        canCommit={canCommit}
        canResolve={canResolve}
        period={period}
        setPeriod={setPeriod}
        earliest={earliest}
        onValidate={(batchId) => run("validate", batchId)}
        onCommitRequest={(b) => setPending({ kind: "commit", batch: b })}
        onUndoRequest={(b) => setPending({ kind: "undo", batch: b })}
        onDiscardRequest={(b) => setPending({ kind: "discard", batch: b })}
        onResolved={refresh}
      />

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent data-area="import">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmText?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmText?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const p = pending;
                setPending(null);
                if (p) run(p.kind, p.batch.id);
              }}
            >
              {pending?.kind === "commit"
                ? "Attach them"
                : pending?.kind === "undo"
                  ? "Undo"
                  : "Clear it"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
