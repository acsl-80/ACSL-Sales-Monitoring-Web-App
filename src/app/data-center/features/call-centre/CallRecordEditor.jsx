import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AgentBrief from "./AgentBrief";
import SerialRematch from "./SerialRematch";
import SendBackPanel from "./SendBackPanel";
import CopyField from "./control/CopyField";
import Link from "@/compat/Link";
import CallOutcome from "./CallOutcome";
import CorrectionFields, { Field } from "./CorrectionFields";
import { DraftBanner, KeepFailedBand, ClearDraftDialog } from "./DraftBanner";
import SaveCallButton from "./SaveCallButton";
import SaveFooter from "./SaveFooter";
import { dataCenterWrite, DataCenterError } from "../../lib/client";
import FieldRenderer, { isFieldVisible } from "./FieldRenderer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, AlertTriangle, Check, RotateCcw } from "lucide-react";

/**
 * One sale's call record, opened beside the queue.
 *
 * The form is built from the registry, not from this file. Sections, order,
 * labels, choices, conditions and validation all arrive from the server, so a
 * question added this afternoon appears here this afternoon.
 *
 * The fixed part is the small set of things the process itself is made of:
 * the call being saved and the verdict it implies, the corrections, the
 * earlier calls and the hand-back to Sales. Those have their own columns and
 * their own endpoints because dashboards group by them.
 *
 * Phase 28, D42 to D44: one save path. Save call, top and bottom, carries the
 * call's outcome with the record; the verdict follows the outcome unless a
 * pill was clicked; a save with changes and no outcome asks for one, with
 * "No call was made, just save" as the way through. Finish later keeps the
 * whole form, the picked outcome included, and nothing is lost on a dropped
 * line: the draft autosaves two seconds after typing stops.
 */

const SECTION_LABELS = {
  verification: "Verification",
  carbon: "Carbon and subsidy",
  cooking: "Cooking",
  service: "Service and support",
};

const EMPTY_ATTEMPT = { outcomeId: "", note: "", callbackAt: "", clientKey: null };

const mintKey = () =>
  (globalThis.crypto?.randomUUID?.() ??
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    }));

/**
 * Phase 26, C4. `nextOf(saleId)` answers what the agent should call after this
 * record ({ saleId, label, remaining } or null); `onNext(saleId)` opens it in
 * this same dialog; `allHref` is where "See all assigned" goes.
 */
