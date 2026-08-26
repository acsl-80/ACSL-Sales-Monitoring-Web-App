import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Download, ChevronDown } from "lucide-react";
import { toCsv, downloadCsv } from "../../lib/export";
import { plural } from "../../lib/plural";
import { scorecardRows, SCORECARD_EXPORT_COLUMNS } from "./Scorecard";

/**
 * Export several scorecards at once, choosing tables and columns first.
 *
 * The five scorecards are the same six measures cut five ways, so the thing
 * somebody usually wants is not one of them: it is partner and location
 * together, or all five to reconcile against a spreadsheet. Exporting them one
 * at a time and pasting five files together is work the page should do.
 *
 * One file rather than five, with a first column naming which cut each row came
 * from. Five files means five things to open and no way to filter across them,
 * which is the whole reason someone is exporting.
 */
export default function ExportScorecards({ cards, metrics }) {
  const [open, setOpen] = useState(false);
  const [skippedCards, setSkippedCards] = useState(() => new Set());
  const [skippedColumns, setSkippedColumns] = useState(() => new Set());

  const chosenCards = cards.filter((c) => !skippedCards.has(c.by));
  const chosenColumns = SCORECARD_EXPORT_COLUMNS.filter((c) => !skippedColumns.has(c.key));

  const toggle = (set, apply) => (key) =>
    apply(() => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleCard = toggle(skippedCards, setSkippedCards);
  const toggleColumn = toggle(skippedColumns, setSkippedColumns);

  const run = () => {
    const rows = [];
    for (const card of chosenCards) {
      for (const row of scorecardRows(metrics, card.by)) {
        rows.push({
          "Scorecard": card.title,
          ...Object.fromEntries(chosenColumns.map((c) => [c.label, row[c.key] ?? 0])),
        });
      }
    }
    downloadCsv(
      "scorecards.csv",
      toCsv(rows, ["Scorecard", ...chosenColumns.map((c) => c.label)]),
    );
    setOpen(false);
  };

  const ready = chosenCards.length > 0 && chosenColumns.length > 0;

  return (
    <div className="inline-flex overflow-hidden rounded-md border border-(--dc-accent)/30">
      <button
        type="button"
        onClick={run}
        disabled={!ready}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60 disabled:opacity-40"
      >
        <Download className="h-4 w-4" /> Export scorecards
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Choose scorecards and columns to export"
            className="border-l border-(--dc-accent)/30 px-1.5 py-1.5 text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="dc-root w-[min(24rem,90vw)] p-0">
          <div className="border-b border-gray-100 px-3 py-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                Which scorecards
              </p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setSkippedCards(new Set())}
                  className="rounded px-1.5 py-0.5 text-xs font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setSkippedCards(new Set(cards.map((c) => c.by)))}
                  className="rounded px-1.5 py-0.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
                >
                  None
                </button>
              </div>
            </div>
            <div className="mt-1">
              {cards.map((c) => (
                <label
                  key={c.by}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-gray-700 hover:bg-(--dc-accent-soft)/40"
                >
                  <input
                    type="checkbox"
                    checked={!skippedCards.has(c.by)}
                    onChange={() => toggleCard(c.by)}
                    className="h-4 w-4 accent-(--dc-accent)"
                  />
                  {c.title}
                </label>
              ))}
            </div>
          </div>

          <div className="px-3 py-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                Which columns
              </p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setSkippedColumns(new Set())}
                  className="rounded px-1.5 py-0.5 text-xs font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSkippedColumns(new Set(SCORECARD_EXPORT_COLUMNS.map((c) => c.key)))
                  }
                  className="rounded px-1.5 py-0.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
                >
                  None
                </button>
              </div>
            </div>
            <div className="mt-1 max-h-48 overflow-y-auto">
              {SCORECARD_EXPORT_COLUMNS.map((c) => (
                <label
                  key={c.key}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-gray-700 hover:bg-(--dc-accent-soft)/40"
                >
                  <input
                    type="checkbox"
                    checked={!skippedColumns.has(c.key)}
                    onChange={() => toggleColumn(c.key)}
                    className="h-4 w-4 accent-(--dc-accent)"
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>

          <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-600">
            {plural(chosenCards.length, "scorecard")},{" "}
            {plural(chosenColumns.length, "column")}, one file.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
