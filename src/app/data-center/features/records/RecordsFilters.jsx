import { cloneElement, useId, useMemo, useState } from "react";
import { Search, X, SlidersHorizontal, ArrowDownWideNarrow, ArrowUpWideNarrow } from "lucide-react";

/**
 * How a register of half a million stoves gets narrowed to the ones you want.
 *
 * The table used to offer five controls: a search box, two status dropdowns
 * and two dates. Everything else the server could already filter on - partner,
 * buyer's state, sales rep, sales model, who recorded it, which channel it
 * came through - was reachable only by clicking a figure on the dashboard,
 * which means it was reachable only if a dashboard figure happened to ask your
 * question. Somebody wanting "Kano, this partner, sold by Musa" had no way to
 * ask for it at all.
 *
 * TWO ROWS, NOT ONE WALL
 *
 * The common case is a search and a period, so those stay on top and always
 * visible. The other nine live behind one button, with a count on it, because
 * eleven controls in a row is a wall that people stop reading - and a filter
 * nobody reads is a filter nobody uses.
 *
 * The chips underneath are the important half. A filter you set and forgot is
 * how somebody concludes a partner has no records in March; every active
 * filter says its own name and can be taken off on its own.
 *
 * WHY THE LISTS ARE LISTS AND NOT TEXT BOXES
 *
 * Typing a partner's name from memory finds nothing when the record says
 * "Gombe Enterprise Ltd" and you typed "Gombe Enterprises". Every value here
 * that exists as a row somewhere is chosen from that row.
 */

const SALE_STATUSES = ["incomplete", "completed", "pending", "assigned"];
const PAYMENT_STATUSES = ["not_applicable", "partially_paid", "fully_paid"];
const PLATFORMS = [
  { value: "web", label: "Sales web app" },
  { value: "mobile", label: "Sales mobile app" },
];

const words = (v) => String(v).replace(/_/g, " ");

/** The filters that live behind "More filters", in the order they are shown. */
const ADVANCED = [
  "organizationId",
  "transferSalesRep",
  "userState",
  "userLga",
  "saleAgent",
  "salesModel",
  "saleStatus",
  "paymentStatus",
  "platform",
  "dateFrom",
  "dateTo",
  "includeArchived",
];

/**
 * A labelled control, associated explicitly rather than by wrapping.
 *
 * A <label> wrapping a <select> does associate the two - but the accessible
 * name is then the label's whole text content, and the selected <option> sits
 * inside it. "Partner" came out as "PartnerAny partner", so nothing on the
 * page was addressable by what the control is actually called: not by a screen
 * reader, not by a test, not by anything that names a field.
 *
 * cloneElement rather than a render prop, so the eleven call sites below stay
 * readable as markup. The id comes from useId, so two of these panels on one
 * page still associate correctly.
 */
function Field({ label, children }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label
        htmlFor={id}
        className="text-[11px] font-semibold uppercase tracking-wide text-gray-500"
      >
        {label}
      </label>
      {cloneElement(children, { id })}
    </div>
  );
}

const SELECT =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-(--dc-accent) focus:outline-none focus:ring-1 focus:ring-(--dc-accent)";