export default function CallRecordEditor({ saleId, canEdit, onClose, onSaved, nextOf = null, onNext = null, allHref = "/data-center/my-calls" }) {
  const [schema, setSchema] = useState(null);
  const [record, setRecord] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [values, setValues] = useState({});
  /** The call being saved: outcome, note, callback time, and its client key. */
  const [attempt, setAttempt] = useState(EMPTY_ATTEMPT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** After Save: what comes next for this agent, or "nothing left". */
  const [handoff, setHandoff] = useState(null);
  /** Save call pressed with changes and no outcome: the band asks for one. */
  const [prompt, setPrompt] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [keepFailed, setKeepFailed] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [draft, setDraft] = useState(null);
  const [draftSavedAt, setDraftSavedAt] = useState(null);
  const [draftBusy, setDraftBusy] = useState(false);
  useEffect(() => {
    setHandoff(null);
    setPrompt(false);
    setAttempt(EMPTY_ATTEMPT);
  }, [saleId]);
  /*
   * Whether this agent has typed anything since the record loaded. A ref: the
   * autosave effect reads it, and state would re-run the effect on the very
   * change it is meant to debounce.
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
       * Registry answers live in a jsonb blob; record columns live beside it;
       * a draft goes on top, applied rather than offered. The call the draft
       * was in the middle of logging (`_attempt`) comes back into its own
       * state, so Finish later never loses a picked outcome.
       */
      setDraft(data.draft ?? null);
      setDraftSavedAt(data.draft?.saved_at ?? null);
      const { _attempt, ...draftValues } = data.draft?.values ?? {};
      setValues({ ...(data.record.answers ?? {}), ...draftValues });
      if (_attempt && typeof _attempt === "object") setAttempt({ ...EMPTY_ATTEMPT, ..._attempt });
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
    touched.current = true;
    setValues((v) => ({ ...v, [key]: value }));
  };

  /** The call's outcome changed: mint a key for it, and let the verdict follow it again. */
  const changeAttempt = (next) => {
    touched.current = true;
    const outcomeChanged = next.outcomeId !== attempt.outcomeId;
    if (outcomeChanged) {
      // A new outcome means the verdict follows it again, unless a pill is clicked after.
      setValues((v) => {
        const { verification_outcome: _drop, ...rest } = v;
        return rest;
      });
    }
    setAttempt({ ...next, clientKey: outcomeChanged ? (next.outcomeId ? mintKey() : null) : attempt.clientKey });
    if (next.outcomeId) setPrompt(false);
  };

  /** What a draft keeps: the form, plus the call being logged. */
  const draftPayload = () => (attempt.outcomeId ? { ...values, _attempt: attempt } : values);

  /*
   * Keep what has been typed, without anybody pressing anything. Two seconds
   * after typing stops, and only once the agent has touched the form.
   */
  useEffect(() => {
    if (!canEdit || !touched.current || loading) return;
    const timer = setTimeout(() => {
      setDraftBusy(true);
      dataCenterWrite
        .saveCallDraft(saleId, draftPayload(), record?.call_record_version ?? null)
        .then((r) => {
          setDraftSavedAt(r.kept ? (r.savedAt ?? new Date().toISOString()) : null);
          if (!r.kept) setDraft(null);
        })
        .catch(() => setDraftSavedAt(null))
        .finally(() => setDraftBusy(false));
    }, 2000);
    return () => clearTimeout(timer);
  }, [values, attempt, canEdit, loading, saleId, record?.call_record_version]);

  /** Keep it now rather than in two seconds, for a deliberate close. */
  const keepAndClose = async () => {
    if (canEdit && touched.current) {
      try {
        await dataCenterWrite.saveCallDraft(saleId, draftPayload(), record?.call_record_version ?? null);
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
      setAttempt(EMPTY_ATTEMPT);
      await load();
      setNotice("Started again from the saved record.");
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not clear that draft.");
    } finally {
      setDraftBusy(false);
    }
  };

  // Conditions read the record as it will be after this save.
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

  /*
   * The verdict the record will read after this save: the pill the agent
   * clicked, else the one the picked outcome implies (D42), else what the
   * record already says.
   */
  const outcomes = schema?.options?.call_outcome ?? [];
  const pickedValue = outcomes.find((o) => o.id === attempt.outcomeId)?.value;
  const derivedVerdict = pickedValue ? schema?.verdictMap?.[pickedValue] ?? null : null;
  const verdictExplicit = values.verification_outcome !== undefined;
  const verdict = values.verification_outcome ?? derivedVerdict ?? record?.verification_outcome ?? "not_verified";

  /**
   * What travels with a save: every value except a registry question that is
   * not being asked under the record as it will be, and except the send-back
   * arguments, which belong to the correction action.
   */
  const payloadFor = (all) => {
    const byKey = new Map((schema?.fields ?? []).map((f) => [f.key, f]));
    const out = {};
    for (const [key, value] of Object.entries(all)) {
      if (key === "correction_reason_id" || key === "correction_note" || key === "_attempt") continue;
      const def = byKey.get(key);
      if (def && !isFieldVisible(def, effective)) continue;
      out[key] = value;
    }
    return out;
  };

  /**
   * Save call. With an outcome picked, the call and the record land together.
   * With changes and no outcome, the band below asks for one (D44). `force`
   * is "No call was made, just save": the record alone.
   */
  const save = async ({ force = false } = {}) => {
    const hasAttempt = Boolean(attempt.outcomeId);
    if (!hasAttempt && !force && touched.current) {
      setPrompt(true);
      return;
    }
    setPrompt(false);
    setSaving(true);
    setNotice(null);
    try {
      const result = await dataCenterWrite.saveCallRecord(
        saleId,
        payloadFor(values),
        record?.call_record_version ?? null,
        hasAttempt
          ? {
              outcomeId: attempt.outcomeId,
              note: attempt.note?.trim() || null,
              callbackAt: pickedValue === "callback_requested" && attempt.callbackAt ? new Date(attempt.callbackAt).toISOString() : null,
              clientKey: attempt.clientKey ?? mintKey(),
            }
          : null,
      );
      setNotice(hasAttempt ? "Call saved." : "Saved.");
      setError(null);
      setConflict(false);
      touched.current = false;
      setDraft(null);
      setDraftSavedAt(null);
      setAttempt(EMPTY_ATTEMPT);
      await load();
      onSaved?.(result);
      if (nextOf) setHandoff({ next: nextOf(saleId) });
    } catch (err) {
      const isConflict = err instanceof DataCenterError && err.status === 409;
      setConflict(isConflict);
      setError(err instanceof DataCenterError ? err.message : "Could not save this record.");
    } finally {
      setSaving(false);
    }
  };

  const correctionReasons = schema?.options?.correction_reason ?? [];

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        className="dc-root flex h-[90dvh] w-[90vw] max-w-[90vw] flex-col gap-0 overflow-hidden border-0 p-0 sm:max-w-[90vw]"
        data-area="call-centre"
      >
        <DialogHeader className="shrink-0 space-y-0 border-b-2 border-(--dc-accent)/25 bg-(--dc-accent-soft)/40 py-4 pl-5 pr-12 text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="truncate text-base font-semibold text-gray-900">
                {record?.end_user_name ?? "Call record"}
              </DialogTitle>
              <DialogDescription className="mt-0.5 truncate text-sm text-gray-600">
                {record ? (
                  <>
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
            </div>
            {/* Save call at the top as well as the bottom: same verb, same handler (D42). */}
            {canEdit && !loading && (
              <SaveCallButton where="header" saving={saving} disabled={saving || loading} onClick={() => save()} compact />
            )}
          </div>
          {/* Phase 26, C4 (D36): the numbers copy for the call app; nothing dials. */}
          {record && (
            <div className="mt-2 flex flex-wrap items-center gap-2" data-copy-numbers>
              <CopyField value={record.resolved_phone ?? record.primary_phone ?? record.phone} label="phone" diallerName={schema?.diallerName} />
              {(record.resolved_alt_phone ?? record.alternative_phone) && (
                <CopyField value={record.resolved_alt_phone ?? record.alternative_phone} label="other phone" diallerName={schema?.diallerName} />
              )}
              <CopyField value={record.stove_serial_no} label="stove ID" diallerName={schema?.diallerName} compact />
            </div>
          )}
        </DialogHeader>

        {!loading && (
          <DraftBanner
            draft={draft}
            recordVersion={record?.call_record_version}
            canEdit={canEdit}
            busy={draftBusy}
            onClear={() => setConfirmClear(true)}
          />
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 p-6 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the record...
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            <div className="mx-auto max-w-5xl space-y-5">
            {error && (
              <div
                role="alert"
                className={`flex flex-wrap items-start gap-2 rounded-lg border p-3 ${
                  conflict ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"
                }`}
              >
                <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${conflict ? "text-red-600" : "text-amber-600"}`} />
                <p className={`min-w-0 flex-1 text-sm ${conflict ? "text-red-900" : "text-amber-900"}`}>{error}</p>
                {conflict && (
                  <button
                    type="button"
                    onClick={() => { setConflict(false); setError(null); load(); }}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 transition hover:bg-red-100"
                  >
                    <RotateCcw className="h-3 w-3" /> Reload
                  </button>
                )}
              </div>
            )}
            <KeepFailedBand reason={keepFailed} onCloseAnyway={() => onClose?.()} />
            <ClearDraftDialog
              open={confirmClear}
              draft={draft}
              busy={draftBusy}
              onCancel={() => setConfirmClear(false)}
              onConfirm={() => { setConfirmClear(false); discardDraft(); }}
            />
            {notice && (
              <div className="flex items-center gap-2 rounded-lg border border-(--dc-primary)/20 bg-(--dc-primary-soft)/50 p-3" role="status">
                <Check className="h-4 w-4 text-(--dc-accent)" />
                <p className="text-sm text-(--dc-accent)">{notice}</p>
              </div>
            )}

            {/* Everything the record knows, arranged the way a call goes. */}
            <AgentBrief record={record} />

            {/* The fix that only works while the buyer is on the line. */}
            <SerialRematch
              saleId={saleId}
              currentSerial={record?.stove_serial_no}
              canEdit={canEdit}
              onDone={() => load()}
            />

            {/* This call, its outcome, the verdict it implies, and the earlier calls. */}
            <CallOutcome
              attempts={attempts}
              outcomes={outcomes}
              canEdit={canEdit}
              saving={saving}
              attempt={attempt}
              onAttemptChange={changeAttempt}
              verdict={verdict}
              verdictExplicit={verdictExplicit}
              verdictDerived={Boolean(derivedVerdict)}
              onVerdict={(v) => setValue("verification_outcome", v)}
              prompt={prompt}
            />

            <CorrectionFields values={values} record={record} canEdit={canEdit} onChange={setValue} />

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
              onChanged={async (message) => { await load(); setNotice(message); }}
            />
            </div>
          </div>
        )}

        <SaveFooter
          canEdit={canEdit}
          saving={saving}
          loading={loading}
          draftBusy={draftBusy}
          draftSavedAt={draftSavedAt}
          prompt={prompt}
          outcomes={outcomes}
          attempt={attempt}
          onAttemptChange={changeAttempt}
          onSaveAnyway={() => save({ force: true })}
          onDismissPrompt={() => setPrompt(false)}
          handoff={handoff}
          onBack={() => setHandoff(null)}
          allHref={allHref}
          onClose={onClose}
          onNext={onNext ? (id) => { setHandoff(null); onNext(id); } : null}
          onKeepAndClose={keepAndClose}
          onSave={() => save()}
        />
      </DialogContent>
    </Dialog>
  );
}
