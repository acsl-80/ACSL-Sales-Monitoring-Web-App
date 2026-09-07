import { useEffect, useMemo, useState } from "react";
import { dataCenterClient, DataCenterError } from "../../lib/client";
import { usePeriod } from "../../lib/usePeriod";
import { useIsPhone } from "../../lib/useMediaQuery";
import { plural } from "../../lib/plural";
import PeriodFilter from "../../components/PeriodFilter";
import ExportButton from "../../components/ExportButton";
import ImportFigures from "./parts/ImportFigures";
import { Loader2, Users } from "lucide-react";

/**
 * Who is digitising, and how much (Phase 27, I2; D40).
 *
 * One read, one row per person per day, summed here for the period the
 * shared control names: today, this week, this month, a custom range. Two
 * roads in are one measure: receipts typed at the bench (by who last edited
 * them, on the day they did) and rows uploaded in files (by the uploader, on
 * the day the file came in). Landed says how many of a person's rows reached
 * the sales app; released says who confirmed rows into it.
 *
 * Each person's row carries the period drawn as days, one bar per day of
 * work, so a manager sees the shape of a week without reading numbers, the
 * way the call centre's hour track reads. Past ninety days the bars are weeks.
 */
const ROUTE_ID = "/data-center/import";

const COLUMNS = [
  { key: "name", label: "Person" },
  { key: "typed", label: "Typed at the bench" },
  { key: "uploaded", label: "Rows uploaded in files" },
  { key: "files", label: "Files" },
  { key: "entered", label: "Entered" },
  { key: "landed", label: "Landed" },
  { key: "needs_person", label: "Need a look" },
  { key: "unreadable", label: "Unreadable" },
  { key: "drafting", label: "Still drafting" },
  { key: "released", label: "Released" },
  { key: "active_days", label: "Days active" },
  { key: "last_active", label: "Last active" },
];

