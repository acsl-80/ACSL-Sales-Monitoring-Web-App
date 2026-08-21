import { useCallback, useEffect, useMemo, useState } from "react";
import AgentBrief from "./AgentBrief";
import SerialRematch from "./SerialRematch";
import Link from "@/compat/Link";
import { dataCenterWrite, DataCenterError } from "../../lib/client";
import FieldRenderer, { isFieldVisible } from "./FieldRenderer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2, Phone, AlertTriangle, Check, RotateCcw, PhoneCall, Save,
} from "lucide-react";

/**
 * One sale's call record, opened beside the queue.
 *
 * The form is built from the registry, not from this file. Sections, order,
 * labels, choices, conditions and validation all arrive from the server, so a
 * question added this afternoon appears here this afternoon.
 *
 * The fixed part is the small set of things the process itself is made of: the
 * verification outcome, the corrections, the attempts and the hand-back to
 * Sales. Those have their own columns and their own endpoints because dashboards
 * group by them, and that is the line this module draws between "structure" and
 * "questions".
 */

const OUTCOMES = [
  { value: "not_verified", label: "Not verified", tone: "bg-gray-100 text-gray-700" },
  { value: "partially_verified", label: "Partially verified", tone: "bg-amber-100 text-amber-800" },
  { value: "fully_verified", label: "Fully verified", tone: "bg-(--dc-primary)/10 text-(--dc-accent)" },
  /*
    Nobody could reach this buyer, which is a conclusion and not a blank. It
    was missing here and refused by the write endpoint, so the scorecard column
    counting it could never be anything but zero.
  */
  { value: "unreachable", label: "Unreachable", tone: "bg-orange-100 text-orange-800" },
];

// The record's own fields, as opposed to registry questions. Grouped so the
// editor reads like the call rather than like the table.
const CORRECTION_FIELDS = [
  { key: "corrected_phone", label: "Corrected phone", type: "tel" },
  { key: "corrected_alt_phone", label: "Corrected alternative phone", type: "tel" },
  { key: "corrected_end_user_name", label: "Corrected name", type: "text" },
  { key: "corrected_address", label: "Corrected address", type: "text" },
  { key: "corrected_state", label: "Corrected state", type: "text" },
  { key: "corrected_lga", label: "Corrected LGA", type: "text" },
  { key: "ward", label: "Ward", type: "text" },
  { key: "landmark", label: "Landmark", type: "text" },
  { key: "stated_serial", label: "Serial as stated by the user", type: "text" },
];

const SECTION_LABELS = {
  verification: "Verification",
  carbon: "Carbon and subsidy",
  cooking: "Cooking",
  service: "Service and support",
};

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
      {children}
    </div>
  );
}

