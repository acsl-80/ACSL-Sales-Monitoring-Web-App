import { useCallback, useEffect, useRef, useState } from "react";
import { dataCenterAdmin, DataCenterError } from "../../lib/client";
import { invalidateModuleAccessCache } from "../../lib/useModuleAccess";
import {
  Loader2,
  UserPlus,
  ShieldCheck,
  Trash2,
  History,
  Eye,
  Pencil,
} from "lucide-react";

/**
 * The access section of the Data Center page. Access only: who may enter the
 * module, at viewer or editor level, granted case by case per user.
 *
 * Rendering this component is gated by the caller, but that gate is
 * presentation. data-center-admin re-checks authority on every call, so a user
 * who somehow renders this without holding it gets 403s, not results.
 */

const ROLE_META = {
  viewer: { label: "Viewer", icon: Eye, blurb: "Can see records and dashboards." },
  editor: { label: "Editor", icon: Pencil, blurb: "Can also record and change data. Changes are tracked." },
};

function RoleChip({ role }) {
  const meta = ROLE_META[role];
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        role === "editor" ? "bg-amber-100 text-amber-800" : "bg-[#4a5d0f]/10 text-[#4a5d0f]"
      }`}
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
      <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-[#fafafa] p-5 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading access...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-100 bg-[#fafafa] p-5">
        <div className="mb-1 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#4a5d0f]" />
          <h2 className="text-sm font-semibold text-gray-900">Access</h2>
        </div>
        <p className="mb-4 text-sm text-gray-600">
          Grant the Data Center to individual users, case by case. Viewers see;
          editors change, and every editor change is tracked below.
        </p>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        {/* Grant: search a user, pick a level */}
        <div className="relative mb-4 max-w-md">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 shrink-0 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email or username to grant access..."
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#4a5d0f] focus:outline-none"
            />
          </div>
          {query.trim().length >= 2 && (
            <div className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
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
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => grant(u.id, "viewer")}
                      className="rounded border border-[#4a5d0f]/30 px-2 py-1 text-xs font-medium text-[#4a5d0f] hover:bg-[#4a5d0f]/10 disabled:opacity-50"
                    >
                      Viewer
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => grant(u.id, "editor")}
                      className="rounded border border-amber-400/50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                    >
                      Editor
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

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
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    grant(e.user_id, e.access_role === "viewer" ? "editor" : "viewer")
                  }
                  className="text-xs font-medium text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline disabled:opacity-50"
                >
                  make {e.access_role === "viewer" ? "editor" : "viewer"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => revoke(e.user_id)}
                  aria-label={`Revoke access for ${e.full_name || e.email}`}
                  className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
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
      <div className="rounded-xl border border-gray-100 bg-[#fafafa] p-5">
        <div className="mb-1 flex items-center gap-2">
          <History className="h-4 w-4 text-[#4a5d0f]" />
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
                        ? "text-[#4a5d0f]"
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
