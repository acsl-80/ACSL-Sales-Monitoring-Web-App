import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Wrench } from "lucide-react";
import { dataCenterImport, DataCenterError } from "../../lib/client";
import { plural } from "../../lib/plural";

/**
 * What an exception is, and what would actually change it.
 *
 * Three hundred rows in one flat list, each with a "Fix" box beside it, is a
 * wall nobody can work. Worse, most of those boxes could not have helped: a
 * corrected serial fixes a serial that was mistyped, and does nothing at all
 * for a partner the sales app has not been assigned a model for. The button
 * was offered on every row regardless, and on the rows it could not help it
 * was offered anyway.
 *
 * So exceptions are grouped by what is actually wrong, each group says how
 * many rows it holds, and only the groups a serial correction can help get a
 * serial correction. The rest say what WOULD change them, and where.
 *
 * The groups are chips over one table rather than five collapsed lists
 * (2026-09-07). A person correcting a serial number is holding a receipt, and
 * what tells them which receipt is the buyer and the telephone number beside
 * it - so the fix box sits in the row it fixes, with the row's own details on
 * either side of it.
 */
const EXCEPTION_KINDS = [
  {
    key: "not_in_stock",
    test: (why) => /is not in stock records/i.test(why),
    title: "The serial number matches nothing in stock",
    short: "not in stock",
    fixable: true,
    what:
      "Either the serial number was mistyped on the receipt or when it was digitised, or " +
      "the stove was never transferred to a partner. Correct it here and the row is " +
      "re-checked on the spot.",
  },
  {
    key: "unassigned_model",
    test: (why) => /is not assigned the/i.test(why),
    title: "The partner has not been assigned this sales model",
    short: "no model assigned",
    fixable: false,
    what:
      "The sales app refuses a sale whose partner is not assigned that model, so these " +
      "rows would fail at commit. The fix is one assignment per pair in the ERP " +
      "(Partner Sales Models), not a change to the row. Assign them, then press " +
      "Check the rows again and these clear themselves.",
  },
  {
    key: "unpaid_balance_no_model",
    test: (why) => /names no sales model/i.test(why),
    title: "A balance is owed but no sales model was named",
    short: "no sales model",
    fixable: false,
    what:
      "The sales app tracks an unpaid balance against a sales model, so a part payment " +
      "with no model cannot be written without recording it as paid in full. For a typed " +
      "receipt, open it at the bench, pick the model and save it as finished again. For a " +
      "file, add a sales_model column, or fill in Total paid to date where the buyer paid in " +
      "full, and re-import. Then press Check the rows again.",
  },
  {
    key: "duplicate",
    test: (why) => /already appears on row/i.test(why),
    title: "The same serial number appears twice in this file",
    short: "twice in this file",
    fixable: true,
    what:
      "One of the two rows has the wrong serial number. Correct it here, or leave the row - " +
      "the first occurrence still imports.",
  },
  {
    key: "already_sold",
    // Matches the reason the import writes when public.sales itself holds a
    // live sale for the serial. The older wording ("already recorded as sold")
    // was written off the stock flag and is kept in the pattern so a batch
    // staged before that change still groups instead of falling into "other".
    test: (why) => /already has a sale recorded|already (recorded as sold|sold by the time)/i.test(why),
    title: "This receipt is already digitised",
    short: "already digitised",
    fixable: true,
    what:
      "A sale already exists for this stove, so the row was not written over it. If the " +
      "serial number on this row is mistyped, correct it here and the row is re-checked on " +
      "the spot. If the receipt really is a duplicate of a sale already in the app, leave it. " +
      "If it replaces that sale, cancel the existing one in the sales app first.",
  },
  {
    key: "stock_drift",
    test: (why) => /no live sale exists/i.test(why),
    title: "Stock says sold, but there is no sale",
    short: "sold with no sale",
    fixable: true,
    what:
      "The stove is flagged sold in stock while nothing in the sales app claims it, so a " +
      "sale was removed without the stove being released. Nothing here can fix that. " +
      "Have the stove looked at in the sales app, then press Check the rows again. If " +
      "instead the serial number is mistyped, correct it here.",
  },
  {
    key: "moved_partner",
    test: (why) => /moved to a different partner|belongs to a different partner/i.test(why),
    title: "The stove belongs to a different partner",
    short: "another partner",
    fixable: true,
    what:
      "The serial number resolves to a partner other than the one this row claims. Correct the " +
      "serial number if it was mistyped; otherwise the consignment records need looking at.",
  },
  {
    key: "other",
    test: () => true,
    title: "Everything else",
    short: "see the reason",
    fixable: true,
    what: "One row at a time. The reason is printed against each.",
  },
];

