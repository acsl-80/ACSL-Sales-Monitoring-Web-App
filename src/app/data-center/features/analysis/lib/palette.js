/**
 * The only place an Analysis chart gets a colour.
 *
 * recharts wants a resolved colour string, not a Tailwind class and not
 * `var(--dc-sev-ok)`, so the tokens are read back off the document once. The
 * alternative was a hex per chart component, which is how the olive identity
 * ended up hardcoded eighty times across fourteen files before Phase 14.
 *
 * The fallbacks are not decoration either: this runs during tests and in any
 * render before the stylesheet has applied, and a chart with `undefined` fills
 * draws invisible bars rather than failing, which is the worst of both.
 */

const FALLBACK = {
  ok: "#3f7d3f",
  okSoft: "#e4f1e4",
  warning: "#9a5b0d",
  warningSoft: "#fbeedb",
  critical: "#a32626",
  criticalSoft: "#fbe3e3",
  accent: "#8c3a3a",
  accentSoft: "#f6e2e2",
  muted: "#9ca3af",
};

let cache = null;

export function palette() {
  if (cache) return cache;
  if (typeof window === "undefined" || !document?.documentElement) return FALLBACK;

  /*
   * Read from the AREA element, not from :root.
   *
   * `--dc-accent` is redefined per area on `.dc-root[data-area="..."]`, so
   * documentElement only ever carries the module's olive default. Reading
   * there gave the leak chart olive bars on a rust page - and it was invisible
   * in review precisely because olive is a real module colour rather than an
   * obvious mistake. The heatmap was right the whole time because it uses
   * `color-mix(... var(--dc-accent) ...)` in CSS, which resolves inside the
   * subtree; only the values pulled into JS for recharts were wrong.
   *
   * The severity tokens live on :root and are inherited, so reading them from
   * the area element gets the same answer.
   */
  const area = document.querySelector(".dc-root[data-area]");
  const style = getComputedStyle(area ?? document.documentElement);
  const read = (name, fallback) => {
    const value = style.getPropertyValue(name);
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  };

  // Only cached once the area element exists. Before it mounts we would be
  // caching the olive default forever, which is the bug above wearing a hat.
  const resolved = {
    ok: read("--dc-sev-ok", FALLBACK.ok),
    okSoft: read("--dc-sev-ok-soft", FALLBACK.okSoft),
    warning: read("--dc-sev-warning", FALLBACK.warning),
    warningSoft: read("--dc-sev-warning-soft", FALLBACK.warningSoft),
    critical: read("--dc-sev-critical", FALLBACK.critical),
    criticalSoft: read("--dc-sev-critical-soft", FALLBACK.criticalSoft),
    accent: read("--dc-accent", FALLBACK.accent),
    accentSoft: read("--dc-accent-soft", FALLBACK.accentSoft),
    muted: FALLBACK.muted,
  };
  if (area) cache = resolved;
  return resolved;
}

/**
 * The fill for a band, from the severity the SERVER sent with it.
 *
 * A chart never decides that 30 days is critical. Compute reads that from
 * `workflow_config` and ships it beside the number, so somebody re-grading a
 * band in Settings changes what the chart says without anybody editing this
 * file. That is the difference between configuration and a default.
 */
export function fillFor(severity) {
  const p = palette();
  if (severity === "critical") return p.critical;
  if (severity === "warning") return p.warning;
  if (severity === "ok") return p.ok;
  return p.muted;
}

export function softFillFor(severity) {
  const p = palette();
  if (severity === "critical") return p.criticalSoft;
  if (severity === "warning") return p.warningSoft;
  if (severity === "ok") return p.okSoft;
  return "#f3f4f6";
}

/** Ramps a cross-tab cell from nothing to the area accent. Used by the heatmap. */
export function heatFor(value, max) {
  if (!max || !value) return "transparent";
  const share = Math.min(1, value / max);
  // color-mix keeps this in the accent, so the heatmap changes colour with the
  // area rather than carrying a second palette nobody remembers to update.
  return `color-mix(in oklab, var(--dc-accent) ${Math.round(8 + share * 72)}%, white)`;
}

/** White text once the ground is dark enough to need it. */
export function heatTextFor(value, max) {
  if (!max || !value) return "inherit";
  return value / max > 0.55 ? "#ffffff" : "inherit";
}

/** Test seam: the tokens are read once and cached, so a theme change needs this. */
export function resetPalette() {
  cache = null;
}

/**
 * An ordinal ramp off the area accent, for bands that carry no severity.
 *
 * The leak reasons are one thing seen several ways - yield that did not
 * arrive - so grading them ok/warning/critical would be inventing a judgement
 * the configuration never made, and putting it in a file nobody would think to
 * look in. An ordered ramp says "these are categories of the same quantity"
 * and nothing more.
 *
 * Mixed in JS rather than with CSS color-mix, because this ends up in an SVG
 * `fill` attribute where support is not something to gamble a blank chart on.
 */
function hex(value) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(value).trim());
  if (!m) return [140, 58, 58];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function ramp(index, count) {
  const [r, g, b] = hex(palette().accent);
  const t = count <= 1 ? 0 : index / (count - 1);
  const lighten = 0.1 + t * 0.62;
  const to = (c) => Math.round(c + (255 - c) * lighten);
  return `rgb(${to(r)}, ${to(g)}, ${to(b)})`;
}
