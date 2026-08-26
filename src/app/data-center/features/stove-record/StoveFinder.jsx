import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import Link from "@/compat/Link";
import { dataCenterClient, DataCenterError } from "../../lib/client";
import { plural } from "../../lib/plural";
import { Search, Loader2, ArrowRight, Truck } from "lucide-react";

/**
 * One box, and the two things that are written on paper.
 *
 * A stove ID is on the label; a transfer reference is on the consignment note.
 * People arrive holding one or the other, and until now neither of them opened
 * anything - the module's tables filter by partner and by date, which is no use
 * to somebody holding a single serial.
 *
 * An exact serial navigates rather than listing, because a list of one is a
 * second click for no information. Everything else is a shortlist, including a
 * partial serial, since half a number read off a scuffed label is the normal
 * case and refusing it sends the person back to the paper.
 *
 * Searching is deliberate: it runs on Enter or on the button, not on every
 * keystroke. A serial is fifteen characters typed in one go, and a request per
 * character would be fourteen requests whose answers nobody reads.
 */
export default function StoveFinder({ autoFocus = false }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const token = useRef(0);

  useEffect(() => () => { token.current += 1; }, []);

  const run = useCallback(
    async (e) => {
      e?.preventDefault();
      const q = query.trim();
      if (q.length < 3) {
        setError("Type at least three characters of a stove ID or a transfer reference.");
        setResult(null);
        return;
      }
      const mine = (token.current += 1);
      setBusy(true);
      setError(null);
      try {
        const found = await dataCenterClient.stoveSearch(q);
        if (mine !== token.current) return;
        if (found.kind === "stove" && found.stoveId) {
          navigate({ to: `/data-center/stove/${encodeURIComponent(found.stoveId)}` });
          return;
        }
        setResult(found);
      } catch (err) {
        if (mine !== token.current) return;
        setError(
          err instanceof DataCenterError ? err.message : "That search could not be run.",
        );
        setResult(null);
      } finally {
        if (mine === token.current) setBusy(false);
      }
    },
    [query, navigate],
  );

  const nothing =
    result && result.kind === "none";

  return (
    <div className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white p-4 shadow-sm">
      <form onSubmit={run} className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
            Find a stove
          </span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={query}
              autoFocus={autoFocus}
              onChange={(ev) => setQuery(ev.target.value)}
              placeholder="Stove ID, or a transfer reference"
              aria-label="Stove ID or transfer reference"
              className="w-full rounded-md border border-gray-300 py-2 pl-8 pr-3 text-sm focus:border-(--dc-accent) focus:outline-none focus:ring-1 focus:ring-(--dc-accent)"
            />
          </div>
        </label>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-4 py-2 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Find it
        </button>
      </form>

      <p className="mt-1.5 text-xs text-gray-600">
        The serial opens that stove&apos;s whole history. A transfer reference opens
        the consignment it went out on.
      </p>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {nothing && (
        <div className="mt-3 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          <p className="font-medium">Nothing matches &ldquo;{query.trim()}&rdquo;.</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs">
            <li>Serials are letters then digits, like PRV000123 — check for an O typed as a zero.</li>
            <li>Try the first few characters on their own; partial serials are listed.</li>
            <li>
              If it is a partner&apos;s own reference rather than ours, look the partner up
              in <Link href="/data-center/partner-records" className="underline">Partner Records</Link>.
            </li>
          </ul>
        </div>
      )}

      {result?.transfers?.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
            {plural(result.transfers.length, "consignment")}
          </p>
          <ul className="space-y-1.5">
            {result.transfers.map((t) => (
              <li key={t.transfer_id}>
                <Link
                  href={`/data-center/partner-records?organizationId=${encodeURIComponent(t.organization_id)}&partnerName=${encodeURIComponent(t.partner_name ?? "")}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-gray-200 px-3 py-2 text-sm transition hover:border-(--dc-accent) hover:bg-(--dc-accent-soft)/20"
                >
                  <Truck className="h-4 w-4 shrink-0 text-(--dc-accent)" />
                  <span className="font-mono font-medium text-gray-900">{t.transaction_id}</span>
                  <span className="text-gray-700">{t.partner_name}</span>
                  {t.sales_rep && <span className="text-xs text-gray-500">{t.sales_rep}</span>}
                  <span className="text-xs text-gray-500">
                    {t.issued_count} issued · {t.digitalised_count} typed up ·{" "}
                    {t.verified_count} verified
                  </span>
                  <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-gray-400" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result?.stoves?.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
            {plural(result.stoves.length, "stove")}
            {result.stoves.length === 25 ? " (the first 25)" : ""}
          </p>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {result.stoves.map((st) => (
              <li key={st.stove_id}>
                <Link
                  href={`/data-center/stove/${encodeURIComponent(st.stove_id)}`}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm transition hover:border-(--dc-accent) hover:bg-(--dc-accent-soft)/20"
                >
                  <span className="font-mono font-medium text-gray-900">{st.stove_id}</span>
                  <span className="truncate text-xs text-gray-500">
                    {st.partner_name ?? "no partner"}
                  </span>
                  <span
                    className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
                      st.sold
                        ? "bg-(--dc-accent-soft) text-(--dc-accent-strong)"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {st.sold ? "sold" : "in stock"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
