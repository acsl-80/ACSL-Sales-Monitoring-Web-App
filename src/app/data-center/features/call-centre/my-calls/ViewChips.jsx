import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { MY_VIEWS, itemsIn } from "./views";

/**
 * The views as a segmented control (Phase 28, D45), the import page's card:
 * the open view is a solid fill in the area's accent, the others outlined,
 * each with the number of records it holds as a pill.
 *
 * Below `sm` the last two, Others and All, fold under More, so five chips fit
 * a phone in two rows and the working surface stays at the top. When the
 * open view is one of the folded two, More wears its name.
 */
export default function ViewChips({ items, view, onView }) {
  const [more, setMore] = useState(false);
  const moreRef = useRef(null);
  useEffect(() => {
    if (!more) return undefined;
    const close = (e) => { if (moreRef.current && !moreRef.current.contains(e.target)) setMore(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [more]);

  const folded = new Set(["others", "all"]);
  const foldedActive = MY_VIEWS.find((v) => folded.has(v.key) && v.key === view.key) ?? null;

  // `display` replaces inline-flex rather than adding to it: two display
  // utilities on one element let the later one in the stylesheet win, and
  // "hidden" lost to "inline-flex" on the first build.
  const chip = (v, display = "inline-flex", extra = "") => {
    const selected = v.key === view.key;
    const n = itemsIn(v, items).length;
    return (
      <button
        key={v.key}
        type="button"
        aria-pressed={selected}
        onClick={() => { onView(v.key); setMore(false); }}
        data-my-view={v.key}
        className={`${display} shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3.5 py-2 text-sm font-semibold transition ${
          selected
            ? "border-(--dc-accent) bg-(--dc-accent) text-white shadow-sm"
            : "border-gray-300 bg-white text-gray-800 hover:border-(--dc-accent) hover:bg-(--dc-accent-soft)/50"
        } ${extra}`}
      >
        {v.label}
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
            selected ? "bg-white/20 text-white" : "bg-(--dc-accent-soft) text-(--dc-accent-strong)"
          }`}
        >
          {n.toLocaleString()}
        </span>
      </button>
    );
  };

  return (
    <div className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm" data-my-views>
      <div className="flex flex-wrap gap-2 px-3 pt-3 pb-2" role="group" aria-label="Which records to see">
        {MY_VIEWS.filter((v) => !folded.has(v.key)).map((v) => chip(v))}
        {MY_VIEWS.filter((v) => folded.has(v.key)).map((v) => chip(v, "hidden sm:inline-flex"))}
        <div className="relative sm:hidden" ref={moreRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={more}
            onClick={() => setMore((m) => !m)}
            data-my-more
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3.5 py-2 text-sm font-semibold transition ${
              foldedActive
                ? "border-(--dc-accent) bg-(--dc-accent) text-white shadow-sm"
                : "border-gray-300 bg-white text-gray-800"
            }`}
          >
            {foldedActive ? foldedActive.label : "More"} <ChevronDown className="h-4 w-4" aria-hidden />
          </button>
          {more && (
            <div role="menu" className="absolute left-0 z-20 mt-1 flex min-w-[10rem] flex-col gap-1 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg" data-my-more-menu>
              {MY_VIEWS.filter((v) => folded.has(v.key)).map((v) => chip(v, "inline-flex", "w-full justify-between"))}
            </div>
          )}
        </div>
      </div>
      <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-600">
        New is what is left to call. The other views hold the records you have concluded or sent to Sales; the numbers are how many records sit in each.
      </p>
    </div>
  );
}
