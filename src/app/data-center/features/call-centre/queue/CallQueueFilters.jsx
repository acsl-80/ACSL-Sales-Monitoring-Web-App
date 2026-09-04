import { cloneElement, useId } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useRecordFacets } from "../../../lib/useRecordFacets";
import { X } from "lucide-react";

/**
 * The queue you can narrow.
 *
 * The facets the records page already offers (partner, sales rep on the
 * transfer) plus the ones the call centre asks about (verification, and the
 * call agent holding the record, when the reader may see the agents). Every
 * choice is written to the URL, never held in state: back restores it, a
 * narrowed queue can be sent to somebody as a link, and the page's own
 * drill machinery turns the same parameters into server filters and the
 * banner above the queue. The server already accepts every key here for the
 * call centre table; this is the client catching up.
 */

const OUTCOMES = [
  { value: "not_verified", label: "Yet to be resolved" },
  { value: "partially_verified", label: "Partly verified" },
  { value: "fully_verified", label: "Fully verified" },
  { value: "unreachable", label: "Unreachable" },
];

/** A labelled control, associated by id rather than by wrapping. */
function Field({ label, children }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </label>
      {cloneElement(children, { id, "aria-label": label })}
    </div>
  );
}

export default function CallQueueFilters({ agents = null }) {
  const search = useSearch({ from: "/data-center/call-centre" });
  const navigate = useNavigate();
  const { facets } = useRecordFacets();

  const set = (key, value) =>
    navigate({
      to: "/data-center/call-centre",
      // The dashboard's label describes the figure it came from; a facet the
      // reader sets replaces that description with the filters themselves.
      search: (prev) => ({ ...prev, [key]: value || undefined, label: undefined }),
    });

  const partnerName = (id) => facets.partners.find((p) => p.id === id)?.name ?? "a partner";
  const agentName = (id) => (agents ?? []).find((a) => a.agent_id === id)?.full_name ?? "an agent";
  const active = [
    search.organizationId && { key: "organizationId", text: partnerName(search.organizationId) },
    search.transferSalesRep && { key: "transferSalesRep", text: `rep ${search.transferSalesRep}` },
    search.verificationOutcome && { key: "verificationOutcome", text: OUTCOMES.find((o) => o.value === search.verificationOutcome)?.label ?? search.verificationOutcome },
    search.assignedAgent && { key: "assignedAgent", text: `held by ${agentName(search.assignedAgent)}` },
  ].filter(Boolean);

  return (
    <div data-queue-filters className="border-b border-gray-100 bg-(--dc-accent-soft)/25 px-4 py-3">
      <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${agents ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        <Field label="Partner">
          <SearchableSelect
            value={search.organizationId ?? ""}
            onChange={(next) => set("organizationId", next)}
            placeholder="Any partner"
            pinned={{ value: "", label: "Any partner" }}
            options={facets.partners.map((p) => ({ value: p.id, label: p.name ?? "unnamed" }))}
          />
        </Field>
        <Field label="Sales rep on the transfer">
          <SearchableSelect
            value={search.transferSalesRep ?? ""}
            onChange={(next) => set("transferSalesRep", next)}
            placeholder="Any rep"
            pinned={{ value: "", label: "Any rep" }}
            options={facets.salesReps.map((r) => ({ value: r.name, label: r.name }))}
          />
        </Field>
        <Field label="Verification">
          <SearchableSelect
            value={search.verificationOutcome ?? ""}
            onChange={(next) => set("verificationOutcome", next)}
            placeholder="Any state"
            pinned={{ value: "", label: "Any state" }}
            options={OUTCOMES}
          />
        </Field>
        {agents && (
          <Field label="Held by">
            <SearchableSelect
              value={search.assignedAgent ?? ""}
              onChange={(next) => set("assignedAgent", next)}
              placeholder="Anybody"
              pinned={{ value: "", label: "Anybody" }}
              options={agents.map((a) => ({ value: a.agent_id, label: a.full_name || a.email || "agent" }))}
            />
          </Field>
        )}
      </div>
      {active.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {active.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => set(a.key, "")}
              className="inline-flex items-center gap-1 rounded-full border border-(--dc-accent)/40 bg-white py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-(--dc-accent-strong)"
            >
              {a.text} <X className="h-3 w-3" aria-hidden />
            </button>
          ))}
          <span className="ml-auto text-[11px] text-gray-500">Filters live in the address bar, so back and a shared link keep them.</span>
        </div>
      )}
    </div>
  );
}
