import { useCallback, useEffect, useMemo, useState } from "react";
import { dataCenterAdmin, DataCenterError } from "../../lib/client";
import { plural } from "../../lib/plural";
import Pagination from "../../components/Pagination";
import { usePaged } from "../../lib/usePaged";
import {
  Loader2, AlertTriangle, UserPlus, X, Search, Link2, Link2Off, Check,
  Users, TriangleAlert, Info,
} from "lucide-react";

/**
 * Where a send-back goes, configured rather than coded.
 *
 * Two lists, and the second one is the difficult half.
 *
 * WHO RECEIVES THEM
 *
 * A standing list of people, chosen here. They always receive every send-back,
 * whether or not the sale's rep has an account - which is what makes them the
 * backstop rather than a convenience. A record can never be routed into a void
 * while this list has somebody enabled on it.
 *
 * WHICH ACCOUNT A REP NAME MEANS
 *
 * `stove_transfer_history.sales_rep` is free text written by the ERP, not a
 * foreign key. Measured against production: 23 distinct names, 11 match an app
 * profile, 12 do not - and the three largest by volume are among the twelve.
 * Four of the values are not people at all: a town, a state, and two system
 * logins.
 *
 * So the link is made by hand, once per rep, and the screen is sorted by how
 * many consignments sit behind each name. That ordering is the whole point: an
 * unlinked rep with 145 consignments and an unlinked rep with one look
 * identical without it, and only one of them is worth chasing an account for.
 */

const ROLE_LABEL = {
  super_admin: "Super admin",
  acsl_agent_manager: "ACSL manager",
  acsl_agent: "ACSL agent",
  partner: "Partner",
  partner_agent: "Partner agent",
};

function Person({ name, email, role }) {
  return (
    <span className="min-w-0">
      <span className="font-medium text-gray-900">{name ?? "unnamed"}</span>
      {email && <span className="ml-1.5 text-xs text-gray-500">{email}</span>}
      {role && (
        <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
          {ROLE_LABEL[role] ?? role}
        </span>
      )}
    </span>
  );
}