/** The distinct partner-and-model pairs behind a set of unassigned-model rows. */
function assignmentsNeeded(rows) {
  const pairs = new Map();
  for (const r of rows) {
    const why = r.exception_reason ?? "";
    const partner = why.match(/Partner "([^"]+)"/)?.[1];
    const model = why.match(/the "([^"]+)" sales model/)?.[1];
    if (!partner || !model) continue;
    const key = `${partner}\u0000${model}`;
    pairs.set(key, { partner, model, rows: (pairs.get(key)?.rows ?? 0) + 1 });
  }
  return [...pairs.values()].sort((a, b) => b.rows - a.rows);
}

const kindOf = (r) => {
  const why = r.exception_reason ?? "";
  return EXCEPTION_KINDS.find((k) => k.test(why)) ?? EXCEPTION_KINDS[EXCEPTION_KINDS.length - 1];
};

/** The buyer as the receipt names them, whichever heading the sheet used. */
function buyerOf(r) {
  const raw = r.raw ?? {};
  const first = raw["User First Name"] ?? raw["First name"] ?? raw.first_name ?? "";
  const last = raw["User Last Name"] ?? raw["Last name"] ?? raw.last_name ?? "";
  const both = [first, last].filter(Boolean).join(" ").trim();
  return both || raw.end_user_name || raw.name || "-";
}

function phoneOf(r) {
  const raw = r.raw ?? {};
  return (
    raw["Primary Phone Number"] ?? raw["Mobile No."] ?? raw["Phone number"] ??
    raw.phone ?? "-"
  );
}

