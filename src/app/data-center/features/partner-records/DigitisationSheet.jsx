import { useCallback, useEffect, useMemo, useState } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { dataCenterClient, DataCenterError } from "../../lib/client";
import { toCsv, downloadCsv } from "../../lib/export";
import { buildWorkbook, downloadWorkbook } from "../../lib/xlsx";
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
 * Which value from a transfer row fills a locked column.
 *
 * The columns themselves come from `workflow_config`, so the sheet is edited
 * in Settings rather than here. What stays in code is only the join between a
 * column's field name and the transfer it is being filled from, because that
 * is a fact about this query rather than a preference about the sheet.
 */
const CARRIED = {
  stoveSerialNo: (r) => r.stove_id,
  transactionId: (r) => r.transaction_id,
  partnerName: (r) => r.partner_name,
  salesRep: (r) => r.sales_rep ?? "",
  transferDate: (r) => r.sales_date ?? "",
};

/*
 * `area` decides the accent, because this dialog now opens from two places.
 *
 * Radix portals the dialog to <body>, outside whatever page opened it, so the
 * area has to be carried rather than inherited. Opened from Partner Records it
 * stays ochre; opened as step one of a bulk import it is Import's plum, and
 * the colour is one more thing telling the user which job they are in.
 */
export default function DigitisationSheet({
  organizationId,
  partnerName,
  onClose,
  area = "partner-records",
}) {
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

  const columns = data?.columns ?? [];
  const asXlsx = (data?.format ?? "xlsx") === "xlsx";

  const download = () => {
    const out = chosen.map((r) => {
      const row = {};
      for (const c of columns) {
        const fill = CARRIED[c.field];
        row[c.header] = fill ? fill(r) : "";
      }
      return row;
    });
    const name = (partnerName ?? "partner").replace(/\W+/g, "-").toLowerCase();
    const stem = `digitisation-${name}${month ? `-${month}` : ""}`;

    if (asXlsx) {
      /**
       * A workbook, so the choices are choices.
       *
       * A CSV cannot carry a dropdown, and a blank cell under "Previous Stove
       * Type" gets "Charcoal stove", "CHARCOAL" and "chacoal" typed into it -
       * every one a row the import refuses for a value the typist had no way
       * of knowing. The dropdowns move that whole class of failure from after
       * the upload to before it.
       */
      downloadWorkbook(
        `${stem}.xlsx`,
        buildWorkbook(
          columns.map((c) => ({
            header: c.header,
            options: c.options,
            help: c.help ?? (c.required ? "Required." : c.locked ? "Filled in already." : ""),
            width: c.locked ? 18 : 24,
          })),
          out,
          { sheetName: "Digitalisation" },
        ),
      );
    } else {
      downloadCsv(`${stem}.csv`, toCsv(out, columns.map((c) => c.header)));
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="dc-root flex max-h-[90dvh] w-[90vw] max-w-[90vw] flex-col gap-0 overflow-hidden border-0 p-0 sm:max-w-[90vw]"
        data-area={area}
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
                  <div className="w-56">
                    <SearchableSelect
                      ariaLabel="Month transferred"
                      value={month}
                      onChange={setMonth}
                      placeholder="Every month"
                      searchPlaceholder="Type a month"
                      emptyLabel="No month matches that"
                      pinned={{ value: "", label: "Every month" }}
                      options={(data?.months ?? []).map((m) => ({
                        value: m.month,
                        label: m.month,
                        hint: plural(m.transfers, "transfer"),
                      }))}
                    />
                  </div>
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
                          {columns.filter((c) => c.locked).map((c) => c.header).join(", ")}
                        </td>
                      </tr>
                      <tr>
                        <td className="bg-(--dc-accent-soft)/40 px-3 py-2 align-top text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
                          For you to fill
                        </td>
                        <td className="px-3 py-2 text-gray-700">
                          {columns
                            .filter((c) => !c.locked)
                            .map((c) => `${c.header}${c.required ? " *" : ""}`)
                            .join(", ")}
                        </td>
                      </tr>
                      {columns.some((c) => c.options?.length) && (
                        <tr>
                          <td className="bg-(--dc-accent-soft)/40 px-3 py-2 align-top text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
                            Pick from a list
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            {columns
                              .filter((c) => c.options?.length)
                              .map((c) => `${c.header} (${c.options.join(", ")})`)
                              .join("  ·  ")}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-gray-600">
                  {asXlsx
                    ? "The listed columns are dropdowns, so there is nothing to spell. Row 2 is guidance and is skipped on upload."
                    : "Format the phone column as Text before typing. Left as numbers, a spreadsheet drops the leading zero from every number in it."}{" "}
                  The columns come from Settings, so this sheet and the form
                  cannot drift apart.
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
            Download {plural(chosen.length, "row")} ({asXlsx ? "xlsx" : "csv"})
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
