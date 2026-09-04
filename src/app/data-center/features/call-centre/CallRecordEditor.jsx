import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import AgentBrief from "./AgentBrief";
import SerialRematch from "./SerialRematch";
import SendBackPanel from "./SendBackPanel";
import Link from "@/compat/Link";
import { dataCenterWrite, DataCenterError } from "../../lib/client";
import { OUTCOME_WORDS, OUTCOME_PILL } from "../../lib/outcome";
import { dateOf, whenOf } from "../../lib/when";
import ConfirmDialog from "../../components/ConfirmDialog";
import FieldRenderer, { isFieldVisible } from "./FieldRenderer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2, Phone, AlertTriangle, Check, RotateCcw, PhoneCall, Save, PenLine,
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

// One vocabulary and one set of tones for the four outcomes, from lib/outcome.
// Unreachable is a conclusion and not a blank: nobody could reach this buyer.
const OUTCOMES = ["not_verified", "partially_verified", "fully_verified", "unreachable"].map((value) => ({
  value,
  label: OUTCOME_WORDS[value],
  tone: OUTCOME_PILL[value],
}));

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
  /** A Save refused because somebody else saved first; reloading is the way on. */
  const [conflict, setConflict] = useState(false);
  /** Finish later could not keep the typing; closing now would lose it. */
  const [keepFailed, setKeepFailed] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  /*
   * The half-finished form somebody left here, and whether it is still on
   * screen. `draft` is what arrived with the record; `draftState` is what has
   * happened to it since - restored, cleared, or saved again as they type.
   */
  const [draft, setDraft] = useState(null);
  const [draftSavedAt, setDraftSavedAt] = useState(null);
  const [draftBusy, setDraftBusy] = useState(false);
  /*
   * Whether this agent has typed anything since the record loaded.
   *
   * A ref rather than state: the autosave effect reads it, and making it state
   * would re-run the effect on the very change it is meant to debounce.
   */
  const touched = useRef(false);

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
      /*
       * Registry answers live in a jsonb blob; record columns live beside it.
       * The editor flattens both into one map so a promoted question needs no
       * change here either.
       *
       * A draft goes on top. It is what somebody typed and did not finish, so
       * it is newer than the answers already stored - and it is applied rather
       * than offered because an agent who saved half a form and comes back
       * expects to find it, not to be asked whether they meant it. The banner
       * above the form says whose it is and gives them one click to throw it
       * away.
       */
      setDraft(data.draft ?? null);
      setDraftSavedAt(data.draft?.saved_at ?? null);
      setValues({
        ...(data.record.answers ?? {}),
        ...(data.draft?.values ?? {}),
      });
      setError(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not load this record.");
    } finally {
      setLoading(false);
    }
  }, [saleId]);

  useEffect(() => {
    touched.current = false;
    load();
  }, [load]);

  const setValue = (key, value) => {
    // Marks the form as the agent's rather than the server's, which is what
    // decides whether the autosave below has anything worth keeping.
    touched.current = true;
    setValues((v) => ({ ...v, [key]: value }));
  };

  /**
   * Keep what has been typed, without anybody pressing anything.
   *
   * The case this is for is a call that cuts off: the line drops, the laptop
   * closes, the tab crashes. None of those press Save, so a draft that waited
   * for a button would be a draft that never existed when it was needed.
   *
   * Two seconds after typing stops, not per keystroke. And only when the agent
   * has actually touched the form - without that guard, merely opening a
   * record would write a draft for it and put it on their unfinished list.
   */
  useEffect(() => {
    if (!canEdit || !touched.current || loading) return;
    const timer = setTimeout(() => {
      setDraftBusy(true);
      dataCenterWrite
        .saveCallDraft(saleId, values, record?.call_record_version ?? null)
        .then((r) => {
          setDraftSavedAt(r.kept ? (r.savedAt ?? new Date().toISOString()) : null);
          // Cleared to empty: it is no longer anybody's unfinished work, so
          // the banner naming who left it should go too.
          if (!r.kept) setDraft(null);
        })
        // Deliberately silent. A failed autosave is not something to interrupt
        // a live call with; the marker simply stops saying "saved", and the
        // real save still reports its own failures loudly.
        .catch(() => setDraftSavedAt(null))
        .finally(() => setDraftBusy(false));
    }, 2000);
    return () => clearTimeout(timer);
  }, [values, canEdit, loading, saleId, record?.call_record_version]);

  /**
   * Keep it now rather than in two seconds, for a deliberate close.
   *
   * A draft that could not be written used to be swallowed here and the
   * editor closed anyway, so the typing was gone and nobody was told. Closing
   * is still never blocked: the failure is shown, with a way to close
   * regardless, and the choice is the person's.
   */
  const keepAndClose = async () => {
    if (canEdit && touched.current) {
      try {
        await dataCenterWrite.saveCallDraft(
          saleId,
          values,
          record?.call_record_version ?? null,
        );
      } catch (err) {
        setKeepFailed(err instanceof DataCenterError ? err.message : "the draft could not be written");
        return;
      }
    }
    onClose?.();
  };

  const discardDraft = async () => {
    setDraftBusy(true);
    try {
      await dataCenterWrite.discardCallDraft(saleId);
      touched.current = false;
      setDraft(null);
      setDraftSavedAt(null);
      await load();
      setNotice("Started again from the saved record.");
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not clear that draft.");
    } finally {
      setDraftBusy(false);
    }
  };

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

  /**
   * What travels with a save: every value except a registry question that is
   * not being asked under the record as it will be, and except the send-back
   * arguments, which belong to the correction action. Sending the whole form
   * was how an old answer to "why not verified" followed the record into
   * "Fully verified" and got the save refused.
   */
  const payloadFor = (all) => {
    const byKey = new Map((schema?.fields ?? []).map((f) => [f.key, f]));
    const out = {};
    for (const [key, value] of Object.entries(all)) {
      if (key === "correction_reason_id" || key === "correction_note") continue;
      const def = byKey.get(key);
      if (def && !isFieldVisible(def, effective)) continue;
      out[key] = value;
    }
    return out;
  };
  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const result = await dataCenterWrite.saveCallRecord(
        saleId,
        payloadFor(values),
        record?.call_record_version ?? null,
      );
      setNotice("Saved.");
      setError(null);
      setConflict(false);
      // The server clears the draft in the same transaction as the save. This
      // is the local half of that, so the banner goes without waiting for the
      // reload to come back.
      touched.current = false;
      setDraft(null);
      setDraftSavedAt(null);
      await load();
      onSaved?.(result);
    } catch (err) {
      // A 409 is not a fault in what was typed: somebody else saved first. It
      // is shown in its own tone with the one way on, a reload.
      const isConflict = err instanceof DataCenterError && err.status === 409;
      setConflict(isConflict);
      setError(err instanceof DataCenterError ? err.message : "Could not save this record.");
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
      return true;
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not log the call.");
      return false;
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
  // An attempt needs an outcome; "something else" needs the words as well.
  const canLog = Boolean(nextOutcome) && (!otherIsPicked || nextNote.trim().length > 0);
  // Every active reason, offered as chips by the send-back panel; the panel
  // holds the choice itself so nothing about a send-back travels in the draft.
  const correctionReasons = schema?.options?.correction_reason ?? [];

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

        {/*
          What somebody left half-finished here.

          Applied to the form already rather than offered, because an agent who
          typed four answers and lost the call expects to find them, not to be
          asked whether they meant it. What the banner is for is the two things
          they cannot see from the fields themselves: whose answers these are,
          and how to get rid of them.

          Amber rather than green: this is not a saved record. Nothing here has
          reached the call record, and the scorecards do not count it.
        */}
        {draft && !loading && (
          <div className="flex shrink-0 flex-wrap items-start gap-2 border-b border-amber-300 bg-amber-50 px-5 py-2.5">
            <PenLine className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="min-w-0 flex-1 text-sm text-amber-900">
              <span className="font-semibold">
                {draft.saved_by_me
                  ? "You started this and did not finish."
                  : `${draft.saved_by_name ?? "Somebody"} started this and did not finish.`}
              </span>{" "}
              Their answers are in the form below, from{" "}
              {whenOf(draft.saved_at)}. Nothing has been saved
              to the record yet.
              {/*
                The version the draft was typed against, checked out loud. A
                draft written over a record that has since moved on would
                otherwise quietly reapply older answers over newer ones.
              */}
              {draft.base_version != null &&
                record?.call_record_version != null &&
                draft.base_version !== record.call_record_version && (
                  <span className="mt-1 block font-semibold">
                    The record has been saved by somebody else since this was
                    typed. Check each answer against what they entered before you
                    save.
                  </span>
                )}
            </p>
            {canEdit && (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                disabled={draftBusy}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
              >
                {draftBusy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RotateCcw className="h-3 w-3" />
                )}
                Clear it and start again
              </button>
            )}
          </div>
        )}

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
              <div
                role="alert"
                className={`flex flex-wrap items-start gap-2 rounded-lg border p-3 ${
                  conflict ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"
                }`}
              >
                <AlertTriangle
                  className={`mt-0.5 h-4 w-4 shrink-0 ${conflict ? "text-red-600" : "text-amber-600"}`}
                />
                <p className={`min-w-0 flex-1 text-sm ${conflict ? "text-red-900" : "text-amber-900"}`}>
                  {error}
                </p>
                {conflict && (
                  <button
                    type="button"
                    onClick={() => {
                      setConflict(false);
                      setError(null);
                      load();
                    }}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 transition hover:bg-red-100"
                  >
                    <RotateCcw className="h-3 w-3" /> Reload
                  </button>
                )}
              </div>
            )}
            {keepFailed && (
              <div
                role="alert"
                className="flex flex-wrap items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <p className="min-w-0 flex-1 text-sm text-red-900">
                  Your answers could not be kept: {keepFailed}. Save the record, or close anyway
                  and lose what you typed.
                </p>
                <button
                  type="button"
                  onClick={() => onClose?.()}
                  className="inline-flex shrink-0 items-center rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 transition hover:bg-red-100"
                >
                  Close anyway
                </button>
              </div>
            )}
            <ConfirmDialog
              open={confirmClear}
              title="Clear this unfinished form?"
              description={`${
                draft?.saved_by_name ? `${draft.saved_by_name}'s` : "The"
              } unsaved answers go, and the form starts again from the saved record. Nothing already saved changes.`}
              cancelLabel="Keep the answers"
              actionLabel="Clear it"
              destructive
              busy={draftBusy}
              onCancel={() => setConfirmClear(false)}
              onConfirm={() => {
                setConfirmClear(false);
                discardDraft();
              }}
            />
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
                    <div className="min-w-0 flex-1 sm:flex-none sm:min-w-[12rem]">
                      <SearchableSelect
                        id="dc-next-outcome"
                        ariaLabel="Outcome of this call"
                        value={nextOutcome}
                        onChange={setNextOutcome}
                        placeholder="Outcome..."
                        searchPlaceholder="Type part of an outcome"
                        emptyLabel="No outcome matches that"
                        options={callOutcomes.map((o) => ({ value: o.id, label: o.label }))}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={saving || !canLog}
                      onClick={async () => {
                        // Cleared only once the attempt is on the record; a
                        // refused attempt keeps what was typed.
                        const ok = await logAttempt(nextOutcome, nextNote);
                        if (ok) {
                          setNextOutcome("");
                          setNextNote("");
                        }
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
                        {whenOf(a.attempted_at)}
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

            {/* Hand back to Sales. The loop, as a panel rather than a dropdown. */}
            <SendBackPanel
              saleId={saleId}
              record={record}
              reasons={correctionReasons}
              canEdit={canEdit}
              onChanged={async (message) => {
                await load();
                setNotice(message);
              }}
            />
            </div>
          </div>
        )}

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-(--dc-surface-muted) px-5 py-3">
          <p className="flex items-center gap-1.5 text-xs text-gray-500">
            {canEdit
              ? "Every change is recorded against your name."
              : "You have view access, so this record is read only."}
            {/*
              The autosave, said quietly.

              An agent needs to know their typing is being kept, or they will
              not trust the form enough to leave it half-finished - which is
              the whole point. Quiet, because it must not compete for attention
              during a live call.
            */}
            {canEdit && draftBusy && (
              <span className="inline-flex items-center gap-1 text-gray-400">
                <Loader2 className="h-3 w-3 animate-spin" /> keeping...
              </span>
            )}
            {canEdit && !draftBusy && draftSavedAt && (
              <span className="inline-flex items-center gap-1 text-amber-700">
                <PenLine className="h-3 w-3" /> kept, not saved
              </span>
            )}
          </p>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              {/*
                Closing deliberately writes the draft now rather than in two
                seconds' time, so "I will come back to this" and "the line just
                dropped" both end the same way.
              */}
              <button
                type="button"
                disabled={saving || loading}
                onClick={keepAndClose}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                <PenLine className="h-4 w-4" /> Finish later
              </button>
              <button
                type="button"
                disabled={saving || loading}
                onClick={save}
                className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-4 py-1.5 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
