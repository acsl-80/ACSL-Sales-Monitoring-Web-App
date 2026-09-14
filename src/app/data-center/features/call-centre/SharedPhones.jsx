import { useCallback, useEffect, useState } from "react";
import Link from "@/compat/Link";
import { dataCenterClient, DataCenterError } from "../../lib/client";
import ExportButton from "../../components/ExportButton";
import { plural } from "../../lib/plural";
import {
  Users, Loader2, AlertTriangle, Search, ChevronDown, ChevronRight, Check,
} from "lucide-react";

/**
 * Every phone number carrying more than one stove.
 *
 * One household with one number and two stoves is ordinary - a man buys for
 * two wives and writes one number twice. A mistyped digit repeated across a
 * batch looks exactly the same in a count, and the only way to tell is to read
 * the records side by side: same surname, same address, serials in sequence
 * off one consignment is a family; two names in two states is a typo.
 *
 * So this shows the records, not a tally. It is a working surface for whoever
 * decides which one it is, and the amber marks say what has been decided:
 * flagged at digitalisation is a guess, confirmed on a call is a fact.
 */

const dateOf = (v) => (v ? new Date(v).toLocaleDateString() : "-");

const SOURCE_LABEL = {
  digitalisation: "flagged while typing up",
  call_centre: "confirmed on a call",
  sales_app: "entered in the sales app",
};

const EXPORT_COLUMNS = [
  { key: "phone_tail", label: "Telephone number (last 10)" },
  { key: "stove_id", label: "Serial number" },
  { key: "buyer", label: "Customer name" },
  { key: "partner", label: "Sales partner" },
  { key: "address", label: "State" },
  { key: "lga", label: "LGA" },
  { key: "sales_date", label: "Sales date" },
  { key: "phone_as_written", label: "Number as written" },
  { key: "source", label: "How it was found" },
  { key: "confirmed", label: "Confirmed" },
  { key: "recorded_by", label: "Recorded by" },
  { key: "recorded_at", label: "Recorded" },
  { key: "note", label: "Note" },
];

function Group({ group }) {
  const [open, setOpen] = useState(false);
  const names = new Set(group.stoves.map((s) => (s.buyer ?? "").trim().toLowerCase()));
  const places = new Set(group.stoves.map((s) => (s.address ?? "").trim().toLowerCase()));

  /**
   * A hint, never a verdict.
   *
   * Same name and same state is what a household looks like; different names
   * in different states is what a typo looks like. Neither is proof, so this
   * says what it noticed rather than what it concluded - the person reading
   * decides, and a wrong verdict shown confidently is worse than no verdict.
   */
  const looksLikeHousehold = names.size === 1 && places.size === 1;

  return (
    <li className="border-b border-gray-100 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left transition hover:bg-(--dc-accent-soft)/40"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
        )}
        <span className="font-mono text-sm font-semibold text-gray-900">
          {group.stoves[0]?.phone_as_written ?? group.phone_tail}
        </span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
          {plural(group.stove_count, "stove")}
        </span>
        {group.any_confirmed ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-(--dc-accent-soft) px-2 py-0.5 text-xs font-medium text-(--dc-accent-strong)">
            <Check className="h-3 w-3" /> confirmed on a call
          </span>
        ) : (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            not confirmed yet
          </span>
        )}
        <span className="text-xs text-gray-600">
          {looksLikeHousehold
            ? "same name, same state — reads like one household"
            : "different names or places — worth checking for a mistyped digit"}
        </span>
        <span className="ml-auto text-xs text-gray-500">{dateOf(group.last_touched)}</span>
      </button>

      {open && (
        <div className="overflow-x-auto border-t border-gray-100 bg-gray-50/60 px-4 py-3">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                {["Serial number", "Customer name", "Sales partner", "State", "LGA", "Sales date", "How it was found", "By"].map((h) => (
                  <th key={h} scope="col" className="pb-1.5 pr-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {group.stoves.map((s) => (
                <tr key={s.sale_id}>
                  <td className="py-1.5 pr-3">
                    <Link
                      href={`/data-center/stove/${encodeURIComponent(s.stove_id ?? "")}`}
                      className="font-mono text-(--dc-accent) underline decoration-(--dc-accent)/30 underline-offset-2"
                    >
                      {s.stove_id ?? "-"}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3 font-medium text-gray-900">{s.buyer ?? "-"}</td>
                  <td className="py-1.5 pr-3 text-gray-700">{s.partner ?? "-"}</td>
                  <td className="py-1.5 pr-3 text-gray-700">{s.address ?? "-"}</td>
                  <td className="py-1.5 pr-3 text-gray-700">{s.lga ?? "-"}</td>
                  <td className="py-1.5 pr-3 text-gray-500">{dateOf(s.sales_date)}</td>
                  <td className="py-1.5 pr-3 text-gray-700">
                    {SOURCE_LABEL[s.source] ?? s.source}
                    {s.note ? <span className="block text-xs text-gray-500">{s.note}</span> : null}
                  </td>
                  <td className="py-1.5 text-gray-500">{s.recorded_by ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}

export default function SharedPhones() {
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setApplied(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    dataCenterClient
      .sharedPhones({ search: applied || undefined })
      .then((r) => {
        setGroups(r.rows ?? []);
        setError(null);
      })
      .catch((err) =>
        setError(
          err instanceof DataCenterError ? err.message : "Could not load the register.",
        ),
      );
  }, [applied]);

  useEffect(load, [load]);

  const flat = () =>
    (groups ?? []).flatMap((g) =>
      g.stoves.map((s) => ({ ...s, phone_tail: g.phone_tail, confirmed: s.confirmed ? "yes" : "no" })),
    );

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/40 px-4 py-3">
        <Users className="h-4 w-4 text-(--dc-accent)" />
        <h2 className="text-sm font-semibold text-gray-900">Numbers with more than one stove</h2>
        {groups && (
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
            {plural(groups.length, "number")}
          </span>
        )}
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <div className="relative w-full min-w-0 sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Number, buyer or serial number"
              aria-label="Search the shared number register"
              className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:border-(--dc-accent) focus:outline-none"
            />
          </div>
          <ExportButton
            columns={EXPORT_COLUMNS}
            rows={flat}
            filename="shared-phone-numbers.csv"
            label="Export the register"
            disabled={!groups || groups.length === 0}
          />
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900">{error}</p>
        </div>
      )}

      {!groups && !error ? (
        <p className="flex items-center gap-2 p-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the register...
        </p>
      ) : groups && groups.length === 0 ? (
        <p className="m-4 rounded-lg border border-dashed border-(--dc-accent)/30 p-6 text-center text-sm text-gray-500">
          {applied
            ? "No number here matches that."
            : "No number is carrying more than one stove. Numbers land here when a sheet is typed up with one repeated, or when an agent confirms on a call that a household has two."}
        </p>
      ) : (
        <ul>
          {(groups ?? []).map((g) => (
            <Group key={g.phone_tail} group={g} />
          ))}
        </ul>
      )}
    </section>
  );
}
