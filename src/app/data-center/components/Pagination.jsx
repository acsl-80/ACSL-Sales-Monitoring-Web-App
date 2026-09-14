import { ChevronLeft, ChevronRight } from "lucide-react";
import { plural } from "../lib/plural";

/**
 * Page controls for the tables that are read rather than scrolled.
 *
 * The module has two kinds of table. The call queue and the stove records are
 * virtualized, because at 500,000 rows the DOM is the bottleneck and a page
 * number is not what an agent working a list wants. Everything else is a list
 * someone reads a screenful at a time, and those get this.
 *
 * Deliberately not a component that fetches. It takes a page and gives back a
 * page, so the same control works over a client-side slice and over a
 * server-side one without knowing which it is.
 */
export default function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  noun = "row",
  sizes = [10, 25, 50, 100],
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-2.5 text-sm">
      <p className="text-gray-600">
        {total === 0 ? (
          `No ${noun}s`
        ) : (
          <>
            <span className="tabular-nums">{from}</span>-
            <span className="tabular-nums">{to}</span> of{" "}
            <span className="font-medium tabular-nums">{plural(total, noun)}</span>
          </>
        )}
      </p>

      <div className="flex items-center gap-3">
        {onPageSize && (
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            Per page
            <select
              value={pageSize}
              onChange={(e) => {
                onPageSize(Number(e.target.value));
                onPage(0);
              }}
              className="rounded-md border border-gray-300 px-1.5 py-1 text-xs text-gray-700 focus:border-(--dc-accent) focus:outline-none"
            >
              {sizes.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPage(page - 1)}
            disabled={page <= 0}
            aria-label="Previous page"
            className="rounded-md border border-gray-300 p-1 text-gray-600 transition hover:border-(--dc-accent)/40 hover:text-(--dc-accent) disabled:opacity-40 disabled:hover:border-gray-300 disabled:hover:text-gray-600"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-1 text-xs tabular-nums text-gray-600">
            {page + 1} / {pages}
          </span>
          <button
            type="button"
            onClick={() => onPage(page + 1)}
            disabled={page + 1 >= pages}
            aria-label="Next page"
            className="rounded-md border border-gray-300 p-1 text-gray-600 transition hover:border-(--dc-accent)/40 hover:text-(--dc-accent) disabled:opacity-40 disabled:hover:border-gray-300 disabled:hover:text-gray-600"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
