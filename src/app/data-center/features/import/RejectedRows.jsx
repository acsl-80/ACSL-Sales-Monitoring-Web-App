import { useCallback, useEffect, useMemo, useState } from "react";
import { dataCenterImport, DataCenterError } from "../../lib/client";
import { toCsv, downloadCsv } from "../../lib/export";
import { plural } from "../../lib/plural";
import { Loader2, TriangleAlert, Download, Lightbulb } from "lucide-react";

/**
 * The rows that could not be read, and what to do about each.
 *
 * These were counted and never shown. A batch said "12 unreadable" and there
 * was no way to find out which twelve, still less why, so the only recourse
 * was to open the spreadsheet and guess. Twelve rows nobody can see are twelve
 * sales that quietly never happened.
 *
 * Grouped by reason, because a file rejected for one mistake is rejected for
 * it three hundred times: the phone column was formatted as numbers, or the
 * dates are American. Three hundred identical lines hide that; one heading
 * saying "300 rows: Excel removed the leading zero" makes it a single fix.
 *
 * The fix is shown once per group rather than per row, since it is the same
 * sentence every time and repeating it is noise.
 */
export default function RejectedRows({ batchId, count }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [openGroup, setOpenGroup] = useState(null);

  const load = useCallback(async () => {
    try {
      setRows(await dataCenterImport.rows(batchId, "rejected"));
      setError(null);
    } catch (err) {
      setError(
        err instanceof DataCenterError ? err.message : "Could not load the rejected rows.",
      );
    }
  }, [batchId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * One entry per distinct reason.
   *
   * Keyed on the reason with its quoted value stripped out, so
   * `Phone number "8031234567" ...` and `Phone number "8031234568" ...` are one
   * problem rather than two hundred.
   */
  const groups = useMemo(() => {
    const by = new Map();
    for (const r of rows ?? []) {
      const reason = r.rejection_reason ?? "No reason recorded";
      const key = reason.replace(/"[^"]*"/g, '"…"');
      if (!by.has(key)) {
        by.set(key, { key, reason: key, hint: r.rejection_hint, rows: [] });
      }
      by.get(key).rows.push(r);
    }
    return [...by.values()].sort((a, b) => b.rows.length - a.rows.length);
  }, [rows]);

  const exportRejected = () => {
    const all = rows ?? [];
    if (all.length === 0) return;
    // Every column the file had, plus why and how to fix it, so the person
    // opening this can correct it in place and upload it again.
    const headers = [...new Set(all.flatMap((r) => Object.keys(r.raw ?? {})))];
    const out = all.map((r) => ({
      "Row in file": r.row_number,
      ...Object.fromEntries(headers.map((h) => [h, r.raw?.[h] ?? ""])),
      "Why it was refused": r.rejection_reason ?? "",
      "How to fix it": r.rejection_hint ?? "",
    }));
    downloadCsv(
      `rejected-rows-${batchId.slice(0, 8)}.csv`,
      toCsv(out, ["Row in file", ...headers, "Why it was refused", "How to fix it"]),
    );
  };

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (rows === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the rejected rows...
      </p>
    );
  }
  if (rows.length === 0) {
    return <p className="text-sm text-gray-600">Nothing was refused in this batch.</p>;
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <TriangleAlert className="h-4 w-4 text-red-600" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
          Could not be read
        </h3>
        <span className="text-xs text-gray-600">
          {plural(count ?? rows.length, "row")} across{" "}
          {plural(groups.length, "problem")}
        </span>
        <button
          type="button"
          onClick={exportRejected}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent)/30 px-2.5 py-1.5 text-xs font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60"
        >
          <Download className="h-3.5 w-3.5" /> Download to fix
        </button>
      </div>

      <ul className="space-y-2">
        {groups.map((g) => {
          const open = openGroup === g.key;
          return (
            <li
              key={g.key}
              className="overflow-hidden rounded-lg border border-red-200 bg-red-50/40"
            >
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenGroup(open ? null : g.key)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left"
              >
                <span className="mt-0.5 shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-red-800">
                  {g.rows.length}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-900">{g.reason}</span>
                  {g.hint && (
                    <span className="mt-1 flex items-start gap-1.5 text-sm text-gray-700">
                      <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                      {g.hint}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-gray-500">
                  {open ? "hide rows" : "show rows"}
                </span>
              </button>

              {open && (
                <div className="border-t border-red-200 bg-white">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-600">
                          <th className="w-20 px-3 py-1.5 font-semibold">Row</th>
                          <th className="px-3 py-1.5 font-semibold">Serial number</th>
                          <th className="px-3 py-1.5 font-semibold">As it was typed</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {g.rows.slice(0, 50).map((r) => (
                          <tr key={r.id}>
                            <td className="px-3 py-1.5 tabular-nums text-gray-500">
                              {r.row_number}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-xs text-gray-700">
                              {r.stove_serial_no ?? r.raw?.["Serial number"] ?? r.raw?.["Stove ID"] ?? "-"}
                            </td>
                            {/* Shown as it was typed, which is the only version
                                the person fixing it will recognise. */}
                            <td className="max-w-[28rem] truncate px-3 py-1.5 text-xs text-gray-600">
                              {Object.entries(r.raw ?? {})
                                .filter(([, v]) => v !== "" && v != null)
                                .slice(0, 6)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join("  ·  ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {g.rows.length > 50 && (
                    <p className="px-3 py-2 text-xs text-gray-600">
                      Showing the first 50 of {plural(g.rows.length, "row")}. Download
                      to fix has all of them.
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
