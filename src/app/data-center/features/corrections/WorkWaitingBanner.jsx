import { useEffect, useState } from "react";
import Link from "@/compat/Link";
import { dataCenterCorrections } from "../../lib/client";
import { plural } from "../../lib/plural";
import { TriangleAlert, ArrowRight } from "lucide-react";

/**
 * The one banner for work that is waiting on a person, above every page in
 * the module.
 *
 * One `work_waiting` read, a handful of counts, and every count is a link to
 * the surface where that work gets done and tracked: the corrections list on
 * the right tab, or the call queue on the right preset. A sales rep sees what
 * is routed to them; whoever reviews sees a second row with everyone's. It
 * draws nothing at all when every count is zero, and nothing for people the
 * module does not concern (the read answers 403 and the banner stays quiet).
 */

function Pill({ href, tone, label, count }) {
  const tones = {
    hot: "bg-amber-600 text-white hover:bg-amber-700",
    cool: "border border-amber-300 bg-white text-amber-900 hover:bg-amber-100",
    quiet: "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
  };
  const badge = {
    hot: "bg-white/30 text-white",
    cool: "bg-amber-100 text-amber-900",
    quiet: "bg-gray-100 text-gray-800",
  };
  return (
    <Link
      href={href}
      className={`inline-flex min-h-10 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition ${tones[tone]}`}
    >
      {label}
      <span className={`inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[13px] tabular-nums ${badge[tone]}`}>
        {count}
      </span>
      {tone === "hot" && <ArrowRight className="h-3.5 w-3.5" />}
    </Link>
  );
}

function headline(w) {
  if (w.mineOpen > 0) return { title: `${plural(w.mineOpen, "record")} ${w.mineOpen === 1 ? "is" : "are"} waiting for you`, body: "Sent back by the call centre. Each opens straight on the record with the wrong item marked." };
  if ((w.review ?? 0) > 0) return { title: `${plural(w.review, "correction")} ${w.review === 1 ? "is" : "are"} waiting for your review`, body: "Sales fixed them; nothing rings again until you close each one." };
  if ((w.openAll ?? 0) > 0) return { title: `${plural(w.openAll, "record")} ${w.openAll === 1 ? "is" : "are"} with Sales`, body: "Sent back by the call centre and not yet fixed." };
  if ((w.unconfirmed ?? 0) > 0) return { title: `${plural(w.unconfirmed, "stove ID")} ${w.unconfirmed === 1 ? "needs" : "need"} confirming`, body: "Another caller's rematch took the stove these records named; ring the buyer and confirm." };
  if (w.mineFixed > 0) return { title: `${plural(w.mineFixed, "fix")} of yours ${w.mineFixed === 1 ? "awaits" : "await"} review`, body: "The call centre closes each one before ringing again." };
  return null;
}

export default function WorkWaitingBanner() {
  const [w, setW] = useState(null);

  useEffect(() => {
    let live = true;
    dataCenterCorrections
      .workWaiting()
      .then((r) => live && setW(r))
      .catch(() => live && setW(null));
    return () => {
      live = false;
    };
  }, []);

  if (!w) return null;
  const head = headline(w);
  if (!head) return null;

  const personal = [];
  if (w.canFix && w.mineOpen > 0) personal.push({ href: "/data-center/corrections?tab=open&mine=1", tone: "hot", label: "Sent back to me", count: w.mineOpen });
  if (w.canFix && w.mineFixed > 0) personal.push({ href: "/data-center/corrections?tab=fixed&mine=1", tone: "cool", label: "Fixed by me, awaiting review", count: w.mineFixed });

  const everyone = [];
  if (w.canReview && (w.review ?? 0) > 0) everyone.push({ href: "/data-center/corrections?tab=fixed", tone: personal.length === 0 ? "hot" : "cool", label: "Review now", count: w.review });
  if (w.seesEverything && (w.openAll ?? 0) > 0) everyone.push({ href: "/data-center/corrections?tab=open", tone: "cool", label: "Waiting on Sales, everyone", count: w.openAll });
  if (w.canReview && (w.unconfirmed ?? 0) > 0) everyone.push({ href: "/data-center/call-centre?preset=unconfirmed", tone: "cool", label: "Stove IDs unconfirmed", count: w.unconfirmed });

  if (personal.length === 0 && everyone.length === 0) return null;

  return (
    <div data-work-waiting className="flex items-start gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 shadow-sm">
      <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-amber-900">{head.title}</p>
        <p className="mt-0.5 text-sm text-amber-900">{head.body}</p>
        {personal.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {personal.map((p) => <Pill key={p.label} {...p} />)}
          </div>
        )}
        {everyone.length > 0 && (
          <div className={`flex flex-wrap gap-2 ${personal.length > 0 ? "mt-2.5 border-t border-amber-200 pt-2.5" : "mt-2.5"}`}>
            {everyone.map((p) => <Pill key={p.label} {...p} />)}
          </div>
        )}
        {w.seesEverything && (w.unroutedReps ?? 0) > 0 && (
          <p className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-amber-200 pt-2.5 text-xs text-amber-900">
            <span>
              <strong>{plural(w.unroutedReps, "sales rep")}</strong> with work waiting {w.unroutedReps === 1 ? "has" : "have"} no account linked, so the standing recipients carry it.
            </span>
            <Link href="/data-center/settings" className="ml-auto inline-flex items-center gap-1 font-medium text-amber-900 underline-offset-2 hover:underline">
              Link a rep in Settings <ArrowRight className="h-3 w-3" />
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
