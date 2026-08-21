import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Download, ChevronDown } from "lucide-react";
import { toCsv, downloadCsv } from "../lib/export";
import { plural } from "../lib/plural";

/**
 * Export, with a say in what goes in it.
 *
 * Every table in the module exported all of its columns and nothing else was
 * offered, which is fine until the export is the input to something. A funnel
 * pasted into a partner's own spreadsheet wants four columns; the same table
 * pasted into a reconciliation wants twenty and the internal ids as well.
 *
 * The picker is a popover so it does not push the table down, and the choice
 * is per-mount rather than remembered: an export is a one-off act, and a
 * remembered column set is how somebody sends a file that quietly omits the
 * column the recipient asked for.
 */
export default function ExportButton({
  columns,
  rows,
  filename,
  label = "Export CSV",
  disabled,
}) {
  const [excluded, setExcluded] = useState(() => new Set());
  const [open, setOpen] = useState(false);

  const chosen = columns.filter((c) => !excluded.has(c.key));

  const toggle = (key) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const run = () => {
    const data = rows().map((row) =>
      Object.fromEntries(chosen.map((c) => [c.label, c.get ? c.get(row) : row[c.key]])),
    );
    downloadCsv(filename, toCsv(data, chosen.map((c) => c.label)));
    setOpen(false);
  };

  return (
    <div className="inline-flex overflow-hidden rounded-md border border-(--dc-accent)/30">
      <button
        type="button"
        onClick={run}
        disabled={disabled || chosen.length === 0}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60 disabled:opacity-40"
      >
        <Download className="h-4 w-4" /> {label}
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            // Named after its own export, because a page can carry two of
            // these and "Choose columns to export" twice tells a screen
            // reader nothing about which table it belongs to.
            aria-label={`Choose columns for ${label}`}
            className="border-l border-(--dc-accent)/30 px-1.5 py-1.5 text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60 disabled:opacity-40"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="dc-root w-[min(20rem,90vw)] p-0">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              {plural(chosen.length, "column")}
            </p>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setExcluded(new Set())}
                className="rounded px-1.5 py-0.5 text-xs font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)"
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setExcluded(new Set(columns.map((c) => c.key)))}
                className="rounded px-1.5 py-0.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
              >
                None
              </button>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto p-1.5">
            {columns.map((c) => (
              <label
                key={c.key}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 hover:bg-(--dc-accent-soft)/40"
              >
                <input
                  type="checkbox"
                  checked={!excluded.has(c.key)}
                  onChange={() => toggle(c.key)}
                  className="h-4 w-4 accent-(--dc-accent)"
                />
                {c.label}
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
