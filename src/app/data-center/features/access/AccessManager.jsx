import { useCallback, useEffect, useRef, useState } from "react";
import { dataCenterAdmin, DataCenterError } from "../../lib/client";
import { invalidateModuleAccessCache } from "../../lib/useModuleAccess";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Loader2,
  UserPlus,
  ShieldCheck,
  Trash2,
  History,
  Eye,
  Pencil,
  PhoneCall,
} from "lucide-react";

/**
 * The access section of the Data Center page. Access only: who may enter the
 * module, at one of three levels, granted case by case per user.
 *
 * Rendering this component is gated by the caller, but that gate is
 * presentation. data-center-admin re-checks authority on every call, so a user
 * who somehow renders this without holding it gets 403s, not results.
 */

/**
 * Three levels, and the third is not a rung on the ladder.
 *
 * A call agent works the phone. They read the records and edit the call
 * records, and they import nothing, because a person paid to make calls has no
 * reason to move stock and `import.upload` is one step from `import.commit`.
 *
 * The server holds the same table in `_shared/data-center-roles.ts` and is the
 * authority. What is here is the wording.
 */
const ROLE_META = {
  viewer: {
    label: "Viewer", icon: Eye,
    blurb: "Can see records and dashboards.",
    tone: "bg-(--dc-primary)/10 text-(--dc-accent)",
    button: "border-(--dc-primary)/30 text-(--dc-primary) hover:bg-(--dc-primary)/10",
  },
  call_agent: {
    label: "Call agent", icon: PhoneCall,
    blurb: "Can also work call records. No import, no stock.",
    tone: "border-blue-300 bg-blue-50 text-blue-800",
    button: "border-blue-400/50 text-blue-700 hover:bg-blue-50",
  },
  editor: {
    label: "Editor", icon: Pencil,
    blurb: "Can also record and change data, and import. Changes are tracked.",
    tone: "border-amber-300 bg-amber-50 text-amber-800",
    button: "border-amber-400/50 text-amber-700 hover:bg-amber-50",
  },
};

const ROLES = ["viewer", "call_agent", "editor"];

