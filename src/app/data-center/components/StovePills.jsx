import { standingLabel } from "../lib/outcome";
import { plural } from "../lib/plural";

/**
 * Where a stove's receipt stands, and where its call stands, as two pills
 * (Phase 29, D53). The words come from `v_stove_typed` and the record's
 * standing (D41); nothing here decides anything. Shared by the bench list,
 * the bench rail and the partner records, so a stove reads the same
 * everywhere.
 */
const dateOf = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
const firstName = (name) => (name ? String(name).split(" ")[0] : "");

/** The typed state in words: "Typed 3 Sep 2026 by Happy, bench", "Finished by Rahina, awaiting confirmation", "Part typed by Rose", "Not typed". */
export function typedWords(s) {
  const state = s?.typed_state ?? (s?.sale_id ? "typed" : "untyped");
  if (state === "typed") {
    const by = s.typed_by_name ? ` by ${firstName(s.typed_by_name)}` : "";
    const via = s.typed_via ? `, ${s.typed_via}` : "";
    return `Typed${s.typed_at ? ` ${dateOf(s.typed_at)}` : ""}${by}${via}`;
  }
  if (state === "finished") return `Finished${s.last_edited_by_name ? ` by ${firstName(s.last_edited_by_name)}` : ""}, awaiting confirmation`;
  if (state === "draft") return `Part typed${s.last_edited_by_name ? ` by ${firstName(s.last_edited_by_name)}` : ""}`;
  return "Not typed";
}

const TYPED_TONE = {
  typed: "border-(--dc-accent)/40 bg-(--dc-accent-soft) text-(--dc-accent-strong)",
  finished: "border-(--dc-brief-place)/40 bg-(--dc-brief-place-soft) text-(--dc-brief-place)",
  draft: "border-(--dc-sev-warning)/40 bg-(--dc-sev-warning-soft) text-(--dc-sev-warning)",
  untyped: "border-gray-200 bg-gray-50 text-gray-500",
};

export function TypedPill({ s, className = "" }) {
  const state = s?.typed_state ?? (s?.sale_id || s?.just_recorded ? "typed" : "untyped");
  const words = s?.just_recorded && !s?.typed_state ? "Typed just now" : typedWords({ ...s, typed_state: state });
  return (
    <span
      className={`inline-flex max-w-full items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TYPED_TONE[state] ?? TYPED_TONE.untyped} ${className}`}
      data-typed-state={state}
      title={words}
    >
      <span className="truncate">{words}</span>
    </span>
  );
}

/** The call in words: "Not called", "Called twice", "Verified, 3 calls". Nothing for a stove with no sale. */
export function callWords(s) {
  if (!s?.sale_id && s?.typed_state !== "typed") return null;
  const tries = Number(s.attempt_count ?? 0);
  const standing = s.standing ?? (tries > 0 ? "in_progress" : "never_called");
  if (standing === "never_called") return "Not called";
  if (standing === "in_progress") return tries > 0 ? `Called ${tries === 1 ? "once" : tries === 2 ? "twice" : `${tries} times`}` : "In progress";
  return `${standingLabel(standing)}${tries > 0 ? `, ${plural(tries, "call")}` : ""}`;
}

const CALL_TONE = {
  never_called: "border-gray-200 bg-gray-50 text-gray-500",
  in_progress: "border-(--dc-brief-stove)/40 bg-(--dc-brief-stove-soft) text-(--dc-brief-stove)",
  verified: "border-(--dc-accent)/40 bg-(--dc-accent-soft) text-(--dc-accent-strong)",
  partially_verified: "border-(--dc-brief-place)/40 bg-(--dc-brief-place-soft) text-(--dc-brief-place)",
  unreachable: "border-(--dc-sev-critical)/40 bg-(--dc-sev-critical-soft) text-(--dc-sev-critical)",
  with_sales: "border-(--dc-brief-history)/40 bg-(--dc-brief-history-soft) text-(--dc-brief-history)",
};

export function CallPill({ s, className = "" }) {
  const words = callWords(s);
  if (!words) return <span className="text-gray-300">-</span>;
  const standing = s.standing ?? (Number(s.attempt_count ?? 0) > 0 ? "in_progress" : "never_called");
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${CALL_TONE[standing] ?? CALL_TONE.never_called} ${className}`}
      data-call-state={standing}
    >
      {words}
    </span>
  );
}
