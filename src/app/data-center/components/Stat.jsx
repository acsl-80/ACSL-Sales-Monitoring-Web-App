const NUMBER = new Intl.NumberFormat("en-NG");

const STATE_TONE = {
  staged: "bg-gray-100 text-gray-700",
  validated: "bg-blue-100 text-blue-800",
  dry_run: "bg-amber-100 text-amber-800",
  committed: "bg-(--dc-primary)/10 text-(--dc-accent)",
  rolled_back: "bg-purple-100 text-purple-800",
  failed: "bg-red-100 text-red-700",
};

/**
 * One number from a batch, with its label.
 *
 * Tabular numerals on purpose: a column of counts that does not line up is
 * harder to scan than the same column in a slightly duller font.
 */
export function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-(--dc-accent)/20 bg-(--dc-accent-soft)/30 px-3 py-2.5">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${tone ?? "text-gray-900"}`}>
        {typeof value === "number" ? NUMBER.format(value) : value}
      </p>
    </div>
  );
}

/** The batch's lifecycle state, coloured so a settled batch reads as settled. */
export function StateChip({ state }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        STATE_TONE[state] ?? "bg-gray-100 text-gray-700"
      }`}
    >
      {String(state ?? "").replace(/_/g, " ")}
    </span>
  );
}

export { NUMBER, STATE_TONE };
