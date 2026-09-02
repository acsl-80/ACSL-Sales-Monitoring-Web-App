import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "@/compat/Link";
import { dataCenterClient, DataCenterError } from "../../lib/client";
import { usePaged } from "../../lib/usePaged";
import Pagination from "../../components/Pagination";
import ExportButton from "../../components/ExportButton";
import { plural } from "../../lib/plural";
import { DigitisationSheetButton } from "./DigitisationSheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2, ChevronRight, ArrowLeft, Handshake, Package, Boxes,
  UserRound, PhoneCall, MapPin, ExternalLink,
} from "lucide-react";

/**
 * A partner, all the way down.
 *
 * Four levels of one question. Who is this partner, what were they sent, which
 * stoves were in each consignment, and what happened to any one of them. The
 * table behind this could say a partner had 200 issued and 15 verified and
 * there was no way at all to ask which 15, or which of the other 185 nobody
 * has rung yet.
 *
 * One dialog with a trail rather than dialogs on top of dialogs. Three stacked
 * overlays is unusable in a hand and hard to leave on a desktop; a trail keeps
 * one surface, and going back is going back rather than closing something.
 *
 * Each level fetches when it is opened. A partner with 200 stoves across eight
 * consignments is 1,600 rows nobody asked for if it all arrives at once.
 */

const dateOf = (v) => (v ? new Date(v).toLocaleDateString() : "-");
const NUMBER = new Intl.NumberFormat("en-NG");
const n = (v) => NUMBER.format(Number(v ?? 0));

const OUTCOME_TONE = {
  fully_verified: "text-(--dc-accent)",
  partially_verified: "text-amber-700",
  unreachable: "text-orange-700",
  not_verified: "text-gray-600",
};

const outcomeLabel = (v) => (v ? v.replace(/_/g, " ") : "nothing concluded");

const BATCH_COLUMNS = [
  { key: "transaction_id", label: "Reference" },
  { key: "sales_rep", label: "Sales rep" },
  { key: "sales_date", label: "Date" },
  { key: "transfer_state", label: "State" },
  { key: "transfer_branch", label: "Branch" },
  { key: "issued_count", label: "Issued" },
  { key: "received_count", label: "Received" },
  { key: "digitalised_count", label: "Digitalised" },
  { key: "verified_count", label: "Verified" },
  { key: "unverified_count", label: "Unverified" },
  { key: "unreachable_count", label: "Unreachable" },
  { key: "unresolved_count", label: "Yet to be resolved" },
  { key: "outstanding_count", label: "Outstanding" },
  { key: "transfer_id", label: "Transfer id" },
];

