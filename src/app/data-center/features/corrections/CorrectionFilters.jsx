import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { SearchableSelect } from "@/components/ui/searchable-select";
import Field from "../../components/Field";
import { fieldLabel } from "@/lib/saleDictionary";
import { Search, X } from "lucide-react";

/**
 * The sent-back list you can narrow (D67).
 *
 * Rep, partner and why it came back, plus a search over the serial, the
 * transaction id, the customer's name and the phone. Every choice lives in the
 * URL like the call queue's facets, so back restores it, a narrowed list can be
 * sent as a link, and the workspace's "next record" walks the same list.
 *
 * The choices come from the server with a count each, for the tab being read,
 * so a rep with nothing waiting is never offered.
 */

const KEYS = ["rep", "partner", "reason", "q"];

/** The narrowing part of the search, for links that carry it onward. */
export function narrowingOf(search) {
  const out = {};
  for (const k of [...KEYS, "mine"]) if (search[k]) out[k] = search[k];
  return out;
}

/** `?rep=...&q=...` from a narrowing, or "" when nothing narrows. */
export function queryOf(narrowing) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(narrowing)) if (v) params.set(k, v === true ? "1" : String(v));
  const s = params.toString();
  return s ? `?${s}` : "";
}

export default function CorrectionFilters({ search, facets }) {
  const navigate = useNavigate();
  const [text, setText] = useState(search.q ?? "");

  const set = (patch) =>
    navigate({
      to: "/data-center/corrections",
      search: (prev) => {
        const next = { ...prev, ...patch };
        for (const k of Object.keys(patch)) if (!next[k]) next[k] = undefined;
        return next;
      },
      replace: true,
    });

  // The search box writes to the URL once typing pauses, not on every key.
  useEffect(() => {
    if ((search.q ?? "") === text.trim()) return undefined;
    const t = setTimeout(() => set({ q: text.trim() }), 350);
    return () => clearTimeout(t);
  }, [text]);

  const label = (list, key) => list.find((f) => f.key === key)?.label ?? key;
  const active = [
    search.rep && { key: "rep", text: `rep ${label(facets.reps, search.rep)}` },
    search.partner && { key: "partner", text: search.partner },
    search.reason && { key: "reason", text: label(facets.reasons, search.reason) },
    search.q && { key: "q", text: `"${search.q}"` },
  ].filter(Boolean);

  const option = (f) => ({ value: f.key, label: `${f.label} (${f.n})` });

  return (
    <div className="border-b border-gray-100 bg-(--dc-accent-soft)/25 px-4 py-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="corrections-search" className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Search
          </label>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              id="corrections-search"
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Serial, transaction, name or phone"
              className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm focus:border-(--dc-accent) focus:outline-none"
            />
          </div>
        </div>
        <Field label="Sales rep">
          <SearchableSelect
            value={search.rep ?? ""}
            onChange={(next) => set({ rep: next })}
            placeholder="Any rep"
            searchPlaceholder="Type part of the rep's name"
            pinned={{ value: "", label: "Any rep" }}
            options={facets.reps.map(option)}
          />
        </Field>
        <Field label={fieldLabel("partner_name")}>
          <SearchableSelect
            value={search.partner ?? ""}
            onChange={(next) => set({ partner: next })}
            placeholder="Any partner"
            searchPlaceholder="Type part of the partner's name"
            pinned={{ value: "", label: "Any partner" }}
            options={facets.partners.map(option)}
          />
        </Field>
        <Field label="Why it came back">
          <SearchableSelect
            value={search.reason ?? ""}
            onChange={(next) => set({ reason: next })}
            placeholder="Any reason"
            pinned={{ value: "", label: "Any reason" }}
            options={facets.reasons.map(option)}
          />
        </Field>
      </div>
      {active.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {active.map((a) => (
            <button
              key={a.key}
              type="button"
              aria-label={`Remove filter: ${a.text}`}
              onClick={() => {
                if (a.key === "q") setText("");
                set({ [a.key]: "" });
              }}
              className="inline-flex items-center gap-1 rounded-full border border-(--dc-accent)/40 bg-white py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-(--dc-accent-strong)"
            >
              {a.text} <X className="h-3 w-3" aria-hidden />
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setText("");
              set({ rep: "", partner: "", reason: "", q: "" });
            }}
            className="rounded px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
