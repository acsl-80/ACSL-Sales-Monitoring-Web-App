import { useNavigate } from "@tanstack/react-router";

/**
 * Which day the board draws (Phase 26, C2).
 *
 * Four chips: today, yesterday, this week, or a picked day. The choice lives in
 * the URL (`day`, `range`), never in state, so back restores the day and a
 * link carries it. Today is the default and stays out of the URL, so an
 * unfiltered link stays clean.
 *
 * "Today" and "yesterday" are the call centre's days, which the board reports
 * back in its own timezone; the chips never compute a date from the browser's
 * clock.
 */
function shiftDay(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function labelFor(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export default function DayChips({ today, day, range }) {
  const navigate = useNavigate();
  const go = (next) =>
    navigate({
      to: "/data-center/call-centre",
      search: (prev) => {
        const out = { ...prev };
        delete out.day;
        delete out.range;
        if (next.day && next.day !== today) out.day = next.day;
        if (next.range === "week") out.range = "week";
        return out;
      },
    });

  const current = day ?? today;
  const isToday = !range && current === today;
  const isYesterday = !range && today && current === shiftDay(today, -1);
  const isWeek = range === "week";
  const isPicked = !isToday && !isYesterday && !isWeek;

  const chip = (active, text, onClick, extra = {}) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
        active
          ? "border-(--dc-accent) bg-(--dc-accent) text-white"
          : "border-gray-300 bg-white text-gray-700 hover:border-(--dc-accent)/60"
      }`}
      {...extra}
    >
      {text}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-day-chips>
      {chip(isToday, today ? `Today, ${labelFor(today)}` : "Today", () => go({}))}
      {chip(isYesterday, "Yesterday", () => today && go({ day: shiftDay(today, -1) }))}
      {chip(isWeek, "This week", () => go({ day: current, range: "week" }))}
      <label className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
        isPicked ? "border-(--dc-accent) bg-(--dc-accent) text-white" : "border-gray-300 bg-white text-gray-700"
      }`}>
        <span>{isPicked ? labelFor(current) : "Pick a day"}</span>
        <input
          type="date"
          aria-label="Pick a day"
          value={current ?? ""}
          max={today ?? undefined}
          onChange={(e) => e.target.value && go({ day: e.target.value })}
          className="w-[1.1rem] cursor-pointer bg-transparent text-transparent outline-none"
        />
      </label>
    </div>
  );
}
