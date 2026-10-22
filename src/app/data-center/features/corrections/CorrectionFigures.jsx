import { Figure } from "../call-centre/control/Figures";

/**
 * Where the send-backs stand, as three doors (D68).
 *
 * His ask: a card that shows how many have been corrected, and then how many
 * have been resolved. Waiting on Sales comes first because it is the work
 * still to do; corrected counts every fix Sales ever sent for review, with
 * the ones still on the call centre's list beside it; resolved says how the
 * closed ones closed, after a correction or withdrawn by the call centre.
 *
 * The call-centre board's figure tiles, in the module's verb colours: send
 * back is plum, a save is the sold gradient, a confirmation is verified.
 * Each figure opens its tab. The numbers are the whole list the reader may
 * see, like the tab counts, not the filtered rows below.
 */
export default function CorrectionFigures({ counts, outcomes, narrowing }) {
  const tab = (t) => {
    const params = new URLSearchParams();
    if (t !== "open") params.set("tab", t);
    if (narrowing?.mine) params.set("mine", "1");
    const q = params.toString();
    return `/data-center/corrections${q ? `?${q}` : ""}`;
  };
  const o = outcomes ?? { corrected: 0, resolvedAfterFix: 0, withdrawn: 0 };
  return (
    <div data-correction-figures className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Figure
        label="Waiting on Sales"
        value={counts.open}
        sub="sent back, not yet corrected"
        href={tab("open")}
        tone="plum"
      />
      <Figure
        label="Corrected by Sales"
        value={o.corrected}
        sub={`${counts.fixed.toLocaleString()} awaiting the call centre's review`}
        href={tab("fixed")}
        tone="sold"
      />
      <Figure
        label="Resolved"
        value={counts.resolved}
        sub={`${o.resolvedAfterFix.toLocaleString()} after a correction, ${o.withdrawn.toLocaleString()} withdrawn`}
        href={tab("resolved")}
        tone="verified"
      />
    </div>
  );
}
