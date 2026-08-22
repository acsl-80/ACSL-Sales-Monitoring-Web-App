import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Check, PenLine, Circle, X } from "lucide-react";

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

export default function BenchRail({ stoves, current, drafts = [], onPick }) {
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState("todo");
  const currentRef = useRef(null);

  const draftSerials = useMemo(
    () => new Set(drafts.map((d) => String(d).toUpperCase())),
    [drafts],
  );

  const decorated = useMemo(
    () => (stoves ?? []).map((s) => ({ ...s, state: stoveState(s, draftSerials) })),
    [stoves, draftSerials],
  );

  const counts = useMemo(
    () => ({
      todo: decorated.filter((s) => s.state !== "done").length,
      done: decorated.filter((s) => s.state === "done").length,
      all: decorated.length,
    }),
    [decorated],
  );

  const shown = useMemo(() => {
    const term = query.trim().toUpperCase();
    return decorated.filter((s) => {
      /*
       * The one being typed always stays visible.
       *
       * Otherwise finishing a record makes it "done", the "still to type"
       * filter drops it, and the rail scrolls out from under the form the
       * typist is still looking at.
       */
      if (s.stove_id === current) return true;
      if (only === "todo" && s.state === "done") return false;
      if (only === "done" && s.state !== "done") return false;
      if (term && !String(s.stove_id).toUpperCase().includes(term)) return false;
      return true;
    });
  }, [decorated, only, query, current]);

  // Keep the open one in view when it changes from outside - which is what
  // "save and next" does.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const typed = counts.done;

  return (
    <aside className="flex max-h-[75dvh] min-h-0 w-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm lg:w-72 lg:shrink-0">
      <div className="shrink-0 border-b border-gray-100 bg-(--dc-accent-soft)/40 px-3 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
          This consignment
        </p>
        {/*
          A run that visibly shrinks. Typing forty receipts with no sense of
          how many are left is the part people describe as endless, and the
          bar costs nothing to draw.
        */}
        <p className="mt-0.5 text-sm text-gray-700">
          <span className="font-semibold tabular-nums text-gray-900">{typed}</span> of{" "}
          <span className="tabular-nums">{counts.all}</span> recorded
        </p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-(--dc-accent) transition-all"
            style={{ width: `${counts.all ? (typed / counts.all) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-b border-gray-100 px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Last digits of the ID"
            aria-label="Find a stove in this consignment"
            className="w-full rounded-md border border-gray-300 py-1 pl-7 pr-6 text-xs focus:border-(--dc-accent) focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
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
              aria-pressed={only === f.key}
              onClick={() => setOnly(f.key)}
              className={`flex-1 rounded-md border px-1.5 py-1 text-[11px] font-medium transition ${
                only === f.key
                  ? "border-(--dc-accent) bg-(--dc-accent) text-white"
                  : "border-gray-200 text-gray-600 hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/40"
              }`}
            >
              {f.label} {f.n}
            </button>
          ))}
        </div>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-gray-500">
            {query ? `No stove ID here contains "${query}".` : "Nothing under that filter."}
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
                  title={`${s.stove_id} — ${tone.label}`}
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
    </aside>
  );
}
