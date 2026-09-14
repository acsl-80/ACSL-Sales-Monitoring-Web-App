import { useEffect, useState } from "react";
import { Link2Off, TriangleAlert } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { dataCenterAdmin } from "../../lib/client";

/**
 * The call sheets' agent names, and the logins they mean (Phase 28, D47).
 *
 * The July and August paper call sheets named the agent by first name, as a
 * registry value. Every board, feed and page counts a call for the person it
 * resolves to: that name linked to a login, else the login that logged it.
 * This card is where the link is made. It rewrites nothing: the views resolve
 * at read time, so a link made here gives the calls back on the next refresh.
 *
 * The shape is the send-back routing's rep rows: a select per name, a mark
 * for a name that is not a person, and a line saying what each name carries.
 */
export default function SheetNames() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = () =>
    dataCenterAdmin
      .agentLinks()
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e?.message ?? "Could not load the sheet names."));

  useEffect(() => { load(); }, []);

  const act = async (key, fn, said) => {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
      setNotice(said);
      await load();
    } catch (e) {
      setError(e?.message ?? "That did not save.");
    } finally {
      setBusy(null);
    }
  };

  const canEdit = data?.canEdit === true;
  const rows = data?.links ?? [];
  const linked = rows.filter((r) => r.user_id).length;
  const open = rows.filter((r) => !r.user_id && !r.no_account).length;

  return (
    <section
      className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm"
      data-sheet-names
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Sheet names</h2>
          <p className="text-sm text-gray-600">Who the paper call sheets meant.</p>
        </div>
        {data && (
          <div className="flex gap-2 text-xs">
            <span className="rounded-full bg-(--dc-sev-ok-soft) px-2 py-0.5 font-semibold text-(--dc-sev-ok)">
              {linked} linked
            </span>
            {open > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">
                {open} to link
              </span>
            )}
          </div>
        )}
      </div>

      <p className="border-b border-gray-100 px-4 py-3 text-sm text-gray-700">
        The July and August call sheets named agents by first name. Link each name to a
        login and those calls count for that person on the board, the agent page, My calls
        and the feed. A name that is not a person stays unlinked and its calls count for
        nobody.
      </p>

      {error && (
        <p className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="border-b border-gray-100 bg-(--dc-accent-soft)/40 px-4 py-2 text-sm text-gray-800" role="status">
          {notice}
        </p>
      )}

      {!data && !error && <p className="px-4 py-6 text-sm text-gray-500">Loading the sheet names.</p>}

      {data && (
        <>
          {/* Wide: a table. */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-(--dc-accent)/20 bg-(--dc-accent-soft) text-left text-xs uppercase tracking-wide text-(--dc-accent-strong)">
                  <th scope="col" className="px-4 py-2">Sheet name</th>
                  <th scope="col" className="px-3 py-2 text-right">Calls on sheets</th>
                  <th scope="col" className="px-3 py-2 text-right">Records</th>
                  <th scope="col" className="px-3 py-2">Login</th>
                  <th scope="col" className="w-40 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <Row key={r.agent_key} r={r} canEdit={canEdit} busy={busy} act={act} candidates={data.candidates} />
                ))}
              </tbody>
            </table>
          </div>
          {/* Phone: a card per name. */}
          <ul className="divide-y divide-gray-100 sm:hidden">
            {rows.map((r) => (
              <li key={r.agent_key} className="flex flex-col gap-2 px-4 py-3" data-sheet-name={r.agent_key}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-900">{r.agent_label}</span>
                  <span className="text-xs tabular-nums text-gray-600">{r.attempts_tagged.toLocaleString()} calls on sheets</span>
                </div>
                <LoginControl r={r} canEdit={canEdit} busy={busy} act={act} candidates={data.candidates} />
                {canEdit && !r.user_id && (
                  <NotAPerson r={r} busy={busy} act={act} />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Row({ r, canEdit, busy, act, candidates }) {
  return (
    <tr className="align-middle" data-sheet-name={r.agent_key}>
      <td className="px-4 py-2 font-medium text-gray-900">{r.agent_label}</td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-700">{r.attempts_tagged.toLocaleString()}</td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-700">{r.records_tagged.toLocaleString()}</td>
      <td className="px-3 py-2">
        <LoginControl r={r} canEdit={canEdit} busy={busy} act={act} candidates={candidates} />
      </td>
      <td className="px-3 py-2">
        {canEdit && !r.user_id && <NotAPerson r={r} busy={busy} act={act} />}
      </td>
    </tr>
  );
}

function NotAPerson({ r, busy, act }) {
  return (
    <button
      type="button"
      disabled={busy === r.agent_key}
      onClick={() =>
        act(
          r.agent_key,
          () => dataCenterAdmin.agentLinkSet(r.agent_key, null, !r.no_account),
          r.no_account ? `${r.agent_label} is back in the list to link.` : `${r.agent_label} is marked as not a person.`,
        )
      }
      className="self-start rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    >
      {r.no_account ? "Back in the list" : "Not a person"}
    </button>
  );
}

function LoginControl({ r, canEdit, busy, act, candidates }) {
  if (r.no_account) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-600">
        <Link2Off className="h-3 w-3" aria-hidden /> not a person
      </span>
    );
  }
  if (!canEdit) {
    return <span className="text-gray-700">{r.account_name ?? "not linked"}</span>;
  }
  return (
    <div className="flex flex-col gap-1">
      <SearchableSelect
        className="min-w-[14rem]"
        value={r.user_id ?? ""}
        disabled={busy === r.agent_key}
        ariaLabel={`Login for ${r.agent_label}`}
        placeholder="Pick a login"
        searchPlaceholder="Type part of a name"
        emptyLabel="No login matches that"
        onChange={(next) =>
          act(
            r.agent_key,
            () => dataCenterAdmin.agentLinkSet(r.agent_key, next || null),
            next ? `${r.agent_label} now counts for the linked login.` : `${r.agent_label} is no longer linked.`,
          )
        }
        pinned={{ value: "", label: "Pick a login" }}
        options={candidates.map((c) => ({ value: c.id, label: c.full_name }))}
      />
      {!r.user_id && r.attempts_tagged > 0 && (
        <span className="flex items-start gap-1 text-xs text-amber-800">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {r.attempts_tagged.toLocaleString()} calls count for nobody until this is linked.
        </span>
      )}
    </div>
  );
}
