import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Download, ChevronDown, Check } from "lucide-react";
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
 * The picker is a centred dialog at 90% of the viewport rather than a popover
 * anchored to the button. A table here can carry twenty columns, and twenty
 * checkboxes inside a 20rem popover is a scroll within a scroll on a desktop
 * and unusable in a hand. At 90% the whole list is in front of you, in columns
 * of its own, and choosing reads as the deliberate act it is.
 *
 * The choice is per-mount rather than remembered: an export is a one-off act,
 * and a remembered column set is how somebody sends a file that quietly omits
 * the column the recipient asked for.
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
  const subject = label.replace(/^Export /i, "");

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
    <>
      <div className="inline-flex overflow-hidden rounded-md border border-(--dc-accent)/30">
        <button
          type="button"
          onClick={run}
          disabled={disabled || chosen.length === 0}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60 disabled:opacity-40"
        >
          <Download className="h-4 w-4" /> {label}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          // Named after what it picks columns for, because a page can carry
          // several exports and one shared label tells a screen reader nothing
          // about which table it belongs to. The word "Export" is deliberately
          // dropped: leaving it in makes this button's name contain the other
          // button's name, so anything looking for "Export CSV" finds two
          // controls and cannot tell them apart.
          aria-label={`Columns for ${subject}`}
          className="border-l border-(--dc-accent)/30 px-1.5 py-1.5 text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60 disabled:opacity-40"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="dc-root flex max-h-[90dvh] w-[90vw] max-w-[90vw] flex-col gap-0 overflow-hidden border-0 p-0 sm:max-w-[90vw]">
          <DialogHeader className="border-b border-gray-100 bg-(--dc-accent-soft)/40 px-5 py-4 text-left">
            <DialogTitle className="text-base">Columns for {subject}</DialogTitle>
            <DialogDescription>
              Everything ticked goes into the file, in this order. Untick what the
              person opening it does not need.
            </DialogDescription>
          </DialogHeader>

          <div className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setExcluded(new Set())}
                className="rounded-md border border-(--dc-accent)/30 px-2.5 py-1.5 text-sm font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => setExcluded(new Set(columns.map((c) => c.key)))}
                className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Clear all
              </button>
              <p className="text-sm text-gray-600">
                {plural(chosen.length, "column")} of {columns.length}
              </p>
            </div>

            {/* Columns of checkboxes, so twenty of them are one glance rather
                than one scroll. Steps 1 to 2 to 3 with the width. */}
            <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
              {columns.map((c) => (
                <label
                  key={c.key}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 transition hover:bg-(--dc-accent-soft)/40"
                >
                  <input
                    type="checkbox"
                    checked={!excluded.has(c.key)}
                    onChange={() => toggle(c.key)}
                    className="h-4 w-4 shrink-0 accent-(--dc-accent)"
                  />
                  <span className="min-w-0 truncate">{c.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={run}
              disabled={chosen.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-4 py-1.5 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-40"
            >
              <Check className="h-4 w-4" /> Export {plural(chosen.length, "column")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
