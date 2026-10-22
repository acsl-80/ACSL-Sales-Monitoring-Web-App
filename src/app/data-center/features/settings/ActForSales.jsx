import { Loader2, UserCheck } from "lucide-react";
import { dataCenterAdmin } from "../../lib/client";
import { plural } from "../../lib/plural";

/**
 * Who may act for Sales on a sent-back record (D67).
 *
 * A level switched on here gives every holder of it the same power a standing
 * recipient has: open any record waiting on Sales, fix it, and send it for
 * review, with the record saying whose behalf it was done on. One person gets
 * the same through the Access section's "Act for Sales on sent-back records".
 *
 * The four levels he named, in the Access section's order and words. Changed
 * only by grants.manage; everybody who may open this page can read it.
 */
const LEVELS = [
  { key: "viewer", label: "Viewer" },
  { key: "call_agent", label: "Call agent" },
  { key: "editor", label: "Editor" },
  { key: "data_manager", label: "Data manager" },
];

export default function ActForSales({ config, busy, act }) {
  const on = new Set(config?.levels ?? []);
  const holders = config?.holders ?? [];
  const canEdit = config?.canEdit === true;

  return (
    <section
      data-act-for-sales
      className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-3">
        <UserCheck className="h-4 w-4 text-(--dc-accent)" />
        <span className="text-sm font-semibold text-gray-900">Who can act for Sales</span>
        <span className="text-sm text-gray-500">
          {on.size === 0 ? "no level switched on" : `${plural(on.size, "level")} switched on`}
          {holders.length > 0 ? `, ${plural(holders.length, "person", "people")} by hand` : ""}
        </span>
      </div>

      <p className="border-b border-gray-100 px-4 py-2.5 text-sm text-gray-600">
        Anyone here can open any record waiting on Sales, fix it, and send it for review.
        The record names who fixed it and which rep it was fixed for.
        {!canEdit && " Changing this needs the grants.manage permission."}
      </p>

      <ul className="divide-y divide-gray-100">
        {LEVELS.map((level) => {
          const checked = on.has(level.key);
          const id = `act-for-sales-${level.key}`;
          return (
            <li key={level.key} className="flex items-center gap-3 px-4 py-2.5">
              <input
                id={id}
                type="checkbox"
                checked={checked}
                disabled={!canEdit || busy !== null}
                onChange={(e) =>
                  act(
                    `level:${level.key}`,
                    () => dataCenterAdmin.actForSalesLevelSet(level.key, e.target.checked),
                    e.target.checked
                      ? `Every ${level.label.toLowerCase()} can now act for Sales.`
                      : `${level.label}s no longer act for Sales, unless given it by hand.`,
                  )
                }
                className="h-4 w-4 rounded border-gray-300 accent-(--dc-accent)"
              />
              <label htmlFor={id} className="flex-1 text-sm text-gray-900">
                Every {level.label.toLowerCase()}
              </label>
              {busy === `level:${level.key}` && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
            </li>
          );
        })}
      </ul>

      <div className="border-t border-gray-100 px-4 py-2.5 text-sm text-gray-600">
        {holders.length === 0 ? (
          "Nobody has it by hand. Give it to one person in the Access section."
        ) : (
          <>
            By hand:{" "}
            {holders.map((h, i) => (
              <span key={h.user_id}>
                {i > 0 ? ", " : ""}
                <span className="font-medium text-gray-900">{h.full_name ?? h.email ?? "unnamed"}</span>
              </span>
            ))}
            . Added or removed in the Access section.
          </>
        )}
      </div>
    </section>
  );
}
