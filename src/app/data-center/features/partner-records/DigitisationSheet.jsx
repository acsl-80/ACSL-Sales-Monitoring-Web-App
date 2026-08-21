import { useCallback, useEffect, useMemo, useState } from "react";
import { dataCenterClient, DataCenterError } from "../../lib/client";
import { toCsv, downloadCsv } from "../../lib/export";
import { plural } from "../../lib/plural";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Download, FileSpreadsheet, TriangleAlert } from "lucide-react";

/**
 * The sheet the digitisers actually type into.
 *
 * The import used to begin with a blank template and a printed transfer list,
 * so every stove ID was typed by hand. That is the one error the import cannot
 * recover from: a mistyped serial does not look like a typo, it looks like a
 * stove that is not ours, and it lands in the exceptions queue for somebody to
 * work out by eye.
 *
 * So the sheet comes out of the system already carrying the two things that
 * cannot be read off a receipt - the stove ID and the transfer it went out on -
 * and the digitiser fills in the buyer beside each one. Because the serials are
 * then correct by construction, the import can work out the partner itself and
 * nobody has to pick one from a list of 278.
 *
 * Stoves already recorded are offered separately rather than dropped. Removing
 * them silently makes a sheet short for no visible reason; saying so lets
 * somebody skip them on purpose.
 */

/**
 * What the digitiser fills in, in the order a receipt reads.
 *
 * Every heading here is one the import's alias table recognises, so a sheet
 * that comes back untouched maps itself and nobody opens the column mapper.
 */
const BLANK_COLUMNS = [
  "User First Name",
  "User Last Name",
  "Primary Phone Number",
  "Alternative Phone Number",
  "Sales Date",
  "Sale Amount",
  "Amount Received",
  "State",
  "LGA",
  "User Residential Address",
  "AKA",
];

/** Carried from the transfer, so they are right before anyone types. */
const CARRIED_COLUMNS = ["Stove ID", "Transaction ID", "Partner", "Sales Rep", "Transfer Date"];

export default function DigitisationSheet({ organizationId, partnerName, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [month, setMonth] = useState("");
  const [includeRecorded, setIncludeRecorded] = useState(false);

  const load = useCallback(async () => {
    setData(null);
    try {
      setData(await dataCenterClient.digitisationSheet(organizationId, month || null));
      setError(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not build that sheet.");
    }
  }, [organizationId, month]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = data?.rows ?? [];
  const fresh = useMemo(() => rows.filter((r) => !r.already_recorded), [rows]);
  const recorded = rows.length - fresh.length;
  const chosen = includeRecorded ? rows : fresh;

  const download = () => {
    const out = chosen.map((r) => {
      const row = {
        "Stove ID": r.stove_id,
        "Transaction ID": r.transaction_id,
        "Partner": r.partner_name,
        "Sales Rep": r.sales_rep ?? "",
        "Transfer Date": r.sales_date ?? "",
      };
      for (const c of BLANK_COLUMNS) row[c] = "";
      return row;
    });
    const name = (partnerName ?? "partner").replace(/\W+/g, "-").toLowerCase();
    downloadCsv(
      `digitisation-${name}${month ? `-${month}` : ""}.csv`,
      toCsv(out, [...CARRIED_COLUMNS, ...BLANK_COLUMNS]),
    );
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="dc-root flex max-h-[90dvh] w-[90vw] max-w-[90vw] flex-col gap-0 overflow-hidden border-0 p-0 sm:max-w-[90vw]"
        data-area="partner-records"
      >
        <DialogHeader className="border-b border-gray-100 bg-(--dc-accent-soft)/40 px-5 py-4 text-left">
          <DialogTitle className="text-base">
            Sheet for digitalisation: {partnerName}
          </DialogTitle>
          <DialogDescription>
            One row per stove this partner was sent, with the stove ID and
            transfer reference already filled in. Type the buyer beside each one
            and upload it under Bulk Import. You will not be asked which partner
            it is: the stove IDs say so.
          </DialogDescription>
        </DialogHeader>

        <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto p-5">
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

          {!data && !error ? (
            <p className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Building the sheet...
            </p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">
                    Month transferred
                  </span>
                  <select
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    className="w-56 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none"
                  >
                    <option value="">Every month</option>
                    {(data?.months ?? []).map((m) => (
                      <option key={m.month} value={m.month}>
                        {m.month} ({plural(m.transfers, "transfer")})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-lg border border-(--dc-accent)/20 bg-(--dc-accent-soft)/30 px-3 py-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-600">
                    Still to type up
                  </p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
                    {fresh.length}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-600">
                    Already recorded
                  </p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-700">
                    {recorded}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-600">
                    Transferred in total
                  </p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-700">
                    {rows.length}
                  </p>
                </div>
              </div>

              {recorded > 0 && (
                <label className="mb-4 flex items-start gap-2 rounded-lg border border-(--dc-accent)/20 bg-(--dc-accent-soft)/20 p-3 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={includeRecorded}
                    onChange={(e) => setIncludeRecorded(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-(--dc-accent)"
                  />
                  <span>
                    Include the {plural(recorded, "stove")} already recorded.
                    Off by default: typing them again produces rows the import
                    will refuse as duplicates.
                  </span>
                </label>
              )}

              {fresh.length === 0 && !includeRecorded && (
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <p className="text-sm text-amber-900">
                    Every stove in this selection has already been recorded.
                    Choose another month, or tick the box above to download them
                    anyway.
                  </p>
                </div>
              )}

              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                  What the sheet contains
                </p>
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-gray-100">
                      <tr>
                        <td className="w-40 bg-(--dc-accent-soft)/40 px-3 py-2 align-top text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
                          Filled in already
                        </td>
                        <td className="px-3 py-2 text-gray-700">
                          {CARRIED_COLUMNS.join(", ")}
                        </td>
                      </tr>
                      <tr>
                        <td className="bg-(--dc-accent-soft)/40 px-3 py-2 align-top text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
                          For you to fill
                        </td>
                        <td className="px-3 py-2 text-gray-700">
                          {BLANK_COLUMNS.join(", ")}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-gray-600">
                  Format the phone column as Text before typing. Left as numbers,
                  a spreadsheet drops the leading zero from every number in it.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={download}
            disabled={chosen.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-4 py-1.5 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            Download {plural(chosen.length, "row")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The button that opens it, so Partner Records only imports one thing. */
export function DigitisationSheetButton({ organizationId, partnerName }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent)/30 px-2.5 py-1.5 text-sm font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60"
      >
        <FileSpreadsheet className="h-4 w-4" /> Sheet for digitalisation
      </button>
      {open && (
        <DigitisationSheet
          organizationId={organizationId}
          partnerName={partnerName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
