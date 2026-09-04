import { useNavigate, useSearch } from "@tanstack/react-router";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useRecordFacets } from "../../../lib/useRecordFacets";
import { OUTCOME_WORDS } from "../../../lib/outcome";
import Field from "../../../components/Field";
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

// The module's own words for each outcome, so the facet, its chip and the
// Verification column all say the same thing.
const OUTCOMES = ["not_verified", "partially_verified", "fully_verified", "unreachable"].map((value) => ({
  value,
  label: OUTCOME_WORDS[value] ?? value,
}));

export default function CallQueueFilters({ agents = null }) {
  const search = useSearch({ from: "/data-center/call-centre" });
  const navigate = useNavigate();
  const { facets, loading } = useRecordFacets();

  const set = (key, value) =>
    navigate({
      to: "/data-center/call-centre",
      // A facet the reader sets replaces a dashboard drill's narrowing rather
      // than adding to it: the drill's label goes, and so does its status,
      // which is a second predicate on the same verification column and
      // would AND with the facet into a queue that can never return a row.
      search: (prev) => ({ ...prev, [key]: value || undefined, label: undefined, status: undefined }),
    });

  const partnerName = (id) =>
    facets.partners.find((p) => p.id === id)?.name ?? (loading ? "partner (loading)" : `partner ${id.slice(0, 8)}`);
  const agentName = (id) => (agents ?? []).find((a) => a.agent_id === id)?.full_name ?? `agent ${id.slice(0, 8)}`;
  // Every key that narrows the queue gets a chip, including the ones only a
  // dashboard drill can set, so nothing narrows the queue without a word for it.
  const active = [
    search.organizationId && { key: "organizationId", text: partnerName(search.organizationId) },
    search.partnerState && { key: "partnerState", text: `partners in ${search.partnerState}` },
    search.transferSalesRep && { key: "transferSalesRep", text: `rep ${search.transferSalesRep}` },
    search.verificationOutcome && { key: "verificationOutcome", text: OUTCOMES.find((o) => o.value === search.verificationOutcome)?.label ?? search.verificationOutcome },
    search.status && { key: "status", text: `scorecard column ${search.status}` },
    search.assignedAgent && { key: "assignedAgent", text: `held by ${agentName(search.assignedAgent)}` },
    search.agentManager && { key: "agentManager", text: `agents under manager ${search.agentManager.slice(0, 8)}` },
  ].filter(Boolean);

  return (
    <div className="border-b border-gray-100 bg-(--dc-accent-soft)/25 px-4 py-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Partner">
          <SearchableSelect
            value={search.organizationId ?? ""}
            onChange={(next) => set("organizationId", next)}
            placeholder="Any partner"
            searchPlaceholder="Type part of the partner's name"
            pinned={{ value: "", label: "Any partner" }}
            options={facets.partners.map((p) => ({ value: p.id, label: p.name ?? "unnamed" }))}
          />
        </Field>
        <Field label="Sales rep on the transfer">
          <SearchableSelect
            value={search.transferSalesRep ?? ""}
            onChange={(next) => set("transferSalesRep", next)}
            placeholder="Any rep"
            searchPlaceholder="Type part of the rep's name"
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
              searchPlaceholder="Type part of the agent's name"
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
              aria-label={`Remove filter: ${a.text}`}
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
