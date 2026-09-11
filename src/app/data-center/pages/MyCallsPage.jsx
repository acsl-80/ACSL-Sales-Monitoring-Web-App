import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import Link from "@/compat/Link";
import { ArrowRight, Loader2, PhoneCall } from "lucide-react";
import DataCentreShell from "../components/DataCentreShell";
import ExportButton from "../components/ExportButton";
import CallRecordEditor from "../features/call-centre/CallRecordEditor";
import CopyField from "../features/call-centre/control/CopyField";
import DayChips from "../features/call-centre/control/DayChips";
import { OUTCOME_TONE, clockOf } from "../features/call-centre/control/HappenedToday";
import ConcludedArea from "../features/call-centre/my-calls/ConcludedArea";
import CountsStrip from "../features/call-centre/my-calls/CountsStrip";
import { isCallback, isNew, viewFor } from "../features/call-centre/my-calls/views";
import { dataCenterAssign, dataCenterWrite, DataCenterError } from "../lib/client";
import { usePolling } from "../lib/usePolling";
import { useFeature } from "../lib/access";
import { DATA_CENTER_FEATURES } from "../lib/features";
import { standingLabel } from "../lib/outcome";
import { plural } from "../lib/plural";
import { whenOf } from "../lib/when";

/**
 * /data-center/my-calls (Phase 26, C4; Phase 28, D45, D49, D50)
 *
 * The agent's working surface, in his order: New numbers first, then the
 * callbacks and the numbers to try again, then a folded Concluded area for
 * what is verified, partly verified, unreachable or with Sales. Nothing is
 * pinned above New. The window chips say which day or week the figures and
 * the counts describe. Every number is one click to the clipboard for the
 * call app; Open form opens the call form that exists, and Save call there
 * offers the next New record here.
 *
 * Where a record stands comes from the server (`standing`, D41); this page
 * never derives it. A worked record stays here until a manager moves it
 * (D50). Reads `agent_day` for the signed-in agent, which needs no
 * permission beyond editing call records; the server decides.
 */
export function rankItem(item, now = Date.now()) {
  const cb = item.callback_at ? new Date(item.callback_at).getTime() : null;
  if (cb != null && cb <= now) return { rank: 0, label: `Callback ${clockOf(item.callback_at, "Africa/Lagos")}`, tone: "bg-(--dc-brief-place-soft) text-(--dc-brief-place)" };
  if (item.draft_saved_at) return { rank: 1, label: "Left unfinished", tone: "bg-(--dc-sev-warning-soft) text-(--dc-sev-warning)" };
  if (item.recall_closed_at && (!item.last_attempt_at || new Date(item.recall_closed_at) > new Date(item.last_attempt_at))) {
    return { rank: 2, label: "Fixed by Sales, ring again", tone: "bg-(--dc-brief-history-soft) text-(--dc-brief-history)" };
  }
  if (cb != null) return { rank: 4, label: `Callback ${clockOf(item.callback_at, "Africa/Lagos")}`, tone: "bg-(--dc-brief-place-soft) text-(--dc-brief-place)" };
  if (!item.attempt_count) return { rank: 3, label: "Not called yet", tone: "bg-(--dc-brief-stove-soft) text-(--dc-brief-stove)" };
  return { rank: 3, label: `${plural(item.attempt_count, "try", "tries")} so far`, tone: "bg-gray-100 text-gray-700" };
}

/** A list in calling order: callbacks due, unfinished, fixed by Sales, then the rest as handed out. */
export function orderQueue(items) {
  const now = Date.now();
  return [...items]
    .map((i, idx) => ({ ...i, _rank: rankItem(i, now), _idx: idx }))
    .sort((a, b) => a._rank.rank - b._rank.rank || a._idx - b._idx);
}

const COLUMNS = [
  { key: "stove_serial_no", label: "Stove ID" },
  { key: "end_user_name", label: "Buyer" },
  { key: "partner_name", label: "Partner" },
  { key: "phone", label: "Phone" },
  { key: "alt_phone", label: "Other phone" },
  { key: "standing_label", label: "Standing" },
  { key: "attempt_count", label: "Tries" },
  { key: "last_attempt_at", label: "Last try" },
  { key: "callback_at", label: "Callback at" },
  { key: "sale_id", label: "Sale id" },
];