function dayList(from, to) {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Sum the day rows per person, and keep each person's days for the bars. */
function fold(days) {
  const people = new Map();
  for (const r of days) {
    const p = people.get(r.user_id) ?? {
      user_id: r.user_id,
      name: r.full_name || r.email || "Unknown account",
      typed: 0,
      uploaded: 0,
      files: 0,
      landed: 0,
      needs_person: 0,
      unreadable: 0,
      drafting: 0,
      released: 0,
      byDay: new Map(),
    };
    for (const k of [
      "typed",
      "uploaded",
      "files",
      "landed",
      "needs_person",
      "unreadable",
      "drafting",
      "released",
    ])
      p[k] += r[k] ?? 0;
    const entered = (r.typed ?? 0) + (r.uploaded ?? 0);
    if (entered > 0 || (r.released ?? 0) > 0)
      p.byDay.set(r.day, (p.byDay.get(r.day) ?? 0) + entered);
    people.set(r.user_id, p);
  }
  return [...people.values()]
    .map((p) => {
      const activeDays = [...p.byDay.keys()].sort();
      return {
        ...p,
        entered: p.typed + p.uploaded,
        active_days: activeDays.length,
        last_active: activeDays[activeDays.length - 1] ?? "",
      };
    })
    .sort((a, b) => b.entered - a.entered || a.name.localeCompare(b.name));
}

/** The period as bars: one per day, or one per week past ninety days. */
function Bars({ byDay, days, max, weekly }) {
  const buckets = weekly
    ? days.reduce((acc, d, i) => {
        const b = Math.floor(i / 7);
        acc[b] = (acc[b] ?? 0) + (byDay.get(d) ?? 0);
        return acc;
      }, [])
    : days.map((d) => byDay.get(d) ?? 0);
  const top = Math.max(1, max);
  return (
    <span className="flex h-7 items-end gap-px" aria-hidden data-team-bars>
      {buckets.map((n, i) => (
        <span
          key={i}
          title={weekly ? `week ${i + 1}: ${n}` : `${days[i]}: ${n}`}
          className={`block w-1.5 rounded-t-[2px] ${n > 0 ? "bg-(image:--dc-fig-sold)" : "bg-gray-200"}`}
          style={{ height: n > 0 ? `${Math.max(3, Math.round((n / top) * 28))}px` : "2px" }}
        />
      ))}
    </span>
  );
}

const fmt = (n) => Number(n ?? 0).toLocaleString();

export default function DigitisationTeam() {
  const { period, setPeriod, resolved, earliest } = usePeriod(ROUTE_ID);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const phone = useIsPhone();

  useEffect(() => {
    let live = true;
    setLoading(true);
    dataCenterClient
      .digitisationTeam({ dateFrom: resolved.dateFrom ?? null, dateTo: resolved.dateTo ?? null })
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch(
        (err) =>
          live &&
          setError(
            err instanceof DataCenterError ? err.message : "Could not read the team's work.",
          ),
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [resolved.dateFrom, resolved.dateTo]);

  const people = useMemo(() => fold(data?.days ?? []), [data]);
  const days = useMemo(() => (data ? dayList(data.from, data.to) : []), [data]);
  const weekly = days.length > 90;
  const maxDay = useMemo(() => {
    let m = 0;
    for (const p of people) {
      if (weekly) {
        const perWeek = days.reduce((acc, d, i) => {
          const b = Math.floor(i / 7);
          acc[b] = (acc[b] ?? 0) + (p.byDay.get(d) ?? 0);
          return acc;
        }, []);
        m = Math.max(m, ...perWeek);
      } else {
        for (const v of p.byDay.values()) m = Math.max(m, v);
      }
    }
    return m;
  }, [people, days, weekly]);

  const totals = people.reduce(
    (t, p) => ({
      entered: t.entered + p.entered,
      landed: t.landed + p.landed,
      typed: t.typed + p.typed,
      uploaded: t.uploaded + p.uploaded,
    }),
    { entered: 0, landed: 0, typed: 0, uploaded: 0 },
  );
  const active = people.filter((p) => p.entered > 0).length;
  const workedDays = new Set(people.flatMap((p) => [...p.byDay.keys()])).size;
  const perPersonDay =
    active > 0 && workedDays > 0 ? Math.round(totals.entered / active / workedDays) : null;

  const figures = [
    { key: "entered", value: data ? totals.entered : null, label: "records entered", tone: "sold" },
    {
      key: "landed",
      value: data ? totals.landed : null,
      label: "of them landed",
      tone: "verified",
    },
    {
      key: "people",
      value: data ? active : null,
      label: active === 1 ? "person digitising" : "people digitising",
      tone: "transferred",
    },
    {
      key: "pace",
      value: data ? perPersonDay : null,
      label: "per person, per working day",
      tone: "unverified",
    },
  ];

  return (
    <section
      className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm"
      aria-labelledby="team-heading"
      data-digitisation-team
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-5 py-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Users className="h-4 w-4 text-(--dc-accent)" />
            <h2 id="team-heading" className="text-sm font-semibold text-gray-900">
              Who is digitising
            </h2>
          </div>
          <p className="text-sm text-gray-600">
            {data
              ? `${data.from} to ${data.to}, days in ${data.tz}. A receipt counts for whoever typed it, a file's rows for whoever uploaded it.`
              : "Receipts typed at the bench and rows uploaded in files, by person and by day."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodFilter
            period={period}
            onChange={setPeriod}
            earliest={earliest}
            noun="work"
            area="import"
          />
          <ExportButton
            columns={COLUMNS}
            rows={() => people.map((p) => ({ ...p, byDay: undefined }))}
            filename={`digitisation-team-${data?.from ?? "period"}-to-${data?.to ?? ""}.csv`}
            label="Export team"
            disabled={people.length === 0}
          />
        </div>
      </div>

      <div className="border-b border-gray-100 px-5 py-4">
        <ImportFigures figures={figures} compact />
      </div>

      {error && <p className="px-5 pt-3 text-sm text-(--dc-sev-critical)">{error}</p>}

      {loading && !data ? (
        <div className="flex items-center gap-2 px-5 py-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading the team's work...
        </div>
      ) : people.length === 0 ? (
        <div className="m-5 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          Nobody entered a record in this period. Widen the period above.
        </div>
      ) : phone ? (
        <ul className="divide-y divide-gray-100">
          {people.map((p) => (
            <li key={p.user_id} className="px-4 py-3" data-team-row={p.user_id}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-gray-900">{p.name}</span>
                <span className="text-sm tabular-nums text-gray-700">
                  <b>{fmt(p.entered)}</b> entered
                </span>
              </div>
              <p className="mt-0.5 text-xs text-gray-600">
                {fmt(p.typed)} typed at the bench · {fmt(p.uploaded)} in{" "}
                {plural(p.files, "file", "files")} · {fmt(p.landed)} landed
                {p.needs_person > 0 ? ` · ${fmt(p.needs_person)} need a look` : ""}
                {p.drafting > 0 ? ` · ${fmt(p.drafting)} still drafting` : ""}
              </p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <Bars byDay={p.byDay} days={days} max={maxDay} weekly={weekly} />
                <span className="text-xs text-gray-500">
                  {plural(p.active_days, "day", "days")} · last {p.last_active}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-(--dc-accent) bg-(--dc-accent-soft) text-left text-[11px] font-bold uppercase tracking-wide text-(--dc-accent-strong)">
                <th scope="col" className="sticky left-0 bg-(--dc-accent-soft) px-3 py-2">
                  Person
                </th>
                <th scope="col" className="px-3 py-2">
                  {weekly ? "By week" : "By day"}
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Bench
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  In files
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Entered
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Landed
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Need a look
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Drafting
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Released
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Days
                </th>
                <th scope="col" className="px-3 py-2">
                  Last active
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {people.map((p) => (
                <tr
                  key={p.user_id}
                  className="group hover:bg-(--dc-accent-soft)/40"
                  data-team-row={p.user_id}
                >
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 group-hover:bg-(--dc-accent-soft)/40">
                    {p.name}
                  </td>
                  <td className="px-3 py-2">
                    <Bars byDay={p.byDay} days={days} max={maxDay} weekly={weekly} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                    {fmt(p.typed)}
                  </td>
                  <td
                    className="px-3 py-2 text-right tabular-nums text-gray-700"
                    title={`${plural(p.files, "file", "files")}`}
                  >
                    {fmt(p.uploaded)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                    {fmt(p.entered)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-(--dc-brief-who)">
                    {fmt(p.landed)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${p.needs_person > 0 ? "font-semibold text-(--dc-brief-place)" : "text-gray-700"}`}
                  >
                    {fmt(p.needs_person)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                    {fmt(p.drafting)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                    {fmt(p.released)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                    {p.active_days}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">
                    {p.last_active}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-(--dc-surface-muted) text-xs text-gray-600">
                <td className="sticky left-0 bg-(--dc-surface-muted) px-3 py-2">
                  {plural(people.length, "person", "people")}
                </td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.typed)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.uploaded)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                  {fmt(totals.entered)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.landed)}</td>
                <td colSpan={5} className="px-3 py-2 text-right">
                  totals of the rows drawn
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