export default function CallRecordEditor({ saleId, canEdit, onClose, onSaved }) {
  const [schema, setSchema] = useState(null);
  const [record, setRecord] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nextOutcome, setNextOutcome] = useState("");
  const [nextNote, setNextNote] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [form, data] = await Promise.all([
        dataCenterWrite.formSchema(),
        dataCenterWrite.callRecord(saleId),
      ]);
      setSchema(form);
      setRecord(data.record);
      setAttempts(data.attempts);
      // Registry answers live in a jsonb blob; record columns live beside it.
      // The editor flattens both into one map so a promoted question needs no
      // change here either.
      setValues({ ...(data.record.answers ?? {}) });
      setError(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not load this record.");
    } finally {
      setLoading(false);
    }
  }, [saleId]);

  useEffect(() => {
    load();
  }, [load]);

  const setValue = (key, value) => setValues((v) => ({ ...v, [key]: value }));

  // Conditions read the record as it will be after this save, so setting an
  // outcome and answering the question it reveals works in one pass.
  const effective = useMemo(() => ({ ...(record ?? {}), ...values }), [record, values]);

  const sections = useMemo(() => {
    if (!schema) return [];
    const grouped = new Map();
    for (const field of schema.fields) {
      if (!isFieldVisible(field, effective)) continue;
      if (!grouped.has(field.section)) grouped.set(field.section, []);
      grouped.get(field.section).push(field);
    }
    return [...grouped.entries()];
  }, [schema, effective]);

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const result = await dataCenterWrite.saveCallRecord(
        saleId,
        values,
        record?.call_record_version ?? null,
      );
      setNotice("Saved.");
      setError(null);
      await load();
      onSaved?.(result);
    } catch (err) {
      // A 409 means someone else saved while this was open. Say so plainly:
      // the agent needs to reload, not retry.
      setError(err instanceof DataCenterError ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const logAttempt = async (outcomeId, note) => {
    setSaving(true);
    try {
      await dataCenterWrite.logAttempt(saleId, {
        outcomeId: outcomeId || null,
        note: note?.trim() || null,
      });
      await load();
      setNotice("Call logged.");
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not log the call.");
    } finally {
      setSaving(false);
    }
  };

  const toggleCorrection = async (open) => {
    setSaving(true);
    try {
      await dataCenterWrite.correction(saleId, open, values.correction_reason_id, values.correction_note);
      await load();
      setNotice(open ? "Sent back to Sales." : "Correction marked resolved.");
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not update the correction.");
    } finally {
      setSaving(false);
    }
  };

  const callOutcomes = schema?.options?.call_outcome ?? [];

  /**
   * "Something else" is the outcome that has to be typed out.
   *
   * The nine seeded outcomes came from a closed list, and the July data shows
   * what an agent does when the call does not fit one: they invent a tenth and
   * type it into a constrained column. RESPONDED, REPONDED and NO PHONE NUMBER
   * all arrived that way. Giving them one place to say what happened is what
   * stops the next three inventions, so when this outcome is picked the note
   * stops being optional.
   */
  const otherIsPicked =
    callOutcomes.find((o) => o.id === nextOutcome)?.value === "other";
  const canLog = !otherIsPicked || nextNote.trim().length > 0;
  const correctionReasons = schema?.options?.correction_reason ?? [];
  const correctionOpen = record?.correction_state === "open";

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        className="dc-root flex h-[90dvh] w-[90vw] max-w-[90vw] flex-col gap-0 overflow-hidden border-0 p-0 sm:max-w-[90vw]"
        data-area="call-centre"
      >
        <DialogHeader className="shrink-0 space-y-0 border-b-2 border-(--dc-accent)/25 bg-(--dc-accent-soft)/40 py-4 pl-5 pr-12 text-left">
          <DialogTitle className="truncate text-base font-semibold text-gray-900">
            {record?.end_user_name ?? "Call record"}
          </DialogTitle>
          <DialogDescription className="mt-0.5 truncate text-sm text-gray-600">
            {record ? (
              <>
                {/*
                  The serial leads out to the whole history. An agent on a call
                  who is told something that does not match the record needs
                  the transfer, the import and the previous calls, and going
                  and finding those by hand is what this page exists to end.
                */}
                <Link
                  href={`/data-center/stove/${encodeURIComponent(record.stove_serial_no)}`}
                  className="text-(--dc-accent) underline decoration-(--dc-accent)/30 underline-offset-2 hover:decoration-(--dc-accent)"
                >
                  {record.stove_serial_no}
                </Link>
                {[record.partner_name, record.user_state].filter(Boolean).map((v) => (
                  <span key={v}> · {v}</span>
                ))}
              </>
            ) : (
              "Loading this record"
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 p-6 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the record...
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            {/* Capped, because 90% of a wide screen is far wider than a phone
                number needs, and a field stretched to 550px reads as a mistake
                rather than as generosity. */}
            <div className="mx-auto max-w-5xl space-y-5">
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-sm text-amber-900">{error}</p>
              </div>
            )}
            {notice && (
              <div className="flex items-center gap-2 rounded-lg border border-(--dc-primary)/20 bg-(--dc-primary-soft)/50 p-3">
                <Check className="h-4 w-4 text-(--dc-accent)" />
                <p className="text-sm text-(--dc-accent)">{notice}</p>
              </div>
            )}

            {/*
              Everything the record knows, arranged the way a call goes.

              This was four fields - phone, buyer, address, sold - which is
              enough to dial and not enough to hold the conversation. An agent
              who cannot say which stove, from which partner, on what terms, is
              reading from a stub while the customer is talking.
            */}
            <AgentBrief record={record} />

            {/* The fix that only works while the buyer is on the line. */}
            <SerialRematch
              saleId={saleId}
              currentSerial={record?.stove_serial_no}
              canEdit={canEdit}
              onDone={() => load()}
            />

            {/* The outcome. Its own control because everything downstream
                groups by it. */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Verification outcome
              </h3>
              <div className="flex flex-wrap gap-2">
                {OUTCOMES.map((o) => {
                  const active =
                    (values.verification_outcome ?? record?.verification_outcome ?? "not_verified") ===
                    o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      disabled={!canEdit || saving}
                      onClick={() => setValue("verification_outcome", o.value)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                        active ? o.tone + " ring-2 ring-offset-1 ring-(--dc-primary)/40" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      } disabled:opacity-50`}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Attempts. Rows, so a fourth call is a click and not a migration. */}
            <div>
              <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Calls ({attempts.length})
                </h3>
                {canEdit && (
                  <div className="flex items-center gap-2">
                    {/* State, not the DOM. This read the select back through
                        getElementById, which worked only while exactly one
                        editor existed on the page. */}
                    <label htmlFor="dc-next-outcome" className="sr-only">
                      Outcome of this call
                    </label>
                    <select
                      className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-(--dc-accent) focus:outline-none sm:flex-none"
                      value={nextOutcome}
                      onChange={(e) => setNextOutcome(e.target.value)}
                      id="dc-next-outcome"
                    >
                      <option value="">Outcome...</option>
                      {callOutcomes.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={saving || !canLog}
                      onClick={() => {
                        logAttempt(nextOutcome, nextNote);
                        setNextOutcome("");
                        setNextNote("");
                      }}
                      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-(--dc-accent) px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-50"
                    >
                      <PhoneCall className="h-3 w-3" /> Log call
                    </button>
                  </div>
                )}
              </div>

              {canEdit && otherIsPicked && (
                <div className="mb-3 rounded-lg border border-(--dc-accent)/25 bg-(--dc-accent-soft)/30 p-3">
                  <label
                    htmlFor="dc-next-note"
                    className="mb-1 block text-xs font-medium uppercase tracking-wide text-(--dc-accent-strong)"
                  >
                    What happened on this call?
                  </label>
                  <textarea
                    id="dc-next-note"
                    rows={2}
                    value={nextNote}
                    onChange={(e) => setNextNote(e.target.value)}
                    placeholder="Say what the outcome was, since it is not one of the listed ones"
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none"
                  />
                </div>
              )}

              {attempts.length === 0 ? (
                <p className="text-sm text-gray-500">No calls logged yet.</p>
              ) : (
                <ul className="space-y-1">
                  {attempts.map((a) => (
                    <li key={a.id} className="flex items-baseline gap-2 text-sm text-gray-700">
                      <span className="w-6 shrink-0 text-xs font-semibold text-gray-400">
                        #{a.attempt_no}
                      </span>
                      <span className="shrink-0 text-xs text-gray-500">
                        {new Date(a.attempted_at).toLocaleDateString()}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{a.outcome ?? "no outcome recorded"}</span>
                      {a.answered_by && (
                        <span className="shrink-0 text-xs text-gray-500">{a.answered_by}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Corrections. Real columns, because reporting groups by them. */}
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <Phone className="h-3.5 w-3.5" /> What the call corrected
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {CORRECTION_FIELDS.map((f) => (
                  <Field key={f.key} label={f.label}>
                    <input
                      type={f.type}
                      disabled={!canEdit}
                      value={values[f.key] ?? record?.[f.key] ?? ""}
                      onChange={(e) => setValue(f.key, e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none disabled:bg-gray-50"
                    />
                  </Field>
                ))}
              </div>
            </div>

            {/* The questionnaire. Every field below comes from field_defs. */}
            {sections.map(([section, fields]) => (
              <div key={section}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {SECTION_LABELS[section] ?? section}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {fields.map((field) => (
                    <div key={field.key} className={field.input_type === "textarea" ? "col-span-2" : ""}>
                      <FieldRenderer
                        field={field}
                        value={values[field.key]}
                        options={schema.options[field.option_list_key] ?? []}
                        disabled={!canEdit}
                        onChange={setValue}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <Field label="Other comments">
              <textarea
                rows={2}
                disabled={!canEdit}
                value={values.other_comments ?? record?.other_comments ?? ""}
                onChange={(e) => setValue("other_comments", e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none disabled:bg-gray-50"
              />
            </Field>

            {/* Hand back to Sales. The loop, as a button rather than an email. */}
            <div className="rounded-lg border border-gray-200 p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Send back to Sales
              </h3>
              {correctionOpen ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-amber-800">
                    Waiting on Sales since{" "}
                    {record?.correction_requested_at
                      ? new Date(record.correction_requested_at).toLocaleDateString()
                      : "—"}
                    {record?.correction_reason ? ` · ${record.correction_reason}` : ""}
                  </p>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => toggleCorrection(false)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-(--dc-primary)/30 px-2.5 py-1 text-xs font-medium text-(--dc-primary) hover:bg-(--dc-primary)/10 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3 w-3" /> Mark fixed
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <select
                      disabled={!canEdit}
                      value={values.correction_reason_id ?? ""}
                      onChange={(e) => setValue("correction_reason_id", e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none disabled:bg-gray-50"
                    >
                      <option value="">Reason...</option>
                      {correctionReasons.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={saving || !values.correction_reason_id}
                      onClick={() => toggleCorrection(true)}
                      className="rounded-md border border-amber-400/60 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                    >
                      Send back
                    </button>
                  )}
                </div>
              )}
              </div>
            </div>
          </div>
        )}

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-(--dc-surface-muted) px-5 py-3">
          <p className="text-xs text-gray-500">
            {canEdit
              ? "Every change is recorded against your name."
              : "You have view access, so this record is read only."}
          </p>
          {canEdit && (
            <button
              type="button"
              disabled={saving || loading}
              onClick={save}
              className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-4 py-1.5 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