function windowWord(day) {
  if (!day) return "today";
  if (day.range === "week") return day.day === day.today ? "this week" : "that week";
  if (day.range === "month") return `in ${new Date(`${day.day}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })}`;
  if (day.range === "year") return `in ${day.day.slice(0, 4)}`;
  if (day.range === "span") return "in those days";
  return day.day === day.today ? "today" : "that day";
}

function Inner() {
  const { can } = useFeature();
  const canEdit = can(DATA_CENTER_FEATURES.CALL_RECORDS_EDIT);
  const canManage = can(DATA_CENTER_FEATURES.ASSIGNMENT_MANAGE);
  const search = useSearch({ from: "/data-center/my-calls" });
  const navigate = useNavigate();
  const [day, setDay] = useState(null);
  const [dialler, setDialler] = useState(null);
  const [error, setError] = useState(null);
  const [openSale, setOpenSale] = useState(null);
  const [concludedOpen, setConcludedOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setDay(await dataCenterAssign.agentDay({ day: search.day ?? null, range: search.range ?? null }));
      setError(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not load your day.");
    }
  }, [search.day, search.range]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    dataCenterWrite.formSchema().then((s) => setDialler(s.diallerName ?? null)).catch(() => {});
  }, []);
  usePolling(load, 60);

  const held = day?.to_call ?? [];
  const fresh = useMemo(() => orderQueue(held.filter(isNew)), [held]);
  const callbacks = useMemo(() => orderQueue(held.filter(isCallback)), [held]);
  const callbacksDue = callbacks.filter((i) => i._rank.rank === 0).length;
  const next = fresh[0] ?? null;
  const rest = fresh.slice(1);
  const tz = day?.tz ?? "Africa/Lagos";
  const doneOpen = Boolean(search.done);
  const word = windowWord(day);
  const view = viewFor(search.view);
  // A deep link to a concluded view opens the area on it.
  const concludedShown = concludedOpen || view !== null;

  const setView = (key) =>
    navigate({ to: "/data-center/my-calls", search: (prev) => ({ ...prev, view: key ?? undefined }) });
  const toggleConcluded = () => {
    if (concludedShown) {
      setConcludedOpen(false);
      if (view) setView(null);
    } else {
      setConcludedOpen(true);
    }
  };

  // What follows the saved record in New, in calling order. A record that was
  // last has no next: the hand-off says so rather than circling to the head.
  const nextAfter = (saleId) => {
    const i = fresh.findIndex((q) => q.sale_id === saleId);
    const after = (i === -1 ? fresh : fresh.slice(i + 1))[0] ?? null;
    const remaining = i === -1 ? fresh.length - 1 : fresh.length - i - 2;
    return after
      ? { saleId: after.sale_id, label: `${after.end_user_name ?? after.stove_serial_no}, ${after.partner_name ?? ""}, ${after.stove_serial_no}`, remaining: Math.max(0, remaining) }
      : null;
  };

  const withWords = (list) => list.map((i) => ({ ...i, standing_label: standingLabel(i.standing) }));
  const openButton = (saleId, label = "Open form") =>
    canEdit && (
      <button type="button" onClick={() => setOpenSale(saleId)} className="rounded-md border border-(--dc-primary-mid) px-2.5 py-1 text-xs font-semibold text-(--dc-primary-strong) transition hover:bg-(--dc-primary-soft)">
        {label}
      </button>
    );
  const rowsTable = (list, lastColumn) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className="bg-(--dc-accent-soft) text-left text-xs uppercase tracking-wide text-(--dc-accent-strong)">
            <th className="px-3 py-2 font-semibold">Buyer</th>
            <th className="px-3 py-2 font-semibold">Stove</th>
            <th className="px-3 py-2 font-semibold">Partner</th>
            <th className="px-3 py-2 font-semibold">Phone</th>
            <th className="px-3 py-2 font-semibold">{lastColumn}</th>
            <th className="w-28 px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {list.map((i) => (
            <tr key={i.sale_id} data-my-row={i.sale_id}>
              <td className="px-3 py-2 font-medium text-gray-900">{i.end_user_name ?? "-"}</td>
              <td className="px-3 py-2 font-mono text-xs text-gray-700">{i.stove_serial_no}</td>
              <td className="px-3 py-2 text-gray-700">{i.partner_name ?? "-"}</td>
              <td className="px-3 py-2"><CopyField value={i.phone} label="phone" diallerName={dialler} compact /></td>
              <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${i._rank.tone}`}>{i._rank.label}</span></td>
              <td className="px-3 py-2 text-right">{openButton(i.sale_id)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4" data-my-calls>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <DayChips today={day?.today} day={day?.day} range={search.range} to="/data-center/my-calls" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["to call", fresh.length, "bg-(image:--dc-fig-sold)"],
          [`called ${word}`, day?.called, "bg-(image:--dc-fig-transferred)"],
          [`verified ${word}`, day?.verified, "bg-(image:--dc-fig-verified)"],
          ["callbacks due", callbacksDue, "bg-(image:--dc-fig-unverified)"],
        ].map(([label, value, cls]) => (
          <div key={label} className={`rounded-xl p-3 text-white shadow-sm ${cls}`} data-my-figure={label}>
            <span className="block text-2xl font-semibold tabular-nums">{day ? Number(value ?? 0).toLocaleString() : "..."}</span>
            <span className="block text-xs text-white/90">{label}</span>
          </div>
        ))}
      </div>

      {!day && <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading your day...</div>}

      <CountsStrip day={day} />

      {day && !next && (
        <div className="rounded-xl border-2 border-dashed border-(--dc-primary-mid) bg-white px-6 py-10 text-center text-sm text-gray-700" data-my-empty>
          Nothing new to call. {callbacks.length > 0 ? "Your callbacks are below." : held.length > 0 ? "What you have concluded is below." : "Your manager hands out work from the control centre."}
          {canManage && <Link href="/data-center/call-centre" className="mt-3 block text-(--dc-brief-stove) underline">Open the control centre</Link>}
        </div>
      )}

      {next && (
        <section className="rounded-xl border border-(--dc-primary-mid) bg-white p-4 shadow-[inset_0_0_0_3px_var(--dc-primary-soft)]" data-my-next={next.sale_id} data-my-section="new">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--dc-primary-strong)">Next up · {next.partner_name} · <span className="font-mono normal-case">{next.stove_serial_no}</span></p>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
            <h2 className="text-lg font-semibold text-gray-900">{next.end_user_name ?? "Buyer not named"}</h2>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${next._rank.tone}`}>{next._rank.label}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <CopyField value={next.phone} label="phone" diallerName={dialler} />
            {next.alt_phone && <CopyField value={next.alt_phone} label="other phone" diallerName={dialler} />}
            <CopyField value={next.stove_serial_no} label="stove ID" diallerName={dialler} compact />
            <span className="text-xs text-gray-600">{next.attempt_count ? `${plural(next.attempt_count, "try", "tries")} · last ${whenOf(next.last_attempt_at)}` : "never called"}</span>
          </div>
          {canEdit && (
            <button type="button" onClick={() => setOpenSale(next.sale_id)} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-(image:--dc-fig-sold) px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110">
              <PhoneCall className="h-4 w-4" /> Open the call form
            </button>
          )}
        </section>
      )}

      {rest.length > 0 && (
        <section className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm" data-my-list="new">
          <header className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-gray-900">Then</h2>
            <span className="text-xs text-gray-600">{plural(rest.length, "more new number")}, as handed out</span>
            <span className="ml-auto"><ExportButton columns={COLUMNS} rows={() => withWords(fresh)} filename="my-calls-new.csv" label="Export New" disabled={fresh.length === 0} /></span>
          </header>
          {rowsTable(rest, "Standing")}
        </section>
      )}

      {day && (
        <section className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-brief-place) bg-white shadow-sm" data-my-section="callbacks" data-my-list="callbacks">
          <header className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-brief-place-soft)/40 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-gray-900">Callbacks and numbers to try again</h2>
            <span className="text-xs text-gray-600">after the new numbers · callbacks whose time has come first, then the rest</span>
            <span className="ml-auto rounded-full bg-(--dc-brief-place-soft) px-2 py-0.5 text-[11px] font-bold tabular-nums text-(--dc-brief-place)">{callbacks.length}</span>
            <ExportButton columns={COLUMNS} rows={() => withWords(callbacks)} filename="my-calls-callbacks.csv" label="Export callbacks" disabled={callbacks.length === 0} />
          </header>
          {callbacks.length === 0
            ? <p className="px-4 py-4 text-sm text-gray-500">No callbacks waiting.</p>
            : rowsTable(callbacks, "When")}
        </section>
      )}

      {day && (
        <ConcludedArea
          items={held}
          open={concludedShown}
          view={view}
          onToggle={toggleConcluded}
          onView={setView}
          canEdit={canEdit}
          dialler={dialler}
          onOpen={setOpenSale}
          columns={COLUMNS}
        />
      )}

      {day && (
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => navigate({ to: "/data-center/my-calls", search: (prev) => ({ ...prev, done: doneOpen ? undefined : true }) })}
            aria-expanded={doneOpen}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-gray-900"
          >
            <ArrowRight className={`h-4 w-4 transition ${doneOpen ? "rotate-90" : ""}`} /> Called {word} ({day.concluded.length})
          </button>
          {doneOpen && (
            <ul className="divide-y divide-gray-100 border-t border-gray-100" data-my-done>
              {day.concluded.length === 0 && <li className="px-4 py-3 text-sm text-gray-500">No calls logged {word}.</li>}
              {[...day.concluded].reverse().map((c) => (
                <li key={`${c.at}-${c.sale_id}`} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                  <span className="w-12 font-mono text-xs text-gray-500">{clockOf(c.at, tz)}</span>
                  <span className="font-mono text-xs text-gray-700">{c.stove_serial_no}</span>
                  <span className="text-gray-900">{c.end_user_name ?? "-"}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${OUTCOME_TONE(c.outcome_value)}`}>{c.outcome_label ?? "logged"}</span>
                  {canEdit && <button type="button" onClick={() => setOpenSale(c.sale_id)} className="ml-auto rounded-md border border-(--dc-brief-stove) px-2 py-0.5 text-xs font-semibold text-(--dc-brief-stove)">Open</button>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {openSale && (
        <CallRecordEditor
          saleId={openSale}
          canEdit={canEdit}
          onClose={() => setOpenSale(null)}
          onSaved={load}
          nextOf={nextAfter}
          onNext={(saleId) => setOpenSale(saleId)}
          allHref="/data-center/my-calls"
        />
      )}
    </div>
  );
}

export default function MyCallsPage() {
  return (
    <DataCentreShell
      title="My calls"
      description="New numbers first, then your callbacks; what you concluded stays with you below."
      breadcrumb="My calls"
      area="call-centre"
      feature={DATA_CENTER_FEATURES.CALL_RECORDS_VIEW}
    >
      <Inner />
    </DataCentreShell>
  );
}