const STOVE_COLUMNS = [
  { key: "stove_id", label: "Stove ID" },
  { key: "stock_status", label: "Stock status" },
  { key: "end_user_name", label: "Buyer" },
  { key: "phone", label: "Phone" },
  { key: "user_state", label: "State" },
  { key: "sales_date", label: "Sold on" },
  { key: "verification_outcome", label: "Verification" },
  { key: "attempt_count", label: "Calls made" },
  { key: "agent_name", label: "Assigned to", get: (r) => r.agent_name ?? "unassigned" },
  { key: "batch_state", label: "Assignment state" },
  { key: "sale_id", label: "Sale id" },
];

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-(--dc-accent)/20 bg-(--dc-accent-soft)/30 px-3 py-2">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-600">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${tone ?? "text-gray-900"}`}>
        {value}
      </p>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-600">{label}</p>
      <p className="mt-0.5 text-sm text-gray-900">{value ?? "-"}</p>
    </div>
  );
}

/* -------------------------------------------------------------- the levels */

function PartnerLevel({ data, repFilter, onRep, onBatch }) {
  const batches = useMemo(
    () => (repFilter ? data.batches.filter((b) => b.sales_rep === repFilter) : data.batches),
    [data.batches, repFilter],
  );
  const paged = usePaged(batches, 10);

  const totals = useMemo(
    () =>
      batches.reduce(
        (a, b) => ({
          issued: a.issued + (b.issued_count ?? 0),
          received: a.received + (b.received_count ?? 0),
          verified: a.verified + (b.verified_count ?? 0),
          outstanding: a.outstanding + (b.outstanding_count ?? 0),
        }),
        { issued: 0, received: 0, verified: 0, outstanding: 0 },
      ),
    [batches],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Issued" value={n(totals.issued)} />
        <Stat label="Received" value={n(totals.received)} />
        <Stat label="Verified" value={n(totals.verified)} tone="text-(--dc-accent)" />
        <Stat
          label="Outstanding"
          value={n(totals.outstanding)}
          tone={totals.outstanding > 0 ? "text-amber-700" : undefined}
        />
      </div>

      {/* The reps, and what each of them has. Both figures, because "how many
          has this rep got" is asked about this partner and about the rep, and
          answering only one invites the reader to assume the other. */}
      {data.reps.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
            Sales reps
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.reps.map((r) => {
              const on = repFilter === r.sales_rep;
              return (
                <button
                  key={r.sales_rep}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onRep(on ? null : r.sales_rep)}
                  className={`rounded-lg border px-3 py-1.5 text-left text-sm transition ${
                    on
                      ? "border-(--dc-accent) bg-(--dc-accent-soft) text-(--dc-accent-strong)"
                      : "border-gray-300 hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/50"
                  }`}
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    <UserRound className="h-3.5 w-3.5" />
                    {r.sales_rep}
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-600">
                    {plural(r.stoves_here, "stove")} here ·{" "}
                    {plural(r.stoves_total, "stove")} across{" "}
                    {plural(r.partners_total, "partner")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
            Consignments
          </p>
          <span className="text-xs text-gray-600">
            {plural(batches.length, "batch", "batches")}
            {repFilter ? ` by ${repFilter}` : ""}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* The sheet the digitisers type into, taken from the partner they
                are already looking at. It carries the stove IDs, which is the
                one field nobody should ever key by hand. */}
            {data.partner?.organization_id && (
              <DigitisationSheetButton
                organizationId={data.partner.organization_id}
                partnerName={data.partner.partner_name}
              />
            )}
            <ExportButton
              columns={BATCH_COLUMNS}
              rows={() => batches}
              filename={`partner-${(data.partner?.partner_name ?? "batches").replace(/\W+/g, "-").toLowerCase()}-batches.csv`}
              label="Export batches"
              disabled={batches.length === 0}
            />
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="bg-(--dc-accent-soft) text-left text-xs uppercase tracking-wide text-(--dc-accent-strong)">
                  <th className="px-3 py-2 font-semibold">Reference</th>
                  <th className="px-3 py-2 font-semibold">Sales rep</th>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 text-right font-semibold">Issued</th>
                  <th className="px-3 py-2 text-right font-semibold">Received</th>
                  <th className="px-3 py-2 text-right font-semibold">Verified</th>
                  <th className="px-3 py-2 text-right font-semibold">Outstanding</th>
                  <th className="w-8 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paged.slice.map((b) => (
                  <tr
                    key={b.transfer_id}
                    onClick={() => onBatch(b)}
                    className="cursor-pointer transition hover:bg-(--dc-accent-soft)/50"
                  >
                    <td className="px-3 py-2 font-medium text-(--dc-accent)">
                      {b.transaction_id}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{b.sales_rep ?? "-"}</td>
                    <td className="px-3 py-2 text-gray-700">{dateOf(b.sales_date)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                      {n(b.issued_count)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                      {n(b.received_count)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-(--dc-accent)">
                      {n(b.verified_count)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        b.outstanding_count > 0 ? "text-amber-700" : "text-gray-700"
                      }`}
                    >
                      {n(b.outstanding_count)}
                    </td>
                    <td className="px-3 py-2 text-gray-400">
                      <ChevronRight className="h-4 w-4" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            onPage={paged.setPage}
            onPageSize={paged.setPageSize}
            noun="batch"
          />
        </div>
      </div>
    </div>
  );
}