export default function SendBackRouting({ canEdit }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);
  const [adding, setAdding] = useState("");
  const [repFilter, setRepFilter] = useState("unlinked");
  const [repSearch, setRepSearch] = useState("");

  const load = useCallback(() => {
    dataCenterAdmin
      .sendBackConfig()
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((err) =>
        setError(
          err instanceof DataCenterError ? err.message : "Could not load send-back routing.",
        ),
      );
  }, []);

  useEffect(load, [load]);

  const act = async (key, fn, said) => {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
      await load();
      setNotice(said);
      setError(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  };

  const reps = useMemo(() => {
    const term = repSearch.trim().toLowerCase();
    return (data?.reps ?? []).filter((r) => {
      if (term && !r.rep_name.toLowerCase().includes(term)) return false;
      if (repFilter === "unlinked") return !r.user_id && !r.no_account;
      if (repFilter === "linked") return Boolean(r.user_id);
      if (repFilter === "none") return Boolean(r.no_account);
      return true;
    });
  }, [data, repFilter, repSearch]);

  const paged = usePaged(reps, 15);

  const counts = useMemo(() => {
    const all = data?.reps ?? [];
    return {
      all: all.length,
      unlinked: all.filter((r) => !r.user_id && !r.no_account).length,
      linked: all.filter((r) => r.user_id).length,
      none: all.filter((r) => r.no_account).length,
      // The number that decides whether this screen is urgent: consignments
      // sitting behind a name nobody can be told about.
      strandedTransfers: all
        .filter((r) => !r.user_id && !r.no_account)
        .reduce((n, r) => n + r.transfers, 0),
    };
  }, [data]);

  const enabled = (data?.recipients ?? []).filter((r) => r.is_enabled);

  if (error && !data) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-sm text-amber-900">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading send-back routing...
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-(--dc-accent)/25 bg-(--dc-accent-soft)/50 px-3 py-2 text-sm text-(--dc-accent-strong)">
          {notice}
        </p>
      )}

      {/* ------------------------------------------------------- recipients */}
      <section className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-3">
          <Users className="h-4 w-4 text-(--dc-accent)" />
          <span className="text-sm font-semibold text-gray-900">
            Who receives records sent back
          </span>
          <span className="text-sm text-gray-500">
            {plural(enabled.length, "person")} on the list
          </span>
        </div>

        <p className="border-b border-gray-100 px-4 py-2.5 text-sm text-gray-600">
          These people receive <span className="font-medium">every</span> record the
          call centre sends back, and they take precedence: where the sale&apos;s rep
          has no account, this list is what makes sure somebody still treats it.
          The rep is notified as well when their name is linked below.
        </p>

        {enabled.length === 0 && (
          <p className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              <span className="font-semibold">Nobody is on this list.</span> A record
              sent back for a rep with no linked account currently reaches no one at
              all. Add at least one person.
            </span>
          </p>
        )}

        <ul className="divide-y divide-gray-100">
          {(data.recipients ?? []).map((r) => (
            <li key={r.user_id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <Person name={r.full_name} email={r.email} role={r.role} />
              {!r.is_enabled && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                  paused
                </span>
              )}
              <span className="ml-auto flex items-center gap-1.5">
                {canEdit && (
                  <>
                    {/* Paused rather than removed is what somebody on leave
                        needs: they stop receiving without anybody having to
                        remember who was on the list before they left. */}
                    <button
                      type="button"
                      disabled={busy === r.user_id}
                      onClick={() =>
                        act(
                          r.user_id,
                          () =>
                            dataCenterAdmin.sendBackRecipientSet(r.user_id, !r.is_enabled),
                          r.is_enabled
                            ? `${r.full_name} has been paused.`
                            : `${r.full_name} is receiving send-backs again.`,
                        )
                      }
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {r.is_enabled ? "Pause" : "Resume"}
                    </button>
                    <button
                      type="button"
                      disabled={busy === r.user_id}
                      onClick={() =>
                        act(
                          r.user_id,
                          () => dataCenterAdmin.sendBackRecipientSet(r.user_id, null),
                          `${r.full_name} has been taken off the list.`,
                        )
                      }
                      aria-label={`Remove ${r.full_name} from the send-back list`}
                      className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-gray-50/60 px-4 py-2.5">
            <label htmlFor="dc-add-recipient" className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Add somebody
            </label>
            <select
              id="dc-add-recipient"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              className="min-w-[16rem] rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none"
            >
              <option value="">Choose a user</option>
              {data.candidates
                .filter((c) => !data.recipients.some((r) => r.user_id === c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                    {c.email ? ` — ${c.email}` : ""}
                  </option>
                ))}
            </select>
            <button
              type="button"
              disabled={!adding || busy === adding}
              onClick={() =>
                act(
                  adding,
                  async () => {
                    await dataCenterAdmin.sendBackRecipientSet(adding, true);
                    setAdding("");
                  },
                  "Added to the send-back list.",
                )
              }
              className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-3 py-1.5 text-sm font-medium text-white hover:bg-(--dc-accent-strong) disabled:opacity-40"
            >
              <UserPlus className="h-4 w-4" /> Add
            </button>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------ rep mapping */}
      <section className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-3">
          <Link2 className="h-4 w-4 text-(--dc-accent)" />
          <span className="text-sm font-semibold text-gray-900">
            Which account each sales rep is
          </span>
          <span className="text-sm text-gray-500">
            {counts.linked} linked · {counts.unlinked} still to do
          </span>
        </div>

        <p className="border-b border-gray-100 px-4 py-2.5 text-sm text-gray-600">
          The ERP writes the rep&apos;s <span className="font-medium">name</span> on a
          consignment, not their account, so the two have to be joined by hand
          once. A rep who is linked is notified about their own send-backs;
          one who is not still has their records treated by the list above.
        </p>

        {counts.unlinked > 0 && (
          <p className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              {plural(counts.unlinked, "name")} unlinked, carrying{" "}
              <span className="font-semibold">
                {counts.strandedTransfers.toLocaleString()} consignments
              </span>{" "}
              between them. Linking one fixes every send-back already open for that
              rep, not just the next one.
            </span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2.5">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={repSearch}
              onChange={(e) => setRepSearch(e.target.value)}
              placeholder="Find a rep by name"
              aria-label="Find a sales rep"
              className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:border-(--dc-accent) focus:outline-none"
            />
          </div>
          {[
            { key: "unlinked", label: "Still to link", n: counts.unlinked },
            { key: "linked", label: "Linked", n: counts.linked },
            { key: "none", label: "Not a person", n: counts.none },
            { key: "all", label: "All", n: counts.all },
          ].map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={repFilter === f.key}
              onClick={() => setRepFilter(f.key)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                repFilter === f.key
                  ? "border-(--dc-accent) bg-(--dc-accent) text-white"
                  : "border-gray-300 text-gray-700 hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/50"
              }`}
            >
              {f.label} ({f.n})
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b-2 border-(--dc-accent)/20 bg-(--dc-accent-soft) text-left text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
                <th scope="col" className="px-4 py-2">Rep, as the ERP writes it</th>
                <th scope="col" className="px-3 py-2 text-right">Consignments</th>
                <th scope="col" className="px-3 py-2 text-right">Waiting</th>
                <th scope="col" className="px-3 py-2">Account</th>
                <th scope="col" className="w-8 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paged.slice.map((rep) => (
                <tr key={rep.rep_key} className="align-middle">
                  <td className="px-4 py-2 font-medium text-gray-900">{rep.rep_name}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                    {rep.transfers.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {rep.waiting > 0 ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                        {rep.waiting}
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {rep.no_account ? (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                        <Link2Off className="h-3 w-3" /> not a person
                      </span>
                    ) : canEdit ? (
                      <select
                        value={rep.user_id ?? ""}
                        disabled={busy === rep.rep_key}
                        aria-label={`Account for ${rep.rep_name}`}
                        onChange={(e) =>
                          act(
                            rep.rep_key,
                            () =>
                              dataCenterAdmin.salesRepLink(
                                rep.rep_key,
                                e.target.value || null,
                              ),
                            e.target.value
                              ? `${rep.rep_name} is now linked.`
                              : `${rep.rep_name} is no longer linked.`,
                          )
                        }
                        className="w-full min-w-[14rem] rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-(--dc-accent) focus:outline-none"
                      >
                        <option value="">Not linked</option>
                        {data.candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.full_name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-gray-700">{rep.account_name ?? "not linked"}</span>
                    )}
                    {/*
                      Linked and able to see it are two facts, and only one of
                      them is set here. An administrator who links somebody and
                      walks away believing they are now notified would be
                      wrong, and nothing on screen used to say so.
                    */}
                    {rep.user_id && rep.account_can_see === false && (
                      <span className="mt-1 flex items-start gap-1 text-xs text-amber-800">
                        <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                        Linked, but this account cannot open send-backs yet. Give
                        them the <span className="font-medium">Sales rep</span> level
                        under Access above.
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {canEdit && (
                      <button
                        type="button"
                        disabled={busy === rep.rep_key}
                        title={
                          rep.no_account
                            ? "Put this name back in the list to link"
                            : "This name is a town, a system login or something else that is not a person"
                        }
                        onClick={() =>
                          act(
                            rep.rep_key,
                            () =>
                              dataCenterAdmin.salesRepLink(rep.rep_key, null, !rep.no_account),
                            rep.no_account
                              ? `${rep.rep_name} is back in the list to link.`
                              : `${rep.rep_name} is marked as not a person.`,
                          )
                        }
                        aria-label={
                          rep.no_account
                            ? `Put ${rep.rep_name} back in the list to link`
                            : `Mark ${rep.rep_name} as not a person`
                        }
                        className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
                      >
                        {rep.no_account ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Link2Off className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination
          page={paged.page}
          pageSize={paged.pageSize}
          total={paged.total}
          onPage={paged.setPage}
          onPageSize={paged.setPageSize}
          noun="rep"
        />
      </section>

      {/*
        The reasons themselves are data and always were. Pointing at where they
        live rather than building a second editor for them: `correction_reason`
        is an option list like any other, and one editor for all of them is why
        retiring a reason has never needed a deploy.
      */}
      <p className="rounded-xl border border-gray-200 bg-gray-50/70 px-4 py-3 text-sm text-gray-600">
        <span className="font-medium text-gray-800">
          The reasons a record can be sent back
        </span>{" "}
        are edited under <span className="font-medium">Call form → Option lists →
        Correction Reason</span>. Adding, renaming, reordering or retiring one is
        data entry, not a release. Retiring keeps the history: records already
        sent back for that reason still say so.
      </p>
    </div>
  );
}
