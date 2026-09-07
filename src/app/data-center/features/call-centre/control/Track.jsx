/**
 * One agent's day as a line (Phase 26, C2).
 *
 * A mark per call on the hour it was logged, in its outcome family; a flag
 * where a batch was handed to them (green) or taken back (plum); a line at
 * now, when the day is today. Drawn in percentages of the working window, so
 * it scales to any width and a phone gets the same line.
 *
 * The window is the configured hours, widened to hold any mark outside them,
 * so nothing an agent did is ever off the edge. Marks carry no text; the
 * tooltip (native `title`) says what they are, and the feed under the board
 * says the same in words.
 */
const FAMILY_CLASS = {
  spoke: "bg-(--dc-brief-who)",
  callback: "bg-(--dc-brief-place) ring-2 ring-white outline outline-1 outline-(--dc-brief-place)",
  unreached: "bg-(--dc-sev-critical)",
};
const FLAG_CLASS = {
  handed_out: "border-t-(--dc-primary-mid)",
  reclaimed: "border-t-(--dc-brief-history)",
};

function hourOf(iso, tz) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

function clock(iso, tz) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(iso));
}

export default function Track({ marks = [], flags = [], tz = "Africa/Lagos", isToday = false, emptyText, startHour = 8, endHour = 18, tall = false }) {
  const hours = [...marks.map((m) => hourOf(m.at, tz)), ...flags.map((f) => hourOf(f.at, tz))];
  const nowHour = isToday ? hourOf(new Date().toISOString(), tz) : null;
  if (nowHour != null) hours.push(nowHour);
  const start = Math.min(startHour, Math.floor(Math.min(...(hours.length ? hours : [startHour]))));
  const end = Math.max(endHour, Math.ceil(Math.max(...(hours.length ? hours : [endHour]))));
  const span = Math.max(1, end - start);
  const pct = (h) => `${Math.min(100, Math.max(0, ((h - start) / span) * 100))}%`;
  const labels = [];
  for (let h = start; h <= end; h += span > 12 ? 2 : 1) labels.push(h);

  return (
    <div className="min-w-[14rem]" data-track>
      <div className="flex justify-between px-px text-[10px] leading-none text-gray-500" aria-hidden>
        {labels.map((h) => <span key={h}>{String(h).padStart(2, "0")}</span>)}
      </div>
      <div
        className={`relative mt-0.5 rounded-md border border-gray-200 bg-(--dc-track-grid) ${tall ? "h-8" : "h-6"}`}
        role="img"
        aria-label={marks.length ? `${marks.length} calls on this day` : emptyText ?? "no calls on this day"}
      >
        {marks.length === 0 && (
          <span className="absolute inset-0 grid place-items-center text-[11px] text-gray-500">{emptyText ?? "no calls"}</span>
        )}
        {flags.map((f, i) => (
          <span
            key={`f${i}`}
            title={`${f.kind === "handed_out" ? "Handed out" : "Reclaimed"} ${f.size} at ${clock(f.at, tz)}${f.partner_name ? `, ${f.partner_name}` : ""}`}
            className={`absolute -top-[3px] h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[9px] border-x-transparent ${FLAG_CLASS[f.kind] ?? FLAG_CLASS.handed_out}`}
            style={{ left: pct(hourOf(f.at, tz)) }}
            data-flag={f.kind}
          />
        ))}
        {marks.map((m, i) => (
          <span
            key={`m${i}`}
            title={`${clock(m.at, tz)} · ${m.stove_serial_no ?? ""} ${m.end_user_name ?? ""} · ${m.outcome_label ?? "logged"}`}
            className={`absolute top-1 h-[calc(100%-0.5rem)] w-2 -translate-x-1/2 rounded-sm ${FAMILY_CLASS[m.family] ?? FAMILY_CLASS.spoke}`}
            style={{ left: pct(hourOf(m.at, tz)) }}
            data-mark={m.family}
          />
        ))}
        {nowHour != null && (
          <span className="absolute -bottom-1 -top-1 w-0.5 bg-gray-900" style={{ left: pct(nowHour) }} title="now" data-now />
        )}
      </div>
    </div>
  );
}
