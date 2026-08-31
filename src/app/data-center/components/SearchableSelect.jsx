import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

/**
 * A select you can type into.
 *
 * WHY THIS EXISTS
 *
 * The module picks a partner in several places and every one of them was a
 * plain `<select>` over 422 organizations. A native select answers a keystroke
 * by jumping to the first option starting with that letter and then forgetting
 * it, so finding "Sani Umar Gagi" meant scrolling a list four hundred long, and
 * the one thing a person always knows - the first few characters of the name -
 * bought them nothing.
 *
 * Built once, here, rather than as a filter box beside each dropdown. There are
 * several partner pickers and more coming, and a component that four screens
 * share is the difference between fixing this once and fixing it four times.
 *
 * WHAT IT IS NOT
 *
 * Not a fetch-as-you-type control. The options arrive already loaded, which is
 * right at this size: 422 rows is one small request the screens already make,
 * and matching them in the browser is instant where a round trip per keystroke
 * would not be. If a list ever outgrows that, the search moves to the server
 * and this component takes an `onSearch` the way BenchRail does - the shape is
 * deliberately the same so that change is local.
 *
 * ACCESSIBILITY
 *
 * A real combobox: `role="combobox"` on the input, `role="listbox"` on the
 * results, `aria-activedescendant` following the arrow keys, and Escape
 * closing without choosing. Keyboard-only is how somebody entering forty
 * receipts actually works, so it is not decoration here.
 */
export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Choose one",
  searchPlaceholder = "Type to narrow the list",
  emptyLabel = "Nothing matches that",
  disabled = false,
  id,
  label,
  /** Rendered above the matches and always offered, whatever is typed. */
  pinned = null,
}) {
  const generated = useId();
  const boxId = id ?? generated;
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const wrap = useRef(null);
  const input = useRef(null);

  const chosen = useMemo(
    () =>
      pinned && pinned.value === value
        ? pinned
        : (options ?? []).find((o) => o.value === value) ?? null,
    [options, value, pinned],
  );

  const matches = useMemo(() => {
    const t = term.trim().toLowerCase();
    const list = options ?? [];
    if (!t) return list;
    /*
     * Anywhere in the name, not just the front.
     *
     * A partner is often recorded as "LAPO, ISANLU" or "Solar Sister — Main
     * Branch", so the word somebody remembers is regularly not the first one.
     * Matching the front only would hide the row they are looking straight at.
     */
    return list.filter((o) => o.label.toLowerCase().includes(t));
  }, [options, term]);

  const rows = useMemo(
    () => (pinned && !term.trim() ? [pinned, ...matches] : matches),
    [pinned, matches, term],
  );

  useEffect(() => setActive(0), [term, open]);

  // Clicking away closes it. Without this the list stays open behind whatever
  // the person clicked next, which on a form is every other field.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const pick = (o) => {
    onChange(o.value);
    setOpen(false);
    setTerm("");
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rows[active]) pick(rows[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setTerm("");
    }
  };

  return (
    <div className="relative" ref={wrap}>
      {label && (
        <label
          htmlFor={boxId}
          className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-600"
        >
          {label}
        </label>
      )}

      {open ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            ref={input}
            id={boxId}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${boxId}-list`}
            aria-autocomplete="list"
            aria-activedescendant={rows[active] ? `${boxId}-opt-${active}` : undefined}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={onKey}
            placeholder={searchPlaceholder}
            className="w-full rounded-md border border-(--dc-accent) bg-white py-1.5 pl-8 pr-8 text-sm focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setTerm("");
            }}
            aria-label="Close the list"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          id={boxId}
          role="combobox"
          aria-expanded="false"
          aria-controls={`${boxId}-list`}
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-left text-sm transition hover:border-(--dc-accent)/50 focus:border-(--dc-accent) focus:outline-none disabled:opacity-50"
        >
          <span className={chosen ? "truncate text-gray-900" : "truncate text-gray-500"}>
            {chosen?.label ?? placeholder}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
        </button>
      )}

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
          {/*
            Said out loud while typing, because a list that silently narrows
            leaves you unsure whether the one you want is below the fold or not
            in the list at all.
          */}
          <p className="border-b border-gray-100 px-2.5 py-1.5 text-[11px] text-gray-600">
            {term.trim()
              ? `${matches.length} of ${(options ?? []).length} match "${term.trim()}"`
              : `${(options ?? []).length} to choose from`}
          </p>
          <ul id={`${boxId}-list`} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {rows.length === 0 ? (
              <li className="px-2.5 py-2 text-sm text-gray-500">{emptyLabel}</li>
            ) : (
              rows.map((o, i) => (
                <li key={o.value || `pinned-${i}`}>
                  <button
                    type="button"
                    id={`${boxId}-opt-${i}`}
                    role="option"
                    aria-selected={o.value === value}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(o)}
                    className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm transition ${
                      i === active ? "bg-(--dc-accent-soft)" : ""
                    } ${o.value === value ? "font-medium text-(--dc-accent-strong)" : "text-gray-800"}`}
                  >
                    <span className="truncate">
                      {o.label}
                      {o.hint && (
                        <span className="ml-1.5 text-xs text-gray-500">{o.hint}</span>
                      )}
                    </span>
                    {o.value === value && <Check className="h-4 w-4 shrink-0" />}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
