import Link from "@/compat/Link";
import { useFeature } from "../../lib/access";
import { DATA_CENTER_FEATURES } from "../../lib/features";
import { dateOf } from "../../lib/when";
import { ArrowRight, MapPin } from "lucide-react";

/**
 * Where a searched stove is, when nothing sent back matches it (D69).
 *
 * The list holds only sales the call centre sent back. Most searches that
 * came up empty were for a stove that is somewhere else: a receipt whose
 * import stopped on an exception and so never became a sale, or a sale
 * nobody sent back. "No record matches" read as "the record is gone". This
 * says where it is and what has to happen before it can be worked here.
 */

const BATCH_WORD = {
  committed: "file committed",
  rolled_back: "file rolled back",
  staged: "file not checked yet",
  validated: "file checked, not committed",
  dry_run: "file checked, not committed",
};

function importLine(i) {
  const where = `${i.filename ?? "an import"}, row ${i.row_number ?? "?"}, ${dateOf(i.uploaded_at, "")}`;
  const batch = BATCH_WORD[i.batch_state] ?? i.batch_state;
  if (i.status === "committed") return `${where}: became a sale.`;
  if (i.status === "exception") return `${where}: stopped on an exception (${batch}).`;
  if (i.status === "rejected") return `${where}: refused (${batch}).`;
  if (i.batch_state === "committed") return `${where}: fixed after the file was committed, so never sent.`;
  return `${where}: ${i.status} (${batch}).`;
}

export default function StoveWhereabouts({ where }) {
  const { can } = useFeature();
  const { serial, stock, sale, imports } = where;
  const stoveId = stock?.stove_id ?? serial;
  const canOpenStove = can(DATA_CENTER_FEATURES.RECORDS_VIEW) && (stock || sale || imports.length > 0);
  const canBench = can(DATA_CENTER_FEATURES.DIGITISATION_WORK);
  const stopped = imports.find((i) => i.status !== "committed" && i.reason);

  let headline;
  let detail = null;
  if (sale) {
    headline = `Stove ${stoveId} is a sale the call centre has not sent back, so it is not on this list.`;
    detail = `${sale.end_user_name ?? "No name on the sale"}${stock?.partner_name ? `, ${stock.partner_name}` : ""}.`;
  } else if (imports.length > 0) {
    headline = `Stove ${stoveId} has no sale yet, so there is nothing here to fix.`;
    detail = "Its receipt was imported but did not become a sale. It has to become one before the call centre can ring it or send it back.";
  } else if (stock) {
    headline = `Stove ${stoveId} is in stock${stock.partner_name ? ` for ${stock.partner_name}` : ""} with no sale and no import.`;
    detail = "Its receipt has not been typed yet.";
  } else {
    headline = `Nothing sent back matches "${serial}", and no stove has that ID.`;
  }

  return (
    <div data-whereabouts className="mx-auto mt-4 max-w-xl rounded-lg border border-gray-200 bg-white p-4 text-left">
      <p className="flex items-start gap-2 text-sm font-medium text-gray-900">
        <MapPin aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-(--dc-accent)" />
        {headline}
      </p>
      {detail && <p className="mt-1 pl-6 text-sm text-gray-600">{detail}</p>}
      {imports.length > 0 && (
        <ul className="mt-2 space-y-1 pl-6 text-xs text-gray-600">
          {imports.map((i, n) => (
            <li key={n}>{importLine(i)}</li>
          ))}
        </ul>
      )}
      {stopped && (
        <p className="mt-2 ml-6 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">{stopped.reason}</p>
      )}
      {(canOpenStove || (canBench && !sale && stock)) && (
        <div className="mt-3 flex flex-wrap gap-2 pl-6">
          {canOpenStove && (
            <Link
              href={`/data-center/stove/${encodeURIComponent(stoveId)}`}
              className="inline-flex items-center gap-1 rounded-md bg-(--dc-accent) px-3 py-1.5 text-sm font-medium text-white hover:bg-(--dc-accent-strong)"
            >
              Open the stove record <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
          {canBench && !sale && stock && (
            <Link
              href="/data-center/import?mode=bench"
              className="inline-flex items-center gap-1 rounded-md border border-(--dc-accent)/40 px-3 py-1.5 text-sm font-medium text-(--dc-accent) hover:bg-(--dc-accent-soft)"
            >
              Type the receipt on the bench
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
