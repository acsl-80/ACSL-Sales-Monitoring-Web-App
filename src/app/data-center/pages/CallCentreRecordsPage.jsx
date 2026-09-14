import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import Link from "@/compat/Link";
import { ArrowLeft } from "lucide-react";
import DataCentreShell from "../components/DataCentreShell";
import CallQueue from "../features/call-centre/CallQueue";
import { dataCenterAssign, dataCenterClient } from "../lib/client";
import { useFeature } from "../lib/access";
import { DATA_CENTER_FEATURES } from "../lib/features";
import { wordsFor } from "../lib/outcome";

/**
 * /data-center/call-centre/records (Phase 26, C3)
 *
 * The queue, on its own page, with a strip above it that says what the
 * current narrowing holds by outcome before a single row is read. The drill
 * contract from the dashboard (organizationId, status, preset, label and the
 * rest) lands here; the call-centre page redirects any narrowing it receives.
 *
 * The strip is four counts under the same filters, read through the queue's
 * own action with a page size of one; the count comes back with page one.
 * Bounded, keyset-free, and the same predicate the table uses, so the strip
 * and the rows can never disagree.
 */
const ROUTE = { id: "/data-center/call-centre_/records", to: "/data-center/call-centre/records" };

const PRESET_LABELS = {
  todo: "never called",
  unresolved: "yet to be resolved",
  exhausted: "chased three times and still not verified",
  correction: "waiting on Sales",
  review: "fixed by Sales, awaiting review",
  recall_due: "due a call again after a fix",
  completed: "finished by the call centre",
  unconfirmed: "a serial number another caller took",
};
const STATUS_LABELS = {
  verified: "verified",
  unverified: "partly verified",
  unreachable: "unreachable",
  unresolved: "yet to be resolved",
};
const STRIP = [
  { key: "fully_verified", label: "verified", tone: "text-(--dc-brief-who)", href: { verificationOutcome: "fully_verified" } },
  { key: "partially_verified", label: "partly verified", tone: "text-(--dc-brief-place)", href: { verificationOutcome: "partially_verified" } },
  { key: "unreachable", label: "unreachable", tone: "text-(--dc-sev-critical)", href: { verificationOutcome: "unreachable" } },
  { key: "not_verified", label: "not yet verified", tone: "text-gray-900", href: { verificationOutcome: "not_verified" } },
];

function useOutcomeStrip(filters) {
  const [counts, setCounts] = useState(null);
  const key = JSON.stringify(filters ?? {});
  useEffect(() => {
    let alive = true;
    const base = JSON.parse(key);
    // A narrowing on one outcome makes the other three zero by definition;
    // the strip then reads as the whole population so it still says something.
    const { verificationOutcome: _drop, outcomeGroup: _drop2, ...wide } = base;
    Promise.all(
      STRIP.map((s) =>
        dataCenterClient
          .getCallQueue({ cursor: null, limit: 1, direction: "desc", filters: { ...wide, verificationOutcome: s.key } })
          .then((p) => ({ key: s.key, total: p.total, capped: p.totalIsCapped }))
          .catch(() => ({ key: s.key, total: null, capped: false })),
      ),
    ).then((rows) => {
      if (!alive) return;
      setCounts(Object.fromEntries(rows.map((r) => [r.key, r])));
    });
    return () => { alive = false; };
  }, [key]);
  return counts;
}

function Inner() {
  const { can } = useFeature();
  const canManage = can(DATA_CENTER_FEATURES.ASSIGNMENT_MANAGE);
  const canEdit = can(DATA_CENTER_FEATURES.CALL_RECORDS_EDIT);
  const search = useSearch({ from: ROUTE.id });
  const navigate = useNavigate();
  const [agents, setAgents] = useState(null);

  useEffect(() => {
    if (canManage) dataCenterAssign.agents().then((a) => setAgents(a.agents ?? [])).catch(() => setAgents(null));
  }, [canManage]);

  // The drill, translated from the URL to server filters, exactly as the
  // call-centre page did it: the contract is the URL, not the page.
  const drill = useMemo(() => {
    const filters = {};
    for (const k of ["organizationId", "partnerState", "transferSalesRep", "assignedAgent", "agentManager"]) {
      if (search[k]) filters[k] = search[k];
    }
    if (search.status && STATUS_LABELS[search.status]) filters.outcomeGroup = search.status;
    if (search.verificationOutcome) filters.verificationOutcome = search.verificationOutcome;
    // One or more standings, comma-separated in the URL (D41).
    if (search.standing) filters.standing = String(search.standing).split(",").map((s) => s.trim()).filter(Boolean);
    const preset = PRESET_LABELS[search.preset] ? search.preset : null;
    if (Object.keys(filters).length === 0 && !preset) return null;
    const subject = search.label
      ?? (preset ? PRESET_LABELS[preset] : null)
      ?? (search.verificationOutcome ? wordsFor(search.verificationOutcome) : null)
      ?? (filters.standing ? filters.standing.map(wordsFor).join(", ") : "the filters set on the queue");
    return {
      preset,
      filters,
      description: filters.outcomeGroup ? `${subject}: ${STATUS_LABELS[search.status]}` : subject,
      clear: () => navigate({ to: ROUTE.to, search: (prev) => ({ ...(prev.period ? { period: prev.period } : {}) }) }),
    };
  }, [search, navigate]);

  const strip = useOutcomeStrip(drill?.filters ?? {});
  const stripLink = (extra) => {
    const next = { ...search, ...extra };
    delete next.status;
    delete next.preset;
    return `${ROUTE.to}?${new URLSearchParams(Object.fromEntries(Object.entries(next).filter(([, v]) => v != null && v !== ""))).toString()}`;
  };

  return (
    <div className="space-y-4">
      <Link href="/data-center/call-centre" className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:border-(--dc-accent)">
        <ArrowLeft className="h-3.5 w-3.5" /> Control centre
      </Link>
      <section className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm" data-outcome-strip>
        <div className="grid grid-cols-2 divide-x divide-gray-100 md:grid-cols-4">
          {STRIP.map((s) => {
            const c = strip?.[s.key];
            const active = search.verificationOutcome === s.key;
            return (
              <Link
                key={s.key}
                href={stripLink(s.href)}
                aria-current={active ? "true" : undefined}
                className={`block px-4 py-3 transition hover:bg-(--dc-accent-soft)/40 ${active ? "bg-(--dc-accent-soft)/60" : ""}`}
                data-strip-outcome={s.key}
              >
                <span className={`block text-xl font-semibold tabular-nums ${s.tone}`}>
                  {c == null ? "…" : c.total == null ? "-" : `${Number(c.total).toLocaleString()}${c.capped ? "+" : ""}`}
                </span>
                <span className="block text-xs text-gray-600">{s.label}{drill ? " in this narrowing" : ""}</span>
              </Link>
            );
          })}
        </div>
      </section>
      <CallQueue key={drill?.preset ?? "all"} canEdit={canEdit} drill={drill} agents={canManage ? agents : null} route={ROUTE} />
    </div>
  );
}

export default function CallCentreRecordsPage() {
  return (
    <DataCentreShell
      title="Call centre records"
      description="Every record the call centre works, what each call concluded, and the filters to find one."
      breadcrumb="Records"
      area="call-centre"
      feature={DATA_CENTER_FEATURES.CALL_RECORDS_VIEW}
    >
      <Inner />
    </DataCentreShell>
  );
}
