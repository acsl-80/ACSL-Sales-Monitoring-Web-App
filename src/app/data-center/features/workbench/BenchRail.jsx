import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Check, PenLine, Circle, X, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { plural } from "../../lib/plural";

/**
 * The consignment, beside the form instead of behind it.
 *
 * WHAT WAS SLOW
 *
 * Opening a stove replaced the whole navigator with the form. Finishing one
 * receipt and starting the next meant: back to the consignment, find where you
 * were in a paginated table of forty stove IDs, click the next one, wait for it
 * to load. Three actions and a page change between every two records, for a job
 * that is the same eleven fields over and over.
 *
 * A typist working from a stack of paper does not navigate. They pick up the
 * next sheet. So the whole consignment sits beside the form: every stove ID at
 * a glance, what has been done to each, and one click to switch. Nothing is
 * refetched when they switch, because the list was loaded once when the
 * consignment was opened and is handed down rather than asked for again.
 *
 * WHY A SEARCH BOX ON A LIST OF FORTY
 *
 * Because the stack of paper is not in the system's order. The receipt in your
 * hand names a stove ID, and finding that row by eye in forty is slower than
 * typing the last three digits of it. The filter matches anywhere in the ID for
 * exactly that reason - nobody reads out a serial from the front.
 *
 * WHY THE RAIL NEVER UNMOUNTS
 *
 * It used to. Every sweep fetch nulled the rows and the parent mounted the rail
 * behind `&& stoves`, so typing a search term tore the rail - input, focus and
 * term - out of the page and put a fresh one back, whose own mount-time
 * debounce then fired an empty search and erased what the typist was doing.
 * Now the rows stay rendered while the next page loads, a `loading` flag dims
 * them, and the search term lives in the parent, so there is nothing here for
 * a re-render to lose.
 */

const TONE = {
  todo: {
    icon: Circle,
    dot: "text-gray-300",
    label: "not typed",
  },
  draft: {
    icon: PenLine,
    dot: "text-amber-500",
    label: "part typed",
  },
  done: {
    icon: Check,
    dot: "text-(--dc-accent)",
    label: "recorded",
  },
};

/** What has happened to one stove, in the order that decides the icon. */
export function stoveState(stove, draftSerials) {
  // `just_recorded` is set locally the moment a save returns, so the rail goes
  // green under the typist's hand rather than on the next refetch.
  if (stove.sale_id || stove.just_recorded) return "done";
  if (draftSerials.has(String(stove.stove_id).toUpperCase())) return "draft";
  return "todo";
}

