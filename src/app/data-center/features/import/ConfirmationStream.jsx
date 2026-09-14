import { usePaged } from "../../lib/usePaged";
import { useIsPhone } from "../../lib/useMediaQuery";
import Pagination from "../../components/Pagination";
import { plural } from "../../lib/plural";
import { PenLine, CheckCircle2 } from "lucide-react";

/**
 * One stream of the confirmation queue, drawn (import redesign, 2026-09-07).
 *
 * Split out of `ConfirmationQueue.jsx` once the filter row and the phone
 * cards pushed that file past the size this module keeps files under. This
 * file renders from props only; the state machine (what is loaded, what is
 * filtered, what confirming does) stays in the parent.
 */

const whenOf = (v) => (v ? new Date(v).toLocaleString() : "-");

function SourcePill({ bench }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        bench ? "bg-(--dc-accent-soft) text-(--dc-accent-strong)" : "bg-gray-100 text-gray-600"
      }`}
    >
      {bench ? "bench" : "file"}
    </span>
  );
}

function rowView(r, stream) {
  const bench = stream.key === "workbench";
  const needsLook = Number(r.refused ?? 0) + Number(r.exceptions ?? 0);
  const name = bench
    ? (r.worked_by?.[0] ?? r.uploaded_by_name ?? "somebody")
    : (r.filename ?? "(no filename)");
  return { bench, needsLook, name };
}

function RowAction({ r, view, canConfirm, onConfirm, onOpenBench, busy }) {
  const canPoint = view.bench && typeof onOpenBench === "function";
  const awaiting = Number(r.awaiting ?? 0);

  if (awaiting > 0) {
    if (!canConfirm) return null;
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => onConfirm(r)}
        className="inline-flex w-full items-center justify-center gap-1 whitespace-nowrap rounded-md bg-(image:--dc-fig-verified) px-2.5 py-1.5 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-40"
      >
        <CheckCircle2 className="h-3.5 w-3.5" /> Confirm {r.awaiting}
      </button>
    );
  }

  if (canPoint && (Number(r.still_drafting ?? 0) > 0 || view.needsLook > 0)) {
    return (
      <button
        type="button"
        onClick={() => onOpenBench(r)}
        title={
          view.needsLook > 0
            ? "Refused receipts are fixed at the bench, then saved as finished again."
            : "Drafts are finished at the bench by the person typing them."
        }
        className="inline-flex w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border border-(--dc-brief-stove) px-2.5 py-1 text-xs font-medium text-(--dc-brief-stove) transition hover:bg-(--dc-brief-stove-soft)"
      >
        <PenLine className="h-3.5 w-3.5" /> Open the bench
      </button>
    );
  }

  return null;
}

function PhoneCard({ r, stream, canConfirm, onConfirm, onOpenBench, busy }) {
  const view = rowView(r, stream);
  return (
    <div className="space-y-1.5 border-b border-gray-100 p-3 last:border-b-0">
      <div className="flex items-center gap-1.5">
        <SourcePill bench={view.bench} />
        <span className="min-w-0 truncate text-sm font-medium text-gray-900">{view.name}</span>
      </div>
      <p className="truncate text-xs text-gray-600">{r.partner_name ?? "-"}</p>
      <p className="text-xs text-gray-700">
        {plural(Number(r.awaiting ?? 0), "record")} waiting, {r.still_drafting ?? 0} drafting,{" "}
        <span className={view.needsLook > 0 ? "font-medium text-amber-700" : ""}>
          {view.needsLook} need a look
        </span>
      </p>
      <p className="text-xs text-gray-500">Last worked on {whenOf(r.last_worked_on ?? r.uploaded_at)}</p>
      <div className="pt-1">
        <RowAction
          r={r}
          view={view}
          canConfirm={canConfirm}
          onConfirm={onConfirm}
          onOpenBench={onOpenBench}
          busy={busy}
        />
      </div>
    </div>
  );
}

export default function ConfirmationStream({ stream, rows, canConfirm, onConfirm, onOpenBench, busy }) {
  const paged = usePaged(rows, 10);
  const isPhone = useIsPhone();
  const Icon = stream.icon;
  const waiting = rows.reduce((n, r) => n + Number(r.awaiting ?? 0), 0);
  const drafting = rows.reduce((n, r) => n + Number(r.still_drafting ?? 0), 0);
  const refused = rows.reduce(
    (n, r) => n + Number(r.refused ?? 0) + Number(r.exceptions ?? 0),
    0,
  );
  /*
   * The bench stream can point at the bench. A row with nothing waiting used
   * to show a greyed "Confirm 0" and nothing else, and the person looking at
   * twenty-seven drafts had no idea what to press next: a draft is finished
   * at the bench, and so is a refused receipt. The action column exists when
   * either action can be offered, not only for people who can confirm.
   */
  const canPoint = stream.key === "workbench" && typeof onOpenBench === "function";
  const showActions = canConfirm || canPoint;

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-3">
        <Icon className="h-4 w-4 text-(--dc-accent)" />
        <h3 className="text-sm font-semibold text-gray-900">{stream.title}</h3>
        <span className="text-xs text-gray-600">{stream.blurb}</span>
        <span className="ml-auto text-sm tabular-nums text-gray-700">
          {plural(waiting, "record")} waiting
          {drafting > 0 ? `, ${drafting} still being typed` : ""}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="m-4 rounded-lg border border-dashed border-(--dc-accent)/30 px-4 py-6 text-center text-sm text-gray-600">
          {stream.empty}
        </p>
      ) : isPhone ? (
        <>
          <div>
            {paged.slice.map((r) => (
              <PhoneCard
                key={r.batch_id}
                r={r}
                stream={stream}
                canConfirm={canConfirm}
                onConfirm={onConfirm}
                onOpenBench={onOpenBench}
                busy={busy}
              />
            ))}
          </div>
          <Pagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            onPage={paged.setPage}
            onPageSize={paged.setPageSize}
            noun="batch"
          />
        </>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b-2 border-(--dc-accent) bg-(--dc-accent-soft) text-left text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
                  <th className="sticky left-0 z-10 bg-(--dc-accent-soft) px-3 py-2">
                    {stream.key === "workbench" ? "Typed by" : "File"}
                  </th>
                  <th className="px-3 py-2">Partner</th>
                  <th className="px-3 py-2 text-right">Waiting</th>
                  <th className="px-3 py-2 text-right">Drafting</th>
                  <th className="px-3 py-2 text-right">Need a look</th>
                  <th className="px-3 py-2">Last worked on</th>
                  {showActions && <th className="w-36 px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paged.slice.map((r) => {
                  const view = rowView(r, stream);
                  return (
                    <tr key={r.batch_id} className="group transition hover:bg-(--dc-accent-soft)/40">
                      <td className="sticky left-0 z-10 max-w-[16rem] bg-white px-3 py-2 group-hover:bg-(--dc-accent-soft)/40">
                        <span className="flex items-center gap-1.5">
                          <SourcePill bench={view.bench} />
                          <span className="min-w-0 truncate font-medium text-gray-900">{view.name}</span>
                        </span>
                        {!view.bench && r.uploaded_by_name && (
                          <span className="mt-0.5 block truncate text-xs text-gray-600">
                            uploaded by {r.uploaded_by_name}
                          </span>
                        )}
                      </td>
                      <td className="max-w-[14rem] truncate px-3 py-2 text-gray-700">
                        {r.partner_name ?? "-"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">
                        {r.awaiting}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                        {r.still_drafting}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          view.needsLook > 0 ? "font-medium text-amber-700" : "text-gray-500"
                        }`}
                      >
                        {view.needsLook}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">
                        {whenOf(r.last_worked_on ?? r.uploaded_at)}
                      </td>
                      {showActions && (
                        <td className="px-3 py-2 text-right">
                          <RowAction
                            r={r}
                            view={view}
                            canConfirm={canConfirm}
                            onConfirm={onConfirm}
                            onOpenBench={onOpenBench}
                            busy={busy}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
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
        </>
      )}
      {stream.key === "workbench" && (drafting > 0 || refused > 0) && (
        <p className="border-t border-gray-100 px-4 py-2.5 text-xs text-gray-600">
          Confirm releases finished receipts only.
          {drafting > 0 &&
            ` ${plural(drafting, "draft is", "drafts are")} still being typed and ${
              drafting === 1 ? "is" : "are"
            } finished at the bench, by the person typing.`}
          {refused > 0 &&
            ` ${plural(refused, "receipt was", "receipts were")} refused; each is opened at the bench, where the reason is shown, fixed and saved as finished again.`}
        </p>
      )}
    </section>
  );
}
