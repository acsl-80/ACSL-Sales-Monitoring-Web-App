import { useEffect, useState } from "react";
import { AlertTriangle, Eye, Play, Trash2, Undo2, X } from "lucide-react";
import { dataCenterImport } from "../../lib/client";
import { plural } from "../../lib/plural";
import ExceptionsTable from "./ExceptionsTable";
import RejectedRows from "./RejectedRows";

/**
 * One file, opened under its own row.
 *
 * Everything that used to hide behind a chevron: what a commit would do, the
 * rows that need a person, the rows that could not be read at all, and the two
 * irreversible actions with their rules. The rules are the server's and are
 * unchanged here - Discard only while nothing has landed, Roll back only after
 * something has - because they are about what exists, not about what is drawn.
 */

/**
 * Stoves in this batch sharing a phone number with another stove.
 *
 * One household, one number, two stoves is ordinary and allowed - so these
 * rows are valid and never reach the exceptions queue. A mistyped digit
 * repeated across a batch is also valid, and looks identical, so the only
 * useful thing the system can do is put the two in front of the person who
 * can tell them apart before anything commits.
 *
 * Amber rather than red on purpose: nothing here is wrong yet.
 */
function SharedPhoneRows({ batchId }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let live = true;
    dataCenterImport
      .sharedPhoneRows(batchId)
      .then((r) => live && setRows(r))
      // A flag that could not be loaded must not take the batch down with it.
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [batchId]);

  if (!rows || rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
        <AlertTriangle className="h-4 w-4" />
        {rows.length === 1
          ? "One stove here shares a telephone number with another"
          : `${rows.length} stoves here share a telephone number with another`}
      </p>
      <p className="mt-0.5 text-xs text-amber-800">
        Allowed: a household can buy more than one. Check these are a family and
        not the same number typed twice. Nothing is blocked either way.
      </p>
      <ul className="mt-2 space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 text-sm text-amber-900">
            <span className="text-xs text-amber-700">row {r.row_number}</span>
            <span className="font-mono font-medium">{r.stove_serial_no ?? "-"}</span>
            <span className="text-xs">shares with</span>
            {(r.shared_phone_with ?? []).map((other) => (
              <span
                key={other}
                className="rounded border border-amber-400 bg-white px-1.5 py-0.5 font-mono text-xs"
              >
                {other}
              </span>
            ))}
            {r.normalized?.phone ? (
              <span className="text-xs text-amber-700">on {String(r.normalized.phone)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function FileDetail({
  batch: b,
  busy,
  canUpload,
  canCommit,
  canResolve,
  dryRun,
  onDryRun,
  onDryRunDismiss,
  /** Ask for one of the three confirmed actions: commit, discard, rollback. */
  onAsk,
  onChanged,
}) {
  const unreadable = Math.max(0, (b.rejected_rows ?? 0) - (b.exception_rows ?? 0));
  const checked =
    (b.valid_rows ?? 0) + (b.exception_rows ?? 0) + (b.rejected_rows ?? 0) +
    (b.committed_rows ?? 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-semibold text-gray-900">
          {b.filename ?? "(typed in, no file)"}
        </span>
        {/* The batch in one line, in the words the columns above use. */}
        <span className="text-xs text-gray-600">
          read {b.total_rows} · checked {checked} · {b.exception_rows} need a look ·{" "}
          {unreadable} unreadable · {b.committed_rows} landed
        </span>
      </div>

      {b.last_error && (
        <p className="rounded-md bg-(--dc-sev-critical-soft) px-3 py-2 text-sm text-(--dc-sev-critical)">
          {b.last_error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {canUpload && b.state !== "committed" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDryRun(b.id)}
            className="inline-flex items-center gap-1 rounded-md border border-(--dc-brief-stove) px-2.5 py-1.5 text-xs font-medium text-(--dc-brief-stove) transition hover:bg-(--dc-brief-stove-soft) disabled:opacity-50"
          >
            {/* "Dry run" is the code's word. This is what it does. */}
            <Eye className="h-3.5 w-3.5" /> Show what a commit would do
          </button>
        )}
        {canCommit && b.valid_rows > 0 && b.state !== "committed" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAsk("commit", b)}
            className="inline-flex items-center gap-1 rounded-md bg-(image:--dc-fig-sold) px-2.5 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" /> Commit {b.valid_rows}
          </button>
        )}
        {/*
          Discard, for a batch that never wrote a sale.

          Deliberately NOT offered once anything has committed: that is
          rollback's job, and rollback removes each sale through delete-sale so
          its stove is released. The server enforces the same rule by the
          sale_id column rather than by the status label, so a crash-window row
          still routes to rollback.
        */}
        {canCommit && b.committed_rows === 0 && b.state !== "committed" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAsk("discard", b)}
            className="inline-flex items-center gap-1 rounded-md border border-(--dc-accent) px-2.5 py-1.5 text-xs font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Discard
          </button>
        )}
        {canCommit && b.committed_rows > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAsk("rollback", b)}
            className="inline-flex items-center gap-1 rounded-md border border-(--dc-accent) px-2.5 py-1.5 text-xs font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60 disabled:opacity-50"
          >
            <Undo2 className="h-3.5 w-3.5" /> Roll back {b.committed_rows}
          </button>
        )}
      </div>

      {dryRun && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 ring-1 ring-inset ring-amber-200">
          <div className="mb-1 flex items-center gap-2">
            <Eye className="h-4 w-4 text-amber-700" />
            <h3 className="text-sm font-semibold text-amber-900">What a commit would do</h3>
            <button
              type="button"
              onClick={onDryRunDismiss}
              aria-label="Dismiss the dry run"
              className="ml-auto rounded p-0.5 text-amber-700 hover:bg-amber-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-sm text-amber-900">{dryRun.note}</p>
          <p className="mt-2 text-sm text-amber-900">
            {plural(dryRun.stovesThatWouldSell.length, "stove")} would move from available to sold.
          </p>
          {dryRun.stovesThatWouldSell.length > 0 && (
            <p className="mt-1 break-words font-mono text-xs text-amber-800">
              {dryRun.stovesThatWouldSell.slice(0, 40).join(", ")}
              {dryRun.stovesThatWouldSell.length > 40 ? " ..." : ""}
            </p>
          )}
        </div>
      )}

      {b.exception_rows > 0 && (
        <ExceptionsTable
          batchId={b.id}
          count={b.exception_rows}
          canResolve={canResolve}
          onChanged={onChanged}
        />
      )}

      {/* The refused rows, which were counted here and shown nowhere. A batch
          said "12 unreadable" and the only way to find out which twelve was to
          open the spreadsheet and guess. */}
      {unreadable > 0 && (
        <div className="rounded-lg border border-gray-200 p-3">
          <RejectedRows batchId={b.id} count={unreadable} />
        </div>
      )}

      <SharedPhoneRows batchId={b.id} />
    </div>
  );
}