export default function ExceptionsTable({ batchId, count, canResolve, onChanged }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [group, setGroup] = useState("all");
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await dataCenterImport.rows(batchId, "exception"));
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const buckets = EXCEPTION_KINDS.map((k) => ({ ...k, rows: [] }));
    for (const r of rows) {
      (buckets.find((b) => b.test(r.exception_reason ?? "")) ?? buckets[buckets.length - 1])
        .rows.push(r);
    }
    return buckets.filter((b) => b.rows.length > 0);
  }, [rows]);

  const chosen = groups.find((g) => g.key === group) ?? null;
  const shown = chosen ? chosen.rows : rows;
  const pairs = chosen?.key === "unassigned_model" ? assignmentsNeeded(chosen.rows) : [];

  const resolve = async (row) => {
    /*
     * The value the INPUT is showing, not a separate one.
     *
     * This read `drafts[rowId]` while the input rendered
     * `drafts[rowId] ?? row.stove_serial_no`, so pressing Fix without first
     * editing the box sent an empty string and hit a silent `return`. The
     * field looked filled and the button did nothing at all - the single
     * most reported thing about this screen.
     */
    const serial = (drafts[row.id] ?? row.stove_serial_no ?? "").trim();
    if (!serial) {
      setNote({ id: row.id, text: "Type the correct serial number first." });
      return;
    }
    setBusy(row.id);
    setNote(null);
    try {
      const out = await dataCenterImport.resolveException(row.id, serial);
      if (!out.resolved) {
        // The correction did not fix it. Say so here rather than letting the
        // row look resolved and fail later at commit.
        setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, exception_reason: out.reason } : r)));
        setNote({ id: row.id, text: out.reason ?? "That serial number did not resolve it." });
      } else {
        await load();
        onChanged?.();
      }
    } catch (err) {
      setNote({
        id: row.id,
        text: err instanceof DataCenterError ? err.message : "That did not go through.",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-3 py-2">
        <Wrench className="h-4 w-4 text-(--dc-brief-place)" />
        <h3 className="text-sm font-semibold text-gray-900">
          Exceptions ({count ?? rows.length})
        </h3>
        <span className="text-xs text-gray-500">
          Roughly one serial in twelve needs a person. This is the normal path.
        </span>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 p-3 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading exceptions...
        </p>
      ) : rows.length === 0 ? (
        <p className="p-3 text-sm text-gray-500">No exceptions in this batch.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
            <button
              type="button"
              aria-pressed={group === "all"}
              onClick={() => setGroup("all")}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                group === "all"
                  ? "border-(--dc-accent) bg-(--dc-accent) text-white"
                  : "border-(--dc-accent)/30 text-(--dc-accent) hover:bg-(--dc-accent-soft)/60"
              }`}
            >
              All {rows.length}
            </button>
            {groups.map((g) => (
              <button
                key={g.key}
                type="button"
                aria-pressed={group === g.key}
                onClick={() => setGroup(g.key)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  group === g.key
                    ? "border-(--dc-brief-place) bg-(--dc-brief-place) text-white"
                    : "border-(--dc-brief-place)/40 text-(--dc-brief-place) hover:bg-(--dc-brief-place-soft)"
                }`}
              >
                <span>{g.title}</span> <span className="tabular-nums">{g.rows.length}</span>
              </button>
            ))}
          </div>

          {chosen && (
            <p className="px-3 pb-2 text-xs text-gray-600">{chosen.what}</p>
          )}

          {pairs.length > 0 && (
            /*
              The work, deduplicated.

              122 rows on the real file were 14 assignments - Solar Sister
              alone appears under five spellings. Listing the rows would be
              the same wall in a different order; listing the PAIRS is the
              actual worklist somebody takes to the ERP.
            */
            <div className="mx-3 mb-2 overflow-hidden rounded-md border border-amber-200 bg-amber-50">
              <p className="border-b border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-900">
                Assign these in the ERP, then check the batch again
              </p>
              <ul className="divide-y divide-amber-100">
                {pairs.map((p) => (
                  <li
                    key={`${p.partner}-${p.model}`}
                    className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5 text-xs text-amber-900"
                  >
                    <span className="font-medium">{p.partner}</span>
                    <span className="text-amber-700">needs</span>
                    <span className="font-medium">{p.model}</span>
                    <span className="ml-auto tabular-nums text-amber-700">
                      {plural(p.rows, "row")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b-2 border-(--dc-accent) bg-(--dc-accent-soft) text-left text-[11px] font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
                  <th scope="col" className="sticky left-0 w-16 bg-(--dc-accent-soft) px-3 py-2">Row</th>
                  <th scope="col" className="px-3 py-2">Buyer</th>
                  <th scope="col" className="px-3 py-2">Phone</th>
                  <th scope="col" className="px-3 py-2">Serial as typed</th>
                  <th scope="col" className="px-3 py-2">Why</th>
                  <th scope="col" className="px-3 py-2">Fix</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 50).map((r) => {
                  const kind = kindOf(r);
                  return (
                    <tr key={r.id} className="border-b border-gray-100 hover:bg-(--dc-accent-soft)/40">
                      <td className="sticky left-0 bg-white px-3 py-2 tabular-nums text-gray-500">
                        {r.row_number}
                      </td>
                      <td className="max-w-[12rem] truncate px-3 py-2 text-gray-800">
                        {buyerOf(r)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-700">
                        {phoneOf(r)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-700">
                        {r.stove_serial_no ?? r.raw?.["Stove ID"] ?? "-"}
                      </td>
                      <td className="px-3 py-2">
                        {/* The full reason travels as the pill's title, so the
                            grouped wall of identical sentences does not come
                            back one column to the left. */}
                        <span
                          title={r.exception_reason ?? ""}
                          className="whitespace-nowrap rounded-full bg-(--dc-brief-place-soft) px-2 py-0.5 text-xs font-medium text-(--dc-brief-place)"
                        >
                          {kind.short}
                        </span>
                        {kind.key === "other" && (
                          <span className="ml-1.5 text-xs text-gray-700">
                            {r.exception_reason}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {!canResolve ? (
                          <span className="text-xs text-gray-500">-</span>
                        ) : kind.fixable ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <input
                              type="text"
                              value={drafts[r.id] ?? r.stove_serial_no ?? ""}
                              onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                              placeholder="Correct serial number"
                              aria-label={`Corrected serial number for row ${r.row_number}`}
                              className="w-36 min-w-0 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-(--dc-accent) focus:outline-none"
                            />
                            <button
                              type="button"
                              disabled={busy === r.id}
                              onClick={() => resolve(r)}
                              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-(image:--dc-fig-unverified) px-2.5 py-1 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                            >
                              {busy === r.id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <Wrench className="h-3 w-3" />}
                              Fix
                            </button>
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500">nothing to fix</span>
                        )}
                        {note?.id === r.id && (
                          <span className="mt-0.5 block text-xs font-medium text-(--dc-sev-critical)">
                            {note.text}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {shown.length > 50 && (
            <p className="px-3 py-2 text-xs text-gray-600">
              Showing the first 50 of {plural(shown.length, "row")}. Pick a reason
              above to narrow them.
            </p>
          )}
        </>
      )}
    </div>
  );
}