function RoleChip({ role }) {
  const meta = ROLE_META[role];
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.tone}`}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

export default function AccessManager() {
  const [entries, setEntries] = useState([]);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchToken = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const [accessList, changeLog] = await Promise.all([
        dataCenterAdmin.listAccess(),
        dataCenterAdmin.changeLog(15),
      ]);
      setEntries(accessList);
      setLog(changeLog);
      setError(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not load access data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Debounced user search against profiles.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const token = ++searchToken.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await dataCenterAdmin.searchUsers(q);
        if (token === searchToken.current) setResults(found);
      } catch {
        if (token === searchToken.current) setResults([]);
      } finally {
        if (token === searchToken.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const grant = async (userId, accessRole) => {
    setBusy(true);
    try {
      await dataCenterAdmin.grantAccess(userId, accessRole);
      invalidateModuleAccessCache();
      setQuery("");
      setResults([]);
      await refresh();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Grant failed.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (userId) => {
    setBusy(true);
    try {
      await dataCenterAdmin.revokeAccess(userId);
      invalidateModuleAccessCache();
      await refresh();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Revoke failed.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white p-5 shadow-sm text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading access...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white p-5 shadow-sm">
        <div className="mb-1 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-(--dc-accent)" />
          <h2 className="text-sm font-semibold text-gray-900">Access</h2>
        </div>
        <p className="mb-3 text-sm text-gray-600">
          Grant the Data Center to individual users, case by case. Every change
          made under any level is tracked below.
        </p>

        {/* What each level means. Two levels explained themselves; three do
            not, and someone granting access should not have to guess what a
            call agent can reach. */}
        <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-1.5 rounded-lg border border-(--dc-accent)/15 bg-(--dc-accent-soft)/30 px-3 py-2.5">
          {ROLES.map((role) => {
            const meta = ROLE_META[role];
            const Icon = meta.icon;
            return (
              <li key={role} className="flex items-center gap-1.5 text-xs text-gray-600">
                <Icon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                <span className="font-medium text-gray-800">{meta.label}</span>
                <span>{meta.blurb}</span>
              </li>
            );
          })}
        </ul>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        {/* Grant: search a user, pick a level.

            The results used to be an absolutely-positioned div, which meant any
            ancestor that ever gained overflow would clip them. A popover
            portals to the body and cannot be clipped by anything. */}
        <Popover open={query.trim().length >= 2} onOpenChange={() => {}}>
          <PopoverAnchor asChild>
            <div className="mb-4 flex max-w-md items-center gap-2">
              <UserPlus className="h-4 w-4 shrink-0 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, email or username to grant access..."
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-(--dc-accent) focus:outline-none"
              />
            </div>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            sideOffset={4}
            // The input keeps focus while results arrive: closing the keyboard
            // or stealing the caret mid-search is how a search box loses a word.
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="dc-root w-[min(28rem,90vw)] p-0"
          >
            <div className="rounded-md">
              {searching ? (
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-gray-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching...
                </div>
              ) : results.length === 0 ? (
                <p className="px-3 py-2 text-sm text-gray-500">No matching users</p>
              ) : (
                results.map((u) => (
                  <div key={u.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-gray-900">{u.full_name || u.email}</p>
                      <p className="truncate text-xs text-gray-500">
                        {u.email} · {u.role}
                        {u.current_access ? ` · already ${u.current_access}` : ""}
                      </p>
                    </div>
                    {ROLES.map((role) => (
                      <button
                        key={role}
                        type="button"
                        disabled={busy}
                        onClick={() => grant(u.id, role)}
                        className={`rounded border px-2 py-1 text-xs font-medium disabled:opacity-50 ${ROLE_META[role].button}`}
                      >
                        {ROLE_META[role].label}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Who has access today */}
        {entries.length === 0 ? (
          <p className="text-sm text-gray-500">
            Nobody has been granted access yet. Super admins always have it.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
            {entries.map((e) => (
              <li key={e.user_id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {e.full_name || e.email}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {e.email} · {e.app_role}
                    {e.granted_by_name ? ` · granted by ${e.granted_by_name}` : ""}
                  </p>
                </div>
                <RoleChip role={e.access_role} />
                {/* A select rather than a toggle. Two levels could swap; three
                    cannot, and a "make editor" link that cycles through call
                    agent on the way is a worse answer than a list. */}
                <select
                  aria-label={`Access level for ${e.full_name || e.email}`}
                  value={e.access_role}
                  disabled={busy}
                  onChange={(event) => grant(e.user_id, event.target.value)}
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 focus:border-(--dc-accent) focus:outline-none disabled:opacity-50"
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>{ROLE_META[role].label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => revoke(e.user_id)}
                  aria-label={`Revoke access for ${e.full_name || e.email}`}
                  className="rounded p-1 text-gray-500 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Tracked changes. Written by a database trigger, so nothing an editor
          does can skip it. */}
      <div className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white p-5 shadow-sm">
        <div className="mb-1 flex items-center gap-2">
          <History className="h-4 w-4 text-(--dc-accent)" />
          <h2 className="text-sm font-semibold text-gray-900">Recent changes</h2>
        </div>
        <p className="mb-3 text-sm text-gray-600">
          Every change by an editor is recorded automatically.
        </p>
        {log.length === 0 ? (
          <p className="text-sm text-gray-500">No changes recorded yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {log.map((c) => (
              <li key={c.id} className="flex items-baseline gap-2 text-sm">
                <span
                  className={`w-14 shrink-0 text-xs font-semibold ${
                    c.action === "DELETE"
                      ? "text-red-600"
                      : c.action === "INSERT"
                        ? "text-(--dc-accent)"
                        : "text-amber-700"
                  }`}
                >
                  {c.action}
                </span>
                <span className="min-w-0 flex-1 truncate text-gray-700">
                  {c.table_name} · {c.record_pk}
                </span>
                <span className="shrink-0 text-xs text-gray-500">
                  {c.changed_by_name || "system"} ·{" "}
                  {new Date(c.changed_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
