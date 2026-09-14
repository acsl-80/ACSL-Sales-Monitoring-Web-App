import { useEffect, useMemo, useState } from "react";
import Link from "@/compat/Link";
import { dataCenterCorrections, DataCenterError } from "../../lib/client";
import { EDITABLE, byKey } from "../corrections/lib/saleFields";
import { dateOf } from "../../lib/when";
import { Loader2, Undo2, Users, AlertTriangle, ArrowRight, ChevronDown, ChevronUp } from "lucide-react";

/**
 * Hand a record back to Sales, from inside the call editor.
 *
 * Every active reason is a chip, so the agent sees the whole list without
 * opening anything. Picking a reason pre-ticks the fields Settings maps to it
 * (`corrections.reason_fields`); the agent ticks anything else the receipt
 * got wrong, and Sales sees exactly those marked on the record. The note is
 * required for "something else". Who will receive it is said before it goes,
 * from the same route the server will stamp.
 *
 * While an episode is live the same panel shows its state, the disputed
 * fields, who has it and the fix note, and offers Withdraw; once Sales has
 * fixed it the door to the review is right here.
 *
 * Only fields the fix surface can act on are offered: the editable catalogue
 * plus the stove ID, which has its own rematch. Marking a signature disputed
 * would leave the rep a mark and no control.
 */

/** The fields a receipt usually gets wrong, offered first. */
const PRIMARY = [
  "phone", "other_phone", "end_user_name", "full_address", "state_backup", "lga_backup",
  "amount", "total_paid", "stove_serial_no",
];

const STATE_WORD = { open: "Waiting on Sales", fixed: "Fixed, awaiting review" };
const STATE_TONE = { open: "bg-red-100 text-red-800", fixed: "bg-amber-100 text-amber-900" };