function Chip({ children, onRemove }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-(--dc-accent)/40 bg-(--dc-accent-soft) py-0.5 pl-2.5 pr-1 text-xs font-medium text-(--dc-accent-strong)">
      <span className="truncate">{children}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter: ${typeof children === "string" ? children : "this one"}`}
        className="rounded-full p-0.5 text-(--dc-accent) transition hover:bg-(--dc-accent)/15"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

export default function RecordsFilters({
  draft,
  setDraft,
  onClear,
  facets,
  direction,
  onDirection,
}) {
  const [open, setOpen] = useState(false);

  const set = (key, value) =>
    setDraft({ ...draft, [key]: value === "" || value === false ? undefined : value });

  /*
   * Clearing the state clears the LGA with it.
   *
   * An LGA left behind by a state that changed is a filter for somewhere that
   * is no longer in the list - it silently returns nothing, and the reason is
   * a control the user cannot see because it belongs to a state they are no
   * longer looking at.
   */
  const setState = (value) => {
    const next = { ...draft, userState: value || undefined };
    if (draft.userLga && draft.userState !== value) delete next.userLga;
    setDraft(next);
  };

  const lgas = draft.userState ? (facets.lgasByState[draft.userState] ?? []) : [];

  const label = useMemo(() => {
    const partner = (id) => facets.partners.find((p) => p.id === id)?.name ?? "one partner";
    const model = (id) => facets.salesModels.find((m) => m.id === id)?.name ?? "one model";
    const agent = (id) => facets.salesAgents.find((a) => a.id === id)?.name ?? "one agent";
    return {
      search: (v) => `matching "${v}"`,
      organizationId: (v) => partner(v),
      transferSalesRep: (v) => `rep ${v}`,
      userState: (v) => `${v} state`,
      userLga: (v) => `${v} LGA`,
      saleAgent: (v) => `sold by ${agent(v)}`,
      salesModel: (v) => model(v),
      saleStatus: (v) => `status ${words(v)}`,
      paymentStatus: (v) => `payment ${words(v)}`,
      platform: (v) => (v === "mobile" ? "from the mobile app" : "from the web app"),
      dateFrom: (v) => `sold on or after ${v}`,
      dateTo: (v) => `sold on or before ${v}`,
      includeArchived: () => "including archived",
    };
  }, [facets]);

  const active = Object.entries(draft).filter(
    ([, v]) => v !== undefined && v !== "" && v !== false,
  );
  const advancedCount = active.filter(([k]) => ADVANCED.includes(k)).length;

  return (
    <div className="border-b border-gray-100 bg-white">
      {/* ------------------------------------------------------------ row one */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <div className="relative w-full min-w-0 sm:w-auto sm:min-w-[240px] sm:flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={draft.search ?? ""}
            onChange={(e) => set("search", e.target.value)}
            placeholder="Name, phone, stove ID or transaction ID"
            className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:border-(--dc-accent) focus:outline-none"
          />
        </div>

        {/*
          Oldest-first is not decoration. The table pages forward only, so
          without it the only way to reach the oldest record in a register of
          half a million is to scroll past all of them. Turning the sort round
          is a new first page from the server, not a re-sort of what is loaded.
        */}
        <button
          type="button"
          onClick={() => onDirection(direction === "desc" ? "asc" : "desc")}
          title="Which end of the register to start from"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-700 transition hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/50"
        >
          {direction === "desc" ? (
            <ArrowDownWideNarrow className="h-4 w-4 text-(--dc-accent)" />
          ) : (
            <ArrowUpWideNarrow className="h-4 w-4 text-(--dc-accent)" />
          )}
          {direction === "desc" ? "Newest first" : "Oldest first"}
        </button>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium transition ${
            open || advancedCount > 0
              ? "border-(--dc-accent) bg-(--dc-accent) text-white"
              : "border-gray-300 text-gray-700 hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/50"
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          More filters
          {advancedCount > 0 && (
            <span className="rounded-full bg-white/25 px-1.5 text-xs tabular-nums">
              {advancedCount}
            </span>
          )}
        </button>

        {active.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"
          >
            <X className="h-3.5 w-3.5" /> Clear all
          </button>
        )}
      </div>

      {/* ----------------------------------------------------------- the panel */}
      {open && (
        <div className="grid grid-cols-1 gap-3 border-t border-gray-100 bg-(--dc-accent-soft)/25 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Partner">
            <select
              className={SELECT}
              value={draft.organizationId ?? ""}
              onChange={(e) => set("organizationId", e.target.value)}
            >
              <option value="">Any partner</option>
              {facets.partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? "unnamed"}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Sales rep on the transfer">
            <select
              className={SELECT}
              value={draft.transferSalesRep ?? ""}
              onChange={(e) => set("transferSalesRep", e.target.value)}
            >
              <option value="">Any rep</option>
              {facets.salesReps.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Buyer's state">
            <select
              className={SELECT}
              value={draft.userState ?? ""}
              onChange={(e) => setState(e.target.value)}
            >
              <option value="">Any state</option>
              {facets.states.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Buyer's LGA">
            <select
              className={SELECT}
              value={draft.userLga ?? ""}
              disabled={!draft.userState}
              onChange={(e) => set("userLga", e.target.value)}
            >
              {/* Disabled rather than hidden, so the reason it is unavailable
                  is on screen instead of being something to work out. */}
              <option value="">
                {draft.userState ? "Any LGA" : "Choose a state first"}
              </option>
              {lgas.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Sold by">
            <select
              className={SELECT}
              value={draft.saleAgent ?? ""}
              onChange={(e) => set("saleAgent", e.target.value)}
            >
              <option value="">Anybody</option>
              {facets.salesAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Sales model">
            <select
              className={SELECT}
              value={draft.salesModel ?? ""}
              onChange={(e) => set("salesModel", e.target.value)}
            >
              <option value="">Any model</option>
              {facets.salesModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Sale status">
            <select
              className={SELECT}
              value={draft.saleStatus ?? ""}
              onChange={(e) => set("saleStatus", e.target.value)}
            >
              <option value="">Any status</option>
              {SALE_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {words(v)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Payment">
            <select
              className={SELECT}
              value={draft.paymentStatus ?? ""}
              onChange={(e) => set("paymentStatus", e.target.value)}
            >
              <option value="">Any payment</option>
              {PAYMENT_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {words(v)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Came in through">
            <select
              className={SELECT}
              value={draft.platform ?? ""}
              onChange={(e) => set("platform", e.target.value)}
            >
              <option value="">Either app</option>
              {PLATFORMS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Sold on or after">
            <input
              type="date"
              className={SELECT}
              value={draft.dateFrom ?? ""}
              onChange={(e) => set("dateFrom", e.target.value)}
            />
          </Field>

          <Field label="Sold on or before">
            <input
              type="date"
              className={SELECT}
              value={draft.dateTo ?? ""}
              onChange={(e) => set("dateTo", e.target.value)}
            />
          </Field>

          <label className="flex items-end gap-2 pb-1.5 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={Boolean(draft.includeArchived)}
              onChange={(e) => set("includeArchived", e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 accent-(--dc-accent)"
            />
            {/* Archived sales are hidden by default everywhere in the app, so
                including them is a deliberate act rather than a default. */}
            Include archived sales
          </label>
        </div>
      )}

      {/* ---------------------------------------------------------- the chips */}
      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 px-4 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Filtered to
          </span>
          {active.map(([key, value]) => (
            <Chip
              key={key}
              onRemove={() => {
                const next = { ...draft };
                delete next[key];
                // Same reason as above: an LGA without its state is a filter
                // for a place that is no longer on offer.
                if (key === "userState") delete next.userLga;
                setDraft(next);
              }}
            >
              {(label[key] ?? ((v) => `${key}: ${v}`))(value)}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
