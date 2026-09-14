/**
 * A batch's state, drawn (import redesign, 2026-09-07).
 *
 * Three cells, read · checked · landed, each coloured by what happened in it,
 * so a list of files reads at a glance the way the call centre's hour track
 * does. The words a cell shows are the module's own: read, checked, landed,
 * and for the call sheets, attached. Nothing here decides anything; it reads
 * the same batch fields the state chip and the next-step sentence read.
 *
 * Colours are the module's figure gradients, painted as background images
 * (a gradient token applied as a colour paints nothing; see PR #94).
 */

const CELL = {
  pending: "bg-gray-200 text-gray-500",
  read: "bg-(image:--dc-fig-transferred) text-white",
  ok: "bg-(image:--dc-fig-verified) text-white",
  warn: "bg-(image:--dc-fig-unverified) text-white",
  landed: "bg-(image:--dc-fig-sold) text-white",
  running: "bg-(image:--dc-fig-sold) text-white animate-pulse",
  undone: "bg-(image:--dc-fig-plum) text-white",
  failed: "bg-(image:--dc-fig-crit) text-white",
};

/** The three cells for a batch, as { key, tone, word }. Exported so a phone card and a spec can read the same verdict. */
export function stripCells(b, landedWord = "landed") {
  const total = b.total_rows ?? 0;
  const valid = b.valid_rows ?? 0;
  const rejected = b.rejected_rows ?? 0;
  const committed = b.committed_rows ?? 0;
  const exceptions = b.exception_rows ?? 0;
  const checked = valid + rejected + exceptions + committed > 0;

  const read = { key: "read", tone: total > 0 ? "read" : "pending", word: "read" };

  let checkTone = "pending";
  if (checked) {
    if (exceptions > 0) checkTone = "warn";
    else if (valid > 0 || committed > 0) checkTone = "ok";
    else if (rejected > 0) checkTone = "failed";
    else checkTone = "ok";
  }
  const check = { key: "checked", tone: checkTone, word: "checked" };

  let landTone = "pending";
  let word = landedWord;
  if (b.state === "rolled_back") {
    landTone = "undone";
    word = "undone";
  } else if (b.committing) {
    landTone = "running";
    word = "landing";
  } else if (committed > 0) landTone = "landed";
  const land = { key: "landed", tone: landTone, word };

  return [read, check, land];
}

export default function StateStrip({ batch, landedWord = "landed", className = "" }) {
  const cells = stripCells(batch, landedWord);
  const said = cells
    .map((c) => `${c.word}: ${c.tone === "pending" ? "not yet" : c.tone}`)
    .join(", ");
  return (
    <span
      className={`inline-grid grid-cols-3 gap-0.5 align-middle ${className}`}
      role="img"
      aria-label={said}
      data-state-strip={batch.state}
      data-strip={cells.map((c) => c.tone).join(" ")}
    >
      {cells.map((c) => (
        <span
          key={c.key}
          className={`block h-[18px] w-16 rounded-[3px] text-center text-[10px] font-bold leading-[18px] ${CELL[c.tone]}`}
        >
          {c.word}
        </span>
      ))}
    </span>
  );
}