function Chip({ kind, on, disabled, children, onClick }) {
  return (
    <button
      type="button"
      role={kind === "radio" ? "radio" : "checkbox"}
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition disabled:opacity-50 ${
        on
          ? "border-(--dc-accent) bg-(--dc-accent-soft) text-(--dc-accent-strong)"
          : "border-gray-300 bg-white text-gray-700 hover:border-(--dc-accent)/50"
      }`}
    >
      <span
        aria-hidden
        className={`box-border h-4 w-4 shrink-0 ${kind === "radio" ? "rounded-full" : "rounded"} ${
          on
            ? kind === "radio"
              ? "border-[5px] border-(--dc-accent)"
              : "border-2 border-(--dc-accent) bg-(--dc-accent)"
            : "border-2 border-gray-400"
        }`}
      />
      {children}
    </button>
  );
}

function WhoReceives({ route, pending }) {
  if (pending) {
    return (
      <p className="flex items-center gap-2 text-xs text-gray-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working out who receives it
      </p>
    );
  }
  if (!route) {
    return (
      <p className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
        Could not work out who receives this. Reload the record before sending it back.
      </p>
    );
  }
  const standing = route.standing ?? 0;
  const standingWords = standing > 0 ? `The ${standing} standing ${standing === 1 ? "recipient sees" : "recipients see"} it too.` : "";
  if (route.rep_user_id && route.account_name) {
    return (
      <div className="flex gap-2.5 rounded-lg border border-(--dc-accent)/30 bg-(--dc-accent-soft)/35 px-3 py-2.5 text-sm text-gray-800">
        <Users className="mt-0.5 h-4 w-4 shrink-0 text-(--dc-accent)" />
        <div>
          <strong>{route.account_name}</strong> will see this in Corrections: the sales rep on this transfer
          {route.via_delegate ? ", through their delegate" : ""}. {standingWords}
          <div className="mt-1 text-xs text-gray-600">
            The record stays in the queue marked "Waiting on Sales" and leaves the pool until it comes back.
          </div>
        </div>
      </div>
    );
  }
  const nobody = standing === 0;
  return (
    <div className={`flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${nobody ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
      <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${nobody ? "text-red-600" : "text-amber-600"}`} />
      <div>
        {route.sales_rep
          ? <><strong>{route.sales_rep}</strong> is the rep on this transfer but has no account linked. </>
          : <>No transfer names a rep for this stove. </>}
        {nobody
          ? <strong>Nobody is set up to receive send-backs yet, so this would change state and reach no one. Ask an administrator to name recipients under Settings.</strong>
          : <>The {standing} standing {standing === 1 ? "recipient carries" : "recipients carry"} it, and it will show as fixed on the rep's behalf.</>}
      </div>
    </div>
  );
}

export default function SendBackPanel({ saleId, record, reasons, canEdit, onChanged }) {
  const [reasonId, setReasonId] = useState("");
  // What the reason maps to, from the server; and what the agent ticked or
  // unticked by hand, which survives a change of reason.
  const [reasonFields, setReasonFields] = useState(() => new Set());
  const [overrides, setOverrides] = useState(() => new Map());
  const [note, setNote] = useState("");
  const [more, setMore] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewFor, setPreviewFor] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // The route and the reason's fields, from the server that will stamp them.
  useEffect(() => {
    let live = true;
    setPreviewFor(undefined);
    dataCenterCorrections
      .routePreview(saleId, reasonId || null)
      .then((p) => {
        if (!live) return;
        setPreview(p);
        setReasonFields(new Set(reasonId ? p.fields ?? [] : []));
        setPreviewFor(reasonId);
      })
      .catch(() => {
        if (!live) return;
        setPreview(null);
        setPreviewFor(reasonId);
      });
    return () => {
      live = false;
    };
  }, [saleId, reasonId]);

  const current = preview?.current ?? null;
  const liveState = current?.state && current.state !== "resolved"
    ? current.state
    : record?.correction_state === "open" || record?.correction_state === "fixed"
      ? record.correction_state
      : null;

  const reason = reasons.find((r) => r.id === reasonId);
  const needsNote = reason?.value === "other";
  const previewReady = previewFor === reasonId && preview !== null;
  const canSend = canEdit && Boolean(reasonId) && previewReady && (!needsNote || note.trim().length > 0) && !busy;

  const offered = useMemo(() => {
    const keys = new Set(EDITABLE.map((f) => f.key));
    keys.add("stove_serial_no");
    return keys;
  }, []);
  const primary = useMemo(() => PRIMARY.map((k) => byKey[k]).filter((f) => f && offered.has(f.key)), [offered]);
  const rest = useMemo(
    () => [...offered].filter((k) => !PRIMARY.includes(k)).map((k) => byKey[k]).filter(Boolean),
    [offered],
  );

  const isOn = (key) => (overrides.has(key) ? overrides.get(key) : reasonFields.has(key));
  const selected = () => [...offered].filter(isOn);
  const toggleField = (key) =>
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(key, !isOn(key));
      return next;
    });

  const send = async () => {
    setError(null);
    if (needsNote && !note.trim()) {
      setError("Say what is wrong; Sales reads this before touching the record.");
      return;
    }
    setBusy(true);
    try {
      const fields = selected();
      await dataCenterCorrections.open(saleId, {
        reasonId,
        // An empty list would be stored as "nothing named"; null lets the
        // server fill in from the reason.
        fields: fields.length > 0 ? fields : null,
        note: note.trim() || null,
      });
      setReasonId("");
      setOverrides(new Map());
      setNote("");
      await onChanged?.("Sent back to Sales.");
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not send it back.");
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setError(null);
    setBusy(true);
    try {
      await dataCenterCorrections.withdraw(saleId, null);
      await onChanged?.("Send-back withdrawn.");
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not withdraw it.");
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <header className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-2.5">
      <Undo2 className="h-4 w-4 text-(--dc-accent)" />
      <h3 className="text-sm font-semibold text-gray-900">Send back to Sales</h3>
      {liveState ? (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATE_TONE[liveState]}`}>{STATE_WORD[liveState]}</span>
      ) : (
        <span className="text-xs text-gray-500">When the paper is wrong, not the call</span>
      )}
    </header>
  );

  if (liveState) {
    const disputed = current?.disputed_fields ?? [];
    const holder = current?.assigned_to_name ?? current?.rep_account_name ?? null;
    return (
      <section data-send-back-state={liveState} className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-red-600 bg-white">
        {header}
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3 px-4 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Disputed</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {disputed.length === 0 ? (
                <span className="text-sm text-gray-500">{current?.reason_label ?? record?.correction_reason ?? "no field named"}</span>
              ) : disputed.map((k) => (
                <span key={k} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{byKey[k]?.label ?? k}</span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Who has it</p>
            <p className="mt-1 text-sm text-gray-800">
              {holder ?? "the standing recipients"}
              {current?.opened_at || record?.correction_requested_at ? `, since ${dateOf(current?.opened_at ?? record?.correction_requested_at, "")}` : ""}
            </p>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Fix note</p>
            <p className="mt-1 text-sm text-gray-800">{current?.fix_note ? `"${current.fix_note}"` : <span className="text-gray-500">not yet</span>}</p>
          </div>
          <div className="flex items-center gap-2 self-center">
            {liveState === "fixed" && (
              <Link
                href={`/data-center/corrections/${saleId}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-(--dc-accent) px-3 text-sm font-medium text-white hover:bg-(--dc-accent-strong)"
              >
                Review it <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
            {canEdit && (
              <button
                type="button"
                disabled={busy}
                onClick={withdraw}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Withdraw
              </button>
            )}
          </div>
        </div>
        {current && current.rep_marked_no_account && (
          <p className="mx-4 mb-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            This transfer's rep has no account. The standing recipients carry this one and it shows as fixed on the rep's behalf.
          </p>
        )}
        {error && <p className="mx-4 mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      </section>
    );
  }

  return (
    <section data-send-back-state="none" className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white">
      {header}
      <div className="space-y-4 px-4 py-4">
        <div>
          <p id="send-back-reason" className="text-xs font-medium uppercase tracking-wide text-gray-600">What is wrong</p>
          {reasons.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No reasons are configured. Settings sets them.</p>
          ) : (
            <div role="radiogroup" aria-labelledby="send-back-reason" className="mt-2 flex flex-wrap gap-2">
              {reasons.map((r) => (
                <Chip key={r.id} kind="radio" on={reasonId === r.id} disabled={!canEdit || busy} onClick={() => setReasonId(r.id)}>
                  {r.label}
                </Chip>
              ))}
            </div>
          )}
        </div>

        <div>
          <p id="send-back-fields" className="text-xs font-medium uppercase tracking-wide text-gray-600">Which fields</p>
          <div role="group" aria-labelledby="send-back-fields" className="mt-2 flex flex-wrap gap-2">
            {primary.map((f) => (
              <Chip key={f.key} kind="checkbox" on={isOn(f.key)} disabled={!canEdit || busy} onClick={() => toggleField(f.key)}>
                {f.label}
              </Chip>
            ))}
            {more && rest.map((f) => (
              <Chip key={f.key} kind="checkbox" on={isOn(f.key)} disabled={!canEdit || busy} onClick={() => toggleField(f.key)}>
                {f.label}
              </Chip>
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <p className="text-xs text-gray-500">Prefilled from the reason. Tick anything else the receipt got wrong; Sales sees these marked on the record.</p>
            {rest.length > 0 && (
              <button type="button" onClick={() => setMore((m) => !m)} className="inline-flex items-center gap-1 text-xs font-medium text-(--dc-accent)">
                {more ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {more ? "Fewer fields" : `${rest.length} more fields`}
              </button>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="send-back-note" className="block text-xs font-medium uppercase tracking-wide text-gray-600">
            Tell Sales what you heard
          </label>
          <textarea
            id="send-back-note"
            rows={3}
            disabled={!canEdit || busy}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What did the buyer say? Sales reads this before touching the record."
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-(--dc-accent) focus:outline-none disabled:bg-gray-50"
          />
          <p className="mt-1 text-xs text-gray-500">{needsNote ? "Required for this reason." : "Optional, but the rep who fixes it will thank you."}</p>
        </div>

        <WhoReceives route={preview?.route ?? null} pending={previewFor !== reasonId} />

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

        {canEdit && (
          <button
            type="button"
            disabled={!canSend}
            onClick={send}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-(--dc-accent) px-4 text-sm font-medium text-white hover:bg-(--dc-accent-strong) disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
            Send back to Sales
          </button>
        )}
      </div>
    </section>
  );
}