export default function BenchRail({
  stoves,
  current,
  drafts = [],
  onPick,
  /**
   * Where the search runs.
   *
   * `onSearchInput` absent, the rail filters the list it was handed, which is
   * right for a consignment: forty stoves, all of them loaded, and an instant
   * answer.
   *
   * Present, the parent is working a whole partner and only a page of it is
   * loaded, so the term is the PARENT'S state - handed down as `search`, sent
   * back a keystroke at a time - and the parent debounces the server round
   * trip. Owned here it was lost on every remount, and the remount's own
   * debounce fired `onSearch("")` and erased the search mid-word. A filter
   * that silently searched only the loaded page would answer "not found" for
   * a stove that is there, which is the one answer a typist holding that
   * stove's receipt must never be given.
   */
  onSearchInput = null,
  search = "",
  /**
   * One page of a larger list, with the numbers to page it.
   *
   * Same shape StoveList takes: {page, pageSize, total, totals, filter,
   * onPage, onFilter}. The chips and the progress bar read `totals` - the
   * server's counts over the whole partner - because counting the loaded page
   * is how the sidebar came to disagree with the number at the base of the
   * list. Absent, the rows ARE the whole set and counting them here is right.
   */
  server = null,
  /** True while the next page is on its way; the previous rows stay put. */
  loading = false,
  title = "This consignment",
  footer = null,
}) {
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState("todo");
  const currentRef = useRef(null);

  const controlled = onSearchInput !== null;
  const term = controlled ? search : query;
  const setTerm = controlled ? onSearchInput : setQuery;
  const filter = server ? server.filter : only;
  const setFilter = server ? server.onFilter : setOnly;

  const draftSerials = useMemo(
    () => new Set(drafts.map((d) => String(d).toUpperCase())),
    [drafts],
  );

  const decorated = useMemo(
    () => (stoves ?? []).map((s) => ({ ...s, state: stoveState(s, draftSerials) })),
    [stoves, draftSerials],
  );

  // Counted by whoever holds the whole set: the server across a partner, this
  // page when the page is everything there is.
  const counts = server?.totals ?? {
    todo: decorated.filter((s) => s.state !== "done").length,
    done: decorated.filter((s) => s.state === "done").length,
    all: decorated.length,
  };

  const shown = useMemo(() => {
    const needle = term.trim().toUpperCase();
    return decorated.filter((s) => {
      /*
       * The search applies to everything; the status filter does not apply to
       * the one being typed.
       *
       * Those are different kinds of narrowing and they need different rules.
       * The status filter changes under the typist's feet - finishing a record
       * makes it "done", "still to type" drops it, and the rail scrolls out
       * from under the form they are still looking at - so the open one is
       * pinned against it.
       *
       * A search is a deliberate act with a different question behind it: "is
       * PRV000123 in this consignment". Pinning the open row through a search
       * too meant a term matching nothing still showed one row, so the rail
       * could never answer "no". Which is the wrong answer to give somebody
       * holding a receipt for a stove that turns out to be in another
       * consignment entirely.
       */
      // With a server search the rows already ARE the matches, so filtering
      // them again here would only remove rows the server decided to include.
      if (needle) return controlled ? true : String(s.stove_id).toUpperCase().includes(needle);
      if (s.stove_id === current) return true;
      if (filter === "todo" && s.state === "done") return false;
      if (filter === "done" && s.state !== "done") return false;
      return true;
    });
  }, [decorated, filter, term, controlled, current]);

  // Keep the open one in view when it changes from outside - which is what
  // "save and next" does.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const typed = counts.done ?? 0;
  const outOf = counts.all ?? 0;
  const pages = server ? Math.max(1, Math.ceil((server.total || 0) / server.pageSize)) : 1;

  return (
    <aside className="flex max-h-[75dvh] min-h-0 w-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm lg:w-72 lg:shrink-0">
      <div className="shrink-0 border-b border-gray-100 bg-(--dc-accent-soft)/40 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {loading && <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-label="Loading" />}
        </p>
        {/*
          A run that visibly shrinks. Typing forty receipts with no sense of
          how many are left is the part people describe as endless, and the
          bar costs nothing to draw.
        */}
        <p className="mt-0.5 text-sm text-gray-700">
          <span className="font-semibold tabular-nums text-gray-900">{typed}</span> of{" "}
          <span className="tabular-nums">{outOf}</span> recorded
        </p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-(--dc-accent) transition-all"
            style={{ width: `${outOf ? (typed / outOf) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-b border-gray-100 px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Last digits of the ID"
            aria-label={
              controlled ? "Find a stove this partner holds" : "Find a stove in this consignment"
            }
            className="w-full rounded-md border border-gray-300 py-1 pl-7 pr-6 text-xs focus:border-(--dc-accent) focus:outline-none"
          />
          {term && (
            <button
              type="button"
              onClick={() => setTerm("")}
              aria-label="Clear the search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="flex gap-1">
          {[
            { key: "todo", label: "To type", n: counts.todo },
            { key: "done", label: "Done", n: counts.done },
            { key: "all", label: "All", n: counts.all },
          ].map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`flex-1 rounded-md border px-1.5 py-1 text-[11px] font-medium transition ${
                filter === f.key
                  ? "border-(--dc-accent) bg-(--dc-accent) text-white"
                  : "border-gray-200 text-gray-600 hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/40"
              }`}
            >
              {f.label} {f.n ?? ""}
            </button>
          ))}
        </div>
      </div>

      <ul
        className={`min-h-0 flex-1 overflow-y-auto transition-opacity ${
          loading && decorated.length > 0 ? "opacity-60" : ""
        }`}
      >
        {stoves === null ? (
          // First load only. After that the previous page stays on screen,
          // dimmed, so the input above never loses its mount or its focus.
          <li className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading stove IDs...
          </li>
        ) : shown.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-gray-500">
            {term ? `No stove ID here contains "${term}".` : "Nothing under that filter."}
          </li>
        ) : (
          shown.map((s) => {
            const tone = TONE[s.state];
            const Icon = tone.icon;
            const open = s.stove_id === current;
            return (
              <li key={s.stove_id} ref={open ? currentRef : null}>
                <button
                  type="button"
                  onClick={() => onPick(s)}
                  aria-current={open ? "true" : undefined}
                  title={`${s.stove_id}: ${tone.label}`}
                  className={`flex w-full items-center gap-2 border-l-[3px] px-3 py-1.5 text-left transition ${
                    open
                      ? "border-l-(--dc-accent) bg-(--dc-accent-soft)/60"
                      : "border-l-transparent hover:bg-gray-50"
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${tone.dot}`} />
                  <span
                    className={`min-w-0 flex-1 truncate font-mono text-xs ${
                      open ? "font-bold text-(--dc-accent-strong)" : "text-gray-800"
                    }`}
                  >
                    {s.stove_id}
                  </span>
                  <span className="max-w-[7rem] truncate text-[11px] text-gray-500">
                    {s.end_user_name ?? ""}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
      {/*
        The pager, where the inert count used to be.

        A partner holds thousands and the rail holds a page, so prev and next
        have to live here - the module's full Pagination sits in the list view,
        unreachable while a form is open, which is exactly when a typist needs
        to move on. Keyset paging means these two steps are the only honest
        moves anyway.
      */}
      {server && (
        <div className="shrink-0 flex items-center justify-between gap-1 border-t border-gray-100 px-2 py-1.5">
          <button
            type="button"
            aria-label="Previous page"
            disabled={server.page === 0 || loading}
            onClick={() => server.onPage(server.page - 1)}
            className="rounded-md border border-gray-200 p-1 text-gray-600 transition hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/40 disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <p className="min-w-0 truncate text-center text-[11px] tabular-nums text-gray-600">
            Page {server.page + 1} of {pages} · {plural(server.total ?? 0, "stove")}
          </p>
          <button
            type="button"
            aria-label="Next page"
            disabled={server.page + 1 >= pages || loading}
            onClick={() => server.onPage(server.page + 1)}
            className="rounded-md border border-gray-200 p-1 text-gray-600 transition hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/40 disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {footer && <div className="shrink-0 border-t border-gray-100 px-3 py-2">{footer}</div>}
    </aside>
  );
}