function BatchLevel({ batch, onStove }) {
  const [stoves, setStoves] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let live = true;
    dataCenterClient
      .batchStoves(batch.transfer_id)
      .then((r) => live && setStoves(r.stoves))
      .catch((err) =>
        live &&
        setError(err instanceof DataCenterError ? err.message : "Could not load that batch."),
      );
    return () => {
      live = false;
    };
  }, [batch.transfer_id]);

  const shown = useMemo(() => {
    const all = stoves ?? [];
    if (filter === "sold") return all.filter((x) => x.sale_id);
    if (filter === "unsold") return all.filter((x) => !x.sale_id);
    if (filter === "unassigned") return all.filter((x) => x.sale_id && !x.agent_id);
    if (filter === "verified") return all.filter((x) => x.verification_outcome === "fully_verified");
    return all;
  }, [stoves, filter]);

  const paged = usePaged(shown, 25);

  const counts = useMemo(() => {
    const all = stoves ?? [];
    return {
      all: all.length,
      sold: all.filter((x) => x.sale_id).length,
      unsold: all.filter((x) => !x.sale_id).length,
      unassigned: all.filter((x) => x.sale_id && !x.agent_id).length,
      verified: all.filter((x) => x.verification_outcome === "fully_verified").length,
    };
  }, [stoves]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (stoves === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the stoves in this batch...
      </p>
    );
  }

  const FILTERS = [
    { key: "all", label: "All" },
    { key: "sold", label: "Sold" },
    { key: "unsold", label: "Not sold yet" },
    { key: "unassigned", label: "Sold, nobody calling" },
    { key: "verified", label: "Verified" },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Issued" value={n(batch.issued_count)} />
        <Stat label="Sold" value={n(counts.sold)} />
        <Stat label="Verified" value={n(counts.verified)} tone="text-(--dc-accent)" />
        <Stat
          label="Nobody calling"
          value={n(counts.unassigned)}
          tone={counts.unassigned > 0 ? "text-amber-700" : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              filter === f.key
                ? "border-(--dc-accent) bg-(--dc-accent) text-white"
                : "border-gray-300 text-gray-700 hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/50"
            }`}
          >
            {f.label} ({n(counts[f.key])})
          </button>
        ))}
        <div className="ml-auto">
          <ExportButton
            columns={STOVE_COLUMNS}
            rows={() => shown}
            filename={`batch-${batch.transaction_id}-stoves.csv`}
            label="Export stoves"
            disabled={shown.length === 0}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="bg-(--dc-accent-soft) text-left text-xs uppercase tracking-wide text-(--dc-accent-strong)">
                <th className="px-3 py-2 font-semibold">Stove ID</th>
                <th className="px-3 py-2 font-semibold">Stock</th>
                <th className="px-3 py-2 font-semibold">Buyer</th>
                <th className="px-3 py-2 font-semibold">Assigned to</th>
                <th className="px-3 py-2 font-semibold">Verification</th>
                <th className="w-8 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paged.slice.map((x) => (
                <tr
                  key={x.stove_id}
                  onClick={() => onStove(x)}
                  className="cursor-pointer transition hover:bg-(--dc-accent-soft)/50"
                >
                  <td className="px-3 py-2 font-mono text-xs font-medium text-(--dc-accent)">
                    {x.stove_id}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{x.stock_status ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-700">
                    {x.end_user_name ?? (x.sale_id ? "-" : "not sold")}
                  </td>
                  <td className="px-3 py-2">
                    {x.agent_name ? (
                      <span className="text-gray-700">{x.agent_name}</span>
                    ) : x.sale_id ? (
                      <span className="text-amber-700">unassigned</span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td
                    className={`px-3 py-2 text-xs font-medium ${
                      OUTCOME_TONE[x.verification_outcome] ?? "text-gray-500"
                    }`}
                  >
                    {x.sale_id ? outcomeLabel(x.verification_outcome) : "-"}
                  </td>
                  <td className="px-3 py-2 text-gray-400">
                    <ChevronRight className="h-4 w-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={paged.page}
          pageSize={paged.pageSize}
          total={paged.total}
          onPage={paged.setPage}
          onPageSize={paged.setPageSize}
          noun="stove"
        />
      </div>
    </div>
  );
}

function StoveLevel({ stoveId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    dataCenterClient
      .stoveDetail(stoveId)
      .then((r) => live && setData(r))
      .catch((err) =>
        live &&
        setError(err instanceof DataCenterError ? err.message : "Could not load that stove."),
      );
    return () => {
      live = false;
    };
  }, [stoveId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading everything about {stoveId}...
      </p>
    );
  }

  const s = data.stove;
  const sold = Boolean(s.sale_id);

  return (
    <div className="space-y-4">
      {/*
        This panel is a summary inside a dialog; the record has a page. Offer
        it, rather than growing the dialog until it is the page badly.
      */}
      <Link
        href={`/data-center/stove/${encodeURIComponent(s.stove_id)}`}
        className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent)/30 px-2.5 py-1.5 text-sm font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60"
      >
        <ExternalLink className="h-4 w-4" /> Open the full record for {s.stove_id}
      </Link>
      <section>
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
          <Package className="h-3.5 w-3.5" /> Where it came from
        </h4>
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-gray-200 p-3 sm:grid-cols-3 lg:grid-cols-4">
          <Detail label="Stove ID" value={s.stove_id} />
          <Detail label="Stock status" value={s.stock_status} />
          <Detail label="Partner" value={s.partner_name} />
          <Detail label="Partner ID" value={s.partner_id} />
          <Detail label="Transfer reference" value={s.transaction_id} />
          <Detail label="Sales rep" value={s.sales_rep} />
          <Detail label="Transferred" value={dateOf(s.transfer_sales_date)} />
          <Detail label="Factory" value={s.factory} />
        </div>
      </section>

      <section>
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
          <UserRound className="h-3.5 w-3.5" /> The sale
        </h4>
        {!sold ? (
          <p className="rounded-lg border border-dashed border-(--dc-accent)/40 bg-(--dc-accent-soft)/20 px-4 py-6 text-center text-sm text-gray-600">
            Not sold yet. It is sitting with {s.partner_name ?? "the partner"} as available
            stock, so there is nobody to call about it.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-gray-200 p-3 sm:grid-cols-3 lg:grid-cols-4">
            <Detail label="Buyer" value={s.end_user_name} />
            <Detail label="Also known as" value={s.aka} />
            <Detail label="Phone" value={s.phone} />
            <Detail label="Alternative phone" value={s.alternative_phone} />
            <Detail label="Sold on" value={dateOf(s.sales_date)} />
            <Detail label="State" value={s.user_state} />
            <Detail label="LGA" value={s.user_lga} />
            <Detail label="Address" value={s.user_residential_address} />
            <Detail label="Amount" value={s.amount != null ? n(s.amount) : null} />
            <Detail label="Paid" value={s.total_paid != null ? n(s.total_paid) : null} />
            <Detail label="Payment status" value={s.payment_status} />
            <Detail label="Sold by" value={s.sales_rep} />
            <Detail label="Recorded by" value={s.sale_agent_name} />
            <Detail label="Sales model" value={s.sales_model} />
            <Detail label="Channel" value={s.platform} />
            <Detail label="Sales app status" value={s.sale_status} />
          </div>
        )}
      </section>

      {sold && (
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
            <PhoneCall className="h-3.5 w-3.5" /> Verification
          </h4>
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-gray-200 p-3 sm:grid-cols-3 lg:grid-cols-4">
            <Detail
              label="Outcome"
              value={
                <span className={OUTCOME_TONE[s.verification_outcome] ?? "text-gray-600"}>
                  {outcomeLabel(s.verification_outcome)}
                </span>
              }
            />
            <Detail label="Calls made" value={n(s.attempt_count)} />
            <Detail label="Last call" value={s.last_attempt_at ? dateOf(s.last_attempt_at) : "never"} />
            <Detail label="Last outcome" value={s.call_outcome} />
            {/* Unassigned is the answer somebody is looking for, not a blank. */}
            <Detail
              label="Assigned to"
              value={
                s.agent_name ? (
                  `${s.agent_name}${s.agent_email ? ` (${s.agent_email})` : ""}`
                ) : (
                  <span className="text-amber-700">nobody yet</span>
                )
              }
            />
            <Detail label="Assignment state" value={s.batch_state} />
            <Detail label="Assigned on" value={s.assigned_at ? dateOf(s.assigned_at) : null} />
            <Detail label="Correction" value={s.correction_state ?? "none"} />
          </div>
        </section>
      )}

      {data.attempts.length > 0 && (
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
            <PhoneCall className="h-3.5 w-3.5" /> Every call
          </h4>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {data.attempts.map((a) => (
              <li key={a.attempt_no} className="flex flex-wrap items-baseline gap-2 px-3 py-2 text-sm">
                <span className="w-6 shrink-0 text-xs font-semibold text-gray-400">
                  {a.attempt_no}
                </span>
                <span className="font-medium text-gray-900">{a.outcome ?? "no outcome recorded"}</span>
                {a.answered_by && (
                  <span className="text-xs text-gray-600">answered by {a.answered_by}</span>
                )}
                {a.note && <span className="w-full text-xs text-gray-600">{a.note}</span>}
                <span className="ml-auto shrink-0 text-xs text-gray-500">
                  {a.logged_by ?? "system"} · {dateOf(a.attempted_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- the surface */

export default function PartnerDetail({ organizationId, partnerName, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [repFilter, setRepFilter] = useState(null);
  // The trail, not a stack of dialogs. [] is the partner, one entry is a
  // batch, two is a stove inside it.
  const [trail, setTrail] = useState([]);

  const load = useCallback(async () => {
    try {
      setData(await dataCenterClient.partnerDetail(organizationId));
      setError(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not load that partner.");
    }
  }, [organizationId]);

  useEffect(() => {
    load();
  }, [load]);

  const batch = trail.find((t) => t.kind === "batch")?.batch;
  const stove = trail.find((t) => t.kind === "stove")?.stove;

  const heading = stove
    ? stove.stove_id
    : batch
      ? batch.transaction_id
      : data?.partner?.partner_name ?? partnerName ?? "Partner";

  const description = stove
    ? "Everything known about this stove, from the consignment it arrived on to the last call."
    : batch
      ? `Every stove in this consignment. ${plural(batch.issued_count ?? 0, "stove")} issued on ${dateOf(batch.sales_date)}.`
      : "What this partner was sent, by whom, and how much of it has come back.";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="dc-root flex h-[90dvh] w-[90vw] max-w-[90vw] flex-col gap-0 overflow-hidden border-0 p-0 sm:max-w-[90vw]"
        data-area="partner-records"
      >
        <DialogHeader className="border-b border-gray-100 bg-(--dc-accent-soft)/40 px-5 py-4 text-left">
          {/* The trail. Going back is going back, rather than closing one of
              three overlays and hoping the right one is underneath. */}
          <nav className="mb-1 flex flex-wrap items-center gap-1 text-xs text-gray-600">
            <button
              type="button"
              onClick={() => setTrail([])}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)"
            >
              <Handshake className="h-3.5 w-3.5" />
              {data?.partner?.partner_name ?? partnerName ?? "Partner"}
            </button>
            {batch && (
              <>
                <ChevronRight className="h-3 w-3 text-gray-400" />
                <button
                  type="button"
                  onClick={() => setTrail([{ kind: "batch", batch }])}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)"
                >
                  <Boxes className="h-3.5 w-3.5" />
                  {batch.transaction_id}
                </button>
              </>
            )}
            {stove && (
              <>
                <ChevronRight className="h-3 w-3 text-gray-400" />
                <span className="px-1.5 py-0.5 font-medium text-gray-700">{stove.stove_id}</span>
              </>
            )}
          </nav>
          <DialogTitle className="text-base">{heading}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="mx-auto w-full max-w-6xl flex-1 overflow-y-auto p-5">
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

          {!data && !error ? (
            <p className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the partner...
            </p>
          ) : data?.batches?.length === 0 ? (
            <div className="rounded-lg border border-dashed border-(--dc-accent)/40 bg-(--dc-accent-soft)/20 px-4 py-8 text-center text-sm text-gray-600">
              Nothing has been transferred to this partner yet.
            </div>
          ) : stove ? (
            <StoveLevel stoveId={stove.stove_id} />
          ) : batch ? (
            <BatchLevel
              batch={batch}
              onStove={(s) => setTrail((t) => [...t, { kind: "stove", stove: s }])}
            />
          ) : (
            data && (
              <PartnerLevel
                data={data}
                repFilter={repFilter}
                onRep={setRepFilter}
                onBatch={(b) => setTrail([{ kind: "batch", batch: b }])}
              />
            )
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-5 py-3">
          {trail.length > 0 ? (
            <button
              type="button"
              onClick={() => setTrail((t) => t.slice(0, -1))}
              className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent)/30 px-3 py-1.5 text-sm font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
              <MapPin className="h-3.5 w-3.5" />
              {data?.partner?.transfer_state ?? "-"}
              {data?.partner?.transfer_branch ? ` · ${data.partner.transfer_branch}` : ""}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
