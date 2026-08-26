import { useEffect, useState } from "react";
import Link from "@/compat/Link";
import { dataCenterClient, DataCenterError } from "../../lib/client";
import { plural } from "../../lib/plural";
import { TriangleAlert, ArrowRight, Loader2 } from "lucide-react";

/**
 * "You have records to fix", where somebody will actually see it.
 *
 * The call centre has been able to send a record back to Sales since the call
 * layer was built. Nobody was ever told. The record went into a state nothing
 * was watching, and the loop closed only if somebody happened to open the
 * right filter on the right day - which is to say it mostly did not close.
 *
 * A summary rather than a list, because it renders above every Data Center
 * page and a list there would push the page's own work below the fold every
 * day. It names the size of the pile and the two or three partners it is
 * spread across, which is enough to decide whether to open it now.
 *
 * WHY IT SAYS DIFFERENT THINGS TO DIFFERENT PEOPLE
 *
 * A sales rep sees the records from their own consignments: "3 of your stoves
 * need an answer". A standing recipient sees everything open, because that is
 * the job they were named in Settings to do. The wording is not decoration -
 * "yours" and "everyone's" lead to different actions, and a rep who reads a
 * total of 40 as their own workload will assume the system is wrong.
 */
export default function SendBackBanner({ compact = false }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    dataCenterClient
      .sendBacks(200)
      .then((r) => live && setData(r))
      /*
       * Silent on failure, and it renders nothing.
       *
       * This sits above pages that have their own job. Somebody without
       * `corrections.fix` gets a 403 here, which is not an error they need to
       * read - it is the ordinary answer for most of the module's users.
       */
      .catch((err) => {
        if (!live) return;
        setFailed(true);
        if (!(err instanceof DataCenterError)) return;
      });
    return () => {
      live = false;
    };
  }, []);

  if (failed || !data || data.waiting === 0) return null;

  const partners = [...new Set(data.rows.map((r) => r.partner_name).filter(Boolean))];
  const mine = data.rows.filter((r) => r.is_my_consignment).length;

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 shadow-sm">
      <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-amber-900">
          {data.seesEverything
            ? `${plural(data.waiting, "record")} sent back from the call centre`
            : `${plural(data.waiting, "record")} from your consignments need an answer`}
        </p>
        <p className="mt-0.5 text-sm text-amber-900">
          {partners.length > 0 && (
            <>
              Across{" "}
              <span className="font-semibold">
                {partners.slice(0, 3).join(", ")}
                {partners.length > 3 ? ` and ${partners.length - 3} more` : ""}
              </span>
              .{" "}
            </>
          )}
          {/*
            A recipient who is also a rep is told both numbers. Otherwise the
            records they are personally answerable for are hidden inside a
            total they read as somebody else's problem.
          */}
          {data.seesEverything && mine > 0 && (
            <span className="font-semibold">
              {plural(mine, "of them")} from your own consignments.{" "}
            </span>
          )}
          {!compact && "Open the list to see which stove IDs, and go straight to each record."}
        </p>
        {/*
          Reps with work waiting and nobody to send it to. Shown only to
          somebody who can fix it, because it is a fact about the routing
          rather than about the records.
        */}
        {data.seesEverything && data.unrouted.length > 0 && (
          <p className="mt-1 text-xs text-amber-800">
            {plural(data.unrouted.length, "sales rep")} with work waiting have no
            account linked, so only this list is carrying it:{" "}
            <span className="font-medium">
              {data.unrouted.slice(0, 4).map((u) => u.sales_rep).join(", ")}
            </span>
            .
          </p>
        )}
      </div>
      <Link
        href="/data-center/corrections"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-700"
      >
        Open the list <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

/** The loading shape, for a caller that wants the space reserved. */
export function SendBackBannerSkeleton() {
  return (
    <p className="flex items-center gap-2 text-xs text-gray-400">
      <Loader2 className="h-3 w-3 animate-spin" /> checking for records sent back
    </p>
  );
}
