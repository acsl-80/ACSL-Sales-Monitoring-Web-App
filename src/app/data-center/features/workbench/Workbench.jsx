import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { dataCenterClient, dataCenterImport, DataCenterError } from "../../lib/client";
import { usePaged } from "../../lib/usePaged";
import Pagination from "../../components/Pagination";
import ExportButton from "../../components/ExportButton";
import SaleForm, { blankSale, saleProblems, withDefaults, TERMS } from "./SaleForm";
import BenchRail from "./BenchRail";
import { plural } from "../../lib/plural";
import {
  Loader2, ChevronRight, ArrowLeft, Search, Save, CheckCircle2,
  TriangleAlert, Clock, UserRound, Lightbulb, FileText,
} from "lucide-react";

/**
 * The bench: one stove at a time, with the paper in front of you.
 *
 * The bulk import is for a backlog somebody has already typed into a
 * spreadsheet. This is for the other half of the same job - working through a
 * partner's stoves as the receipts come in - and it exists because the
 * spreadsheet round trip is only worth it in bulk. For eleven receipts it is
 * three extra steps and a file to lose.
 *
 * Same machinery underneath. A row saved here is a row in an import batch, so
 * it is validated by the same code, released by the same confirmation, and
 * rolled back the same way. What differs is only the pace.
 *
 * Nothing here is lost by leaving. A draft saves on a timer and again on the
 * way out, because the person using this is holding a receipt and will be
 * interrupted.
 */

const dateOf = (v) => (v ? new Date(v).toLocaleDateString() : "-");
const whenOf = (v) => (v ? new Date(v).toLocaleString() : "never");

/* ------------------------------------------------------------- the navigator */

function PartnerList({ onPick }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [state, setState] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let live = true;
    dataCenterClient
      .getTransferFunnel({ limit: 500 })
      .then((page) => live && setRows(page.rows))
      .catch(
        (err) =>
          live &&
          setError(err instanceof DataCenterError ? err.message : "Could not load partners."),
      );
    return () => {
      live = false;
    };
  }, []);

  /**
   * Partners, not transfers.
   *
   * The funnel is one row per consignment and a partner has several, so they
   * are folded here. Issued against recorded is the only pair that matters at
   * this level: it is the answer to "is there anything left to type for these
   * people".
   */
  const partners = useMemo(() => {
    const by = new Map();
    for (const r of rows ?? []) {
      const entry = by.get(r.organization_id) ?? {
        organization_id: r.organization_id,
        partner_name: r.partner_name,
        state: r.transfer_state,
        issued: 0,
        digitalised: 0,
        batches: 0,
      };
      entry.issued += r.issued_count ?? 0;
      entry.digitalised += r.digitalised_count ?? 0;
      entry.batches += 1;
      by.set(r.organization_id, entry);
    }
    return [...by.values()].sort((a, b) => b.issued - b.digitalised - (a.issued - a.digitalised));
  }, [rows]);

  const states = useMemo(
    () => [...new Set(partners.map((p) => p.state).filter(Boolean))].sort(),
    [partners],
  );

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return partners.filter(
      (p) =>
        (!state || p.state === state) &&
        (!term || (p.partner_name ?? "").toLowerCase().includes(term)),
    );
  }, [partners, state, search]);

  const paged = usePaged(shown, 10);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (rows === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading partners...
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">
            State
          </span>
          <div className="w-full sm:w-48">
            <SearchableSelect
              ariaLabel="State"
              value={state}
              onChange={setState}
              placeholder="Everywhere"
              searchPlaceholder="Type part of a state"
              emptyLabel="No state matches that"
              pinned={{ value: "", label: "Everywhere" }}
              options={states.map((st) => ({ value: st, label: st }))}
            />
          </div>
        </label>
        <label className="block min-w-0 flex-1">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">
            Partner
          </span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name"
              className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-2.5 text-sm focus:border-(--dc-accent) focus:outline-none sm:max-w-sm"
            />
          </span>
        </label>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-(--dc-accent)/40 bg-(--dc-accent-soft)/20 px-4 py-8 text-center text-sm text-gray-600">
          No partners match that. Clear the state or the search to see them all.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="bg-(--dc-accent-soft) text-left text-xs uppercase tracking-wide text-(--dc-accent-strong)">
                  <th className="px-3 py-2 font-semibold">Partner</th>
                  <th className="px-3 py-2 font-semibold">State</th>
                  <th className="px-3 py-2 text-right font-semibold">Transferred</th>
                  <th className="px-3 py-2 text-right font-semibold">Recorded</th>
                  <th className="px-3 py-2 text-right font-semibold">Left to type</th>
                  <th className="w-8 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paged.slice.map((p) => {
                  const left = Math.max(0, p.issued - p.digitalised);
                  return (
                    <tr
                      key={p.organization_id}
                      onClick={() => onPick(p)}
                      className="cursor-pointer transition hover:bg-(--dc-accent-soft)/50"
                    >
                      <td className="px-3 py-2 font-medium text-(--dc-accent)">
                        {p.partner_name}
                      </td>
                      <td className="px-3 py-2 text-gray-700">{p.state ?? "-"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                        {p.issued}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-(--dc-accent)">
                        {p.digitalised}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          left > 0 ? "font-medium text-amber-700" : "text-gray-500"
                        }`}
                      >
                        {left}
                      </td>
                      <td className="px-3 py-2 text-gray-400">
                        <ChevronRight className="h-4 w-4" />
                      </td>
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
            noun="partner"
          />
        </div>
      )}
    </div>
  );
}

function BatchList({ partner, onPick, onSweep }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [way, setWay] = useState("consignment");

  useEffect(() => {
    let live = true;
    dataCenterClient
      .partnerDetail(partner.organization_id)
      .then((d) => live && setData(d))
      .catch(
        (err) =>
          live &&
          setError(err instanceof DataCenterError ? err.message : "Could not load batches."),
      );
    return () => {
      live = false;
    };
  }, [partner.organization_id]);

  const paged = usePaged(data?.batches ?? [], 10);

  /*
   * The months this partner actually has consignments in.
   *
   * Derived from the consignments already loaded rather than asked for
   * separately, and only months with stoves in them are offered: a list of
   * every month since the partner existed, most of them empty, is a longer way
   * of saying nothing happened.
   */
  const months = useMemo(() => {
    const by = new Map();
    for (const b of data?.batches ?? []) {
      const m = typeof b.sales_date === "string" ? b.sales_date.slice(0, 7) : null;
      if (!m || !/^\d{4}-\d{2}$/.test(m)) continue;
      const at = by.get(m) ?? { period: m, consignments: 0, issued: 0 };
      at.consignments += 1;
      at.issued += Number(b.issued_count ?? 0);
      by.set(m, at);
    }
    return [...by.values()].sort((a, z) => z.period.localeCompare(a.period));
  }, [data]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading consignments...
      </p>
    );
  }

  const ways = (
    /*
     * Three ways into the same partner's stoves.
     *
     * The consignment stays first and stays the default, because it is how the
     * paper actually arrives: a bundle of receipts for one delivery. The other
     * two exist for the times it does not. A receipt turns up whose batch
     * nobody recorded, or somebody wants to work a partner in date order, and
     * before this there was no way in at all for either.
     */
    <div className="mb-3 flex flex-wrap gap-1.5">
      {[
        { key: "consignment", label: "By consignment", n: data.batches?.length ?? 0 },
        { key: "month", label: "By month", n: months.length },
        { key: "all", label: "Everything this partner holds", n: null },
      ].map((w) => (
        <button
          key={w.key}
          type="button"
          aria-pressed={way === w.key}
          onClick={() => {
            if (w.key === "all") {
              onSweep({ kind: "all" });
              return;
            }
            setWay(w.key);
          }}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
            way === w.key
              ? "border-(--dc-accent) bg-(--dc-accent) text-white"
              : "border-gray-300 text-gray-700 hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/50"
          }`}
        >
          {w.label}
          {w.n !== null && ` (${w.n})`}
        </button>
      ))}
    </div>
  );

  if (way === "month") {
    return (
      <div>
        {ways}
        {months.length === 0 ? (
          <p className="text-sm text-gray-600">
            None of this partner&apos;s consignments carries a usable date, so there is no month
            to pick. Use a consignment or everything this partner holds.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {months.map((m) => (
              <li key={m.period}>
                <button
                  type="button"
                  onClick={() => onSweep({ kind: "month", period: m.period })}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left transition hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/40"
                >
                  <span className="block text-sm font-semibold text-gray-900">{m.period}</span>
                  <span className="block text-xs text-gray-600">
                    {plural(m.issued, "stove")} on {plural(m.consignments, "consignment")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div>
      {ways}
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="bg-(--dc-accent-soft) text-left text-xs uppercase tracking-wide text-(--dc-accent-strong)">
              <th className="px-3 py-2 font-semibold">Reference</th>
              <th className="px-3 py-2 font-semibold">Sales rep</th>
              <th className="px-3 py-2 font-semibold">Date</th>
              <th className="px-3 py-2 text-right font-semibold">Issued</th>
              <th className="px-3 py-2 text-right font-semibold">Recorded</th>
              <th className="w-8 px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paged.slice.map((b) => (
              <tr
                key={b.transfer_id}
                onClick={() => onPick(b)}
                className="cursor-pointer transition hover:bg-(--dc-accent-soft)/50"
              >
                <td className="px-3 py-2 font-medium text-(--dc-accent)">{b.transaction_id}</td>
                <td className="px-3 py-2 text-gray-700">{b.sales_rep ?? "-"}</td>
                <td className="px-3 py-2 text-gray-700">{dateOf(b.sales_date)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                  {b.issued_count}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-(--dc-accent)">
                  {b.digitalised_count}
                </td>
                <td className="px-3 py-2 text-gray-400">
                  <ChevronRight className="h-4 w-4" />
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
        noun="consignment"
      />
      </div>
    </div>
  );
}

const STOVE_COLUMNS = [
  { key: "stove_id", label: "Stove ID" },
  { key: "stock_status", label: "Stock status" },
  { key: "end_user_name", label: "Buyer" },
  { key: "phone", label: "Phone" },
  { key: "verification_outcome", label: "Verification" },
  { key: "agent_name", label: "Assigned to", get: (r) => r.agent_name ?? "unassigned" },
];

/*
 * The consignment's stoves are fetched by the shell, not here.
 *
 * They are needed in two places now - this table, and the rail that sits
 * beside the form - and fetching them in each meant a round trip every time
 * somebody opened a stove and another every time they came back. Once per
 * consignment is enough: nothing about which stoves are in it changes while
 * one is being typed, and the one thing that does change (a stove becoming
 * recorded) is applied locally on save.
 */
/**
 * The stove list, over a consignment or over a whole partner.
 *
 * `server` is what tells the two apart. Absent, the rows handed in are the
 * whole set - a consignment, forty of them - and filtering and paging happen
 * here, instantly, which is right.
 *
 * Present, the rows are ONE PAGE of a partner that may hold thousands, and
 * every number and every filter has to come from the server or it is a
 * statement about the page dressed up as a statement about the partner. That
 * was the actual defect: the bench loaded two hundred behind a "Load more",
 * showed "Still to type (37)" meaning 37 of those two hundred, and told a
 * typist a partner had 200 stoves when it had far more.
 */
function StoveList({ batch, stoves, error, onPick, label = "stoves", server = null }) {
  const [only, setOnly] = useState("todo");
  const filter = server ? server.filter : only;
  const setFilter = server ? server.onFilter : setOnly;

  const shown = useMemo(() => {
    const all = stoves ?? [];
    // `just_recorded` is the local mark set when a save returns, so a stove
    // typed in this sitting leaves the "still to type" list immediately
    // instead of on the next refetch.
    const done = (s) => Boolean(s.sale_id || s.just_recorded);
    // On the server path the rows already ARE the filtered set, bar the local
    // just-recorded mark, which the server cannot know about yet.
    if (server) return filter === "todo" ? all.filter((x) => !x.just_recorded) : all;
    if (only === "todo") return all.filter((s) => !done(s));
    if (only === "done") return all.filter(done);
    return all;
  }, [stoves, only, server, filter]);

  const paged = usePaged(shown, 25);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (stoves === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading stove IDs...
      </p>
    );
  }

  // Counted by whoever can count honestly. On the server path only the total
  // for the CURRENT filter is known, so the other two say nothing rather than
  // saying something about one page.
  const counts = server
    ? { todo: null, done: null, all: null, [server.filter]: server.total }
    : {
        todo: stoves.filter((s) => !(s.sale_id || s.just_recorded)).length,
        done: stoves.filter((s) => s.sale_id || s.just_recorded).length,
        all: stoves.length,
      };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {[
          { key: "todo", label: "Still to type" },
          { key: "done", label: "Already recorded" },
          { key: "all", label: "All" },
        ].map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              filter === f.key
                ? "border-(--dc-accent) bg-(--dc-accent) text-white"
                : "border-gray-300 text-gray-700 hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/50"
            }`}
          >
            {f.label}
            {counts[f.key] === null || counts[f.key] === undefined
              ? ""
              : ` (${counts[f.key]})`}
          </button>
        ))}
        <div className="ml-auto">
          <ExportButton
            columns={STOVE_COLUMNS}
            rows={() => shown}
            filename={`stoves-${batch?.transaction_id ?? label}.csv`}
            label="Export stoves"
            disabled={shown.length === 0}
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-(--dc-accent)/40 bg-(--dc-accent-soft)/20 px-4 py-8 text-center text-sm text-gray-600">
          {filter === "todo"
            ? server
              ? "Nothing left to type here. Every stove matching this has been recorded."
              : "Every stove in this consignment has been recorded. Nothing left to type here."
            : "Nothing to show under that filter."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="bg-(--dc-accent-soft) text-left text-xs uppercase tracking-wide text-(--dc-accent-strong)">
                  <th className="px-3 py-2 font-semibold">Stove ID</th>
                  {/*
                    Which consignment it came on, and when.

                    Inside a consignment you already know both, so they would
                    be the same value repeated down the page. Searching a whole
                    partner they are the only things that tell two similar
                    serials apart, and without them a search result was a
                    number you had to take on trust before committing to type a
                    receipt against it.
                  */}
                  {server && <th className="px-3 py-2 font-semibold">Consignment</th>}
                  {server && <th className="px-3 py-2 font-semibold">Dated</th>}
                  <th className="px-3 py-2 font-semibold">Stock</th>
                  <th className="px-3 py-2 font-semibold">Buyer</th>
                  <th className="w-8 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paged.slice.map((s) => (
                  <tr
                    key={s.stove_id}
                    onClick={() => onPick(s)}
                    className="cursor-pointer transition hover:bg-(--dc-accent-soft)/50"
                  >
                    <td className="px-3 py-2 font-mono text-xs font-medium text-(--dc-accent)">
                      {s.stove_id}
                    </td>
                    {server && (
                      <td className="px-3 py-2 font-mono text-xs text-gray-700">
                        {s.transaction_id ?? "-"}
                      </td>
                    )}
                    {server && (
                      <td className="px-3 py-2 text-gray-700">
                        {s.consignment_sales_date ?? "-"}
                      </td>
                    )}
                    <td className="px-3 py-2 text-gray-700">{s.stock_status ?? "-"}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {s.end_user_name ?? (
                        <span className="text-gray-400">not typed yet</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-400">
                      <ChevronRight className="h-4 w-4" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={server ? server.page : paged.page}
            pageSize={server ? server.pageSize : paged.pageSize}
            total={server ? server.total : paged.total}
            onPage={server ? server.onPage : paged.setPage}
            onPageSize={server ? server.onPageSize : paged.setPageSize}
            noun="stove"
          />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- the bench */
/**
 * The form, as the agreement generator expects a sale to look.
 *
 * The generator reads a database row - snake_case, one `end_user_name` - and
 * the form holds camelCase with the name in two boxes. Rather than teach the
 * generator a second shape, the record is translated here: it is the sales
 * app's document and it should keep reading the sales app's rows.
 */
function asSaleRecord(values, stove) {
  const full = [values.endUserName, values.endUserSurname]
    .map((x) => (x || "").trim())
    .filter(Boolean)
    .join(" ");
  return {
    transaction_id: values.transactionId || stove?.transactionId || "",
    stove_serial_no: values.stoveSerialNo || stove?.stoveId || "",
    sales_date: values.salesDate,
    end_user_name: full,
    aka: values.aka,
    phone: values.phone,
    other_phone: values.otherPhone,
    contact_person: values.contactPerson,
    contact_phone: values.contactPhone,
    partner_name: values.partnerName || stove?.partnerName || "",
    retailer_branch: values.retailerBranch,
    amount: values.amount === "" ? null : Number(values.amount),
    state_backup: values.stateBackup,
    lga_backup: values.lgaBackup,
    address: values.addressData,
    pot_quantity: values.potQuantity,
    heat_retention_device: values.heatRetentionDevice,
    previous_stove_type: values.previousStoveType,
    previous_stove_other: values.previousStoveOther,
    meals_per_day: values.mealsPerDay,
    cooking_fuel_source: values.cookingFuelSource,
    cooking_location: values.cookingLocation,
    terms_accepted: values.termsAccepted,
    signature: values.signature,
    is_installment: values.isInstallment ?? false,
  };
}


function Bench({ stoveId, onSaved, onBack, onNext, nextLabel }) {
  const [state, setState] = useState(null);
  const [values, setValues] = useState({});
  const [error, setError] = useState(null);
  const [hint, setHint] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [showMissing, setShowMissing] = useState(false);

  // What was last written, so the timer does not save an unchanged form and
  // the "unsaved" mark tells the truth.
  const lastSaved = useRef("");
  const valuesRef = useRef(values);
  valuesRef.current = values;
  /*
   * The current save and the current problem count, held in refs.
   *
   * The keyboard handler is bound once per stove; reading these through state
   * would capture the values as they were when it was bound, so Ctrl+Enter
   * would save the form as it looked several keystrokes ago.
   */
  const saveRef = useRef(null);
  const finishRef = useRef(null);
  const problemsRef = useRef({ count: 0, termsMissing: false });

  useEffect(() => {
    let live = true;
    dataCenterImport
      .workbenchOpen(stoveId)
      .then((d) => {
        if (!live) return;
        setState(d);
        /**
         * Start from what is already known rather than from nothing.
         *
         * The stove names its own partner and the transfer it went out on, and
         * both are printed on the agreement. Making somebody retype them is
         * asking for a typo in a field the system could have filled in.
         */
        const start = {
          ...blankSale(),
          ...(d.work?.draft_values ?? d.work?.normalized ?? {}),
          stoveSerialNo: d.stove.stoveId,
          partnerName: d.work?.draft_values?.partnerName ?? d.stove.partnerName ?? "",
        };
        setValues(start);
        lastSaved.current = JSON.stringify(start);
        setError(null);
      })
      .catch((err) =>
        live && setError(err instanceof DataCenterError ? err.message : "Could not open that stove."),
      );
    return () => {
      live = false;
    };
  }, [stoveId]);

  /**
   * Everything a finished record has to pass before it is called finished.
   *
   * Lifted out of the button so the keyboard shortcut and "save and next" run
   * exactly the same checks. Two copies of this is how one route ends up
   * accepting a record the other refuses, which is the module's own rule.
   */
  const finish = useCallback(
    async (thenNext) => {
      setShowMissing(true);
      if (problemsRef.current.count > 0 || problemsRef.current.termsMissing) {
        setError(
          problemsRef.current.count > 0
            ? `${plural(problemsRef.current.count, "field")} still to sort out.`
            : "The six terms all have to be ticked.",
        );
        setHint(
          "What is wrong is written under each one. Save draft instead if you " +
            "want to come back to it: nothing typed is lost either way.",
        );
        return false;
      }
      const ok = await saveRef.current(true);
      if (ok && thenNext) onNext?.();
      return ok;
    },
    [onNext],
  );

  const save = useCallback(
    async (complete) => {
      setSaving(true);
      setError(null);
      setHint(null);
      try {
        /*
         * The contact defaults are applied before saving, so what is stored is
         * what the validator judged rather than a shape only the screen had.
         *
         * And they are put back on the form, which is the part that was
         * missing. `lastSaved` is what the autosave compares the live form
         * against; it used to be set from the DEFAULTED body while the form
         * still held the blanks the defaults filled. The two could then never
         * match again, so the form read as dirty forever and the twenty-second
         * timer - and the unmount handler - fired `save(false)` seconds after
         * a finish, writing the row back to `status='draft'` with its finished
         * shape nulled.
         *
         * That is not a cosmetic bug: a receipt typed and finished at the
         * bench sat in "still being typed" and could not be confirmed at all,
         * and production carried two of them. Both had `normalized` NULL,
         * which is the fingerprint of a draft save landing on top of a finish.
         *
         * So the screen, the saved body and the dirty check now agree on one
         * value rather than three.
         */
        const body = complete ? withDefaults(valuesRef.current) : valuesRef.current;
        const out = await dataCenterImport.workbenchSave(stoveId, body, complete);
        if (complete) {
          valuesRef.current = body;
          setValues(body);
        }
        lastSaved.current = JSON.stringify(body);
        setSavedAt(new Date().toISOString());
        if (complete) onSaved?.(out);
        return true;
      } catch (err) {
        if (err instanceof DataCenterError) {
          setError(err.message);
          setHint(err.data?.hint ?? null);
        } else {
          setError("That did not save.");
        }
        return false;
      } finally {
        setSaving(false);
      }
    },
    [stoveId, onSaved],
  );

  /**
   * The two shortcuts a typist actually uses.
   *
   * Somebody entering forty receipts has one hand on the keyboard and one on
   * the paper. Reaching for the mouse to press a button at the bottom of a
   * long form, forty times, is the difference between a morning and an
   * afternoon.
   *
   *   Ctrl/Cmd + S       save a draft, stay here
   *   Ctrl/Cmd + Enter   save as finished and open the next one
   *
   * Bound to the window rather than the form, because the shortcut has to work
   * wherever the cursor is - including the last field they typed into.
   */
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        saveRef.current?.(false);
      } else if (key === "enter") {
        e.preventDefault();
        finishRef.current?.(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * Save on a timer, and again on the way out.
   *
   * The person using this is holding a receipt and will be interrupted: by the
   * phone, by somebody at the desk, by the browser. Work lost that way is
   * never reported as a bug, it is reported as "this thing is annoying" and
   * then as people keeping their own spreadsheet again.
   */
  useEffect(() => {
    if (!state) return undefined;
    const timer = setInterval(() => {
      if (JSON.stringify(valuesRef.current) !== lastSaved.current) save(false);
    }, 20_000);
    return () => {
      clearInterval(timer);
      if (JSON.stringify(valuesRef.current) !== lastSaved.current) save(false);
    };
  }, [state, save]);

  const setField = (key, value) => setValues((v) => ({ ...v, [key]: value }));

  if (error && !state) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        <p className="flex items-start gap-2 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          {error}
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" /> Back to the stove list
        </button>
      </div>
    );
  }
  if (!state) {
    return (
      <p className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Opening {stoveId}...
      </p>
    );
  }

  const { stove, work } = state;
  // The sales app's own rules, so a record accepted here is accepted there.
  const problems = saleProblems(values);
  const problemCount = Object.keys(problems).length;
  const termsMissing = !TERMS.every((t) => values.termsAccepted?.[t.key] === true);
  // Kept current every render, because the keyboard handler below is bound
  // once per stove and would otherwise judge a form several keystrokes stale.
  problemsRef.current = { count: problemCount, termsMissing };
  saveRef.current = save;
  finishRef.current = finish;
  const dirty = JSON.stringify(values) !== lastSaved.current;
  const locked = Boolean(work?.confirmed_at);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-(--dc-accent)/20 bg-(--dc-accent-soft)/30 p-3 sm:grid-cols-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-600">Stove ID</p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-gray-900">{stove.stoveId}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-600">Partner</p>
          <p className="mt-0.5 text-sm text-gray-900">{stove.partnerName ?? "-"}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-600">Transfer</p>
          <p className="mt-0.5 text-sm text-gray-900">{stove.transactionId ?? "-"}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-600">Stock</p>
          <p className="mt-0.5 text-sm text-gray-900">{stove.stockStatus ?? "-"}</p>
        </div>
      </div>

      {/* Somebody else's work, said before the typist starts rather than after
          they have retyped it. There is no lock: a lock on a row somebody may
          walk away from needs a timeout, and a timeout is a second way to lose
          work. */}
      {work?.last_edited_by_name && (
        <p className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
          Last worked on by {work.last_edited_by_name}, {whenOf(work.last_edited_at)}.
          {work.status === "draft" ? " It is still a draft." : ""}
        </p>
      )}

      {locked && (
        <p className="flex items-start gap-2 rounded-lg border border-(--dc-accent)/30 bg-(--dc-accent-soft)/40 p-3 text-sm text-gray-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-(--dc-accent)" />
          This one has been confirmed and is in the sales app. Change it there
          instead, so there is one version of it.
        </p>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="flex items-start gap-2 text-sm text-red-800">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            {error}
          </p>
          {hint && (
            <p className="mt-1.5 flex items-start gap-2 pl-6 text-sm text-gray-700">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              {hint}
            </p>
          )}
        </div>
      )}

      <SaleForm
        values={values}
        onChange={setField}
        disabled={locked || saving}
        errors={showMissing ? problems : {}}
      />

      <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          <ArrowLeft className="h-4 w-4" /> Stove list
        </button>

        <span className="text-xs text-gray-600">
          {saving ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> saving
            </span>
          ) : dirty ? (
            <span className="inline-flex items-center gap-1 text-amber-700">
              <Clock className="h-3 w-3" /> not saved yet
            </span>
          ) : savedAt ? (
            `saved ${new Date(savedAt).toLocaleTimeString()}`
          ) : (
            ""
          )}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* The same replica the sales app prints, built from what is on
              screen. Seeing it before saving is how a typist notices they have
              put the surname in the first-name box. */}
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              try {
                const { buildAgreementBlobUrl } = await import(
                  "@/app/admin/components/sales/agreement/AgreementPDFGenerator"
                );
                const url = await buildAgreementBlobUrl(asSaleRecord(values, stove));
                window.open(url, "_blank", "noopener");
              } catch {
                setError("The agreement preview could not be built from this record yet.");
                setHint("It needs at least a name, a date and the stove ID.");
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-40"
          >
            <FileText className="h-4 w-4" /> View agreement
          </button>
          <button
            type="button"
            disabled={locked || saving}
            onClick={() => save(false)}
            className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent)/30 px-3 py-1.5 text-sm font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60 disabled:opacity-40"
          >
            <Save className="h-4 w-4" /> Save draft
          </button>
          <button
            type="button"
            disabled={locked || saving}
            onClick={() => finish(false)}
            title="Ctrl+S saves a draft without leaving"
            className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent) px-3 py-1.5 text-sm font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60 disabled:opacity-40"
          >
            <CheckCircle2 className="h-4 w-4" /> Save as finished
          </button>
          {/*
            The one that makes the run fast.

            The job is the same eleven fields forty times over, and the thing
            between two records used to be: back to the consignment, find your
            place in a paginated table, click, wait. This is that whole
            sequence as one button, and Ctrl+Enter as no button at all.
          */}
          {onNext && (
            <button
              type="button"
              disabled={locked || saving}
              onClick={() => finish(true)}
              title="Ctrl+Enter"
              className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-4 py-1.5 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-40"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {nextLabel ?? "Save and next"}
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-600">
        Finished records wait for somebody to confirm them before they reach the
        sales app. Nothing typed here is lost by leaving: a draft saves every
        twenty seconds and again on the way out.{" "}
        <span className="whitespace-nowrap font-medium text-gray-700">
          Ctrl+S saves a draft, Ctrl+Enter finishes and opens the next.
        </span>
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------- the shell */

/**
 * A partner's stoves, by month or all of them.
 *
 * The consignment view can filter in the browser because it holds every stove
 * it will ever show. This one holds a page, so its search goes to the server
 * and its list grows on request. Two consequences worth stating on screen: the
 * count is what is loaded rather than what exists, and a search covers the
 * whole partner rather than the page.
 */
function PartnerSweep({ partner, label, stoves, error, search, onSearch, server, onPick }) {
  const [term, setTerm] = useState(search ?? "");

  // Debounced for the same reason the rail is: each keystroke is a round trip
  // now, and a six-character serial should be one request rather than six.
  useEffect(() => {
    const id = setTimeout(() => onSearch(term.trim()), 250);
    return () => clearTimeout(id);
  }, [term, onSearch]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Find a stove ID anywhere in this partner"
            aria-label="Find a stove ID"
            className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-2 text-sm"
          />
        </div>
        <p className="text-xs text-gray-600">
          {partner?.partner_name}
          {label ? ` · ${label}` : ""}
        </p>
      </div>

      {/*
        The number is now the number that exists, so it can be said plainly.
        It used to read "200 stoves loaded", which is a count of what had been
        fetched wearing the clothes of a count of what is there - and how
        somebody concluded a partner held 200 stoves when it held thousands.
      */}
      {stoves !== null && (
        <p className="text-xs text-gray-600">
          {plural(server.total, "stove")}
          {search ? ` matching "${search}"` : ""}
          {server.filter === "todo"
            ? " still to type"
            : server.filter === "done"
            ? " already recorded"
            : ""}
          . The search covers every stove this partner holds, not only the ones on this page.
        </p>
      )}

      <StoveList
        stoves={stoves}
        error={error}
        onPick={onPick}
        server={server}
        label={`${partner?.partner_id ?? "partner"}-${label ?? "all"}`}
      />
    </div>
  );
}

export default function Workbench() {
  const [partner, setPartner] = useState(null);
  const [batch, setBatch] = useState(null);
  /**
   * A way in that is not a consignment: a month, or the whole partner.
   *
   * Held beside `batch` rather than replacing it, so the consignment path -
   * the default, and the one people use every day - keeps running exactly the
   * code it ran before. Only one of the two is ever set.
   */
  const [sweep, setSweep] = useState(null);
  const [sweepSearch, setSweepSearch] = useState("");
  /*
   * Paged, not accumulated.
   *
   * `partner_stoves` is keyset paginated - each page hands back the cursor for
   * the next - so going FORWARD is free and going BACK needs the cursor that
   * opened each page remembered. `sweepCursors[n]` is the cursor that opens
   * page n, and page 0 opens with none. That is the whole of the stack, and it
   * is what lets the module's ordinary Pagination control sit over a keyset
   * source without knowing it is one.
   *
   * This replaced a "Load more" that appended two hundred rows at a time into
   * one ever-growing list, which is the reason every count on the screen was a
   * count of what had been fetched rather than of what exists.
   */
  const [sweepPage, setSweepPage] = useState(0);
  const [sweepSize, setSweepSize] = useState(25);
  const [sweepCursors, setSweepCursors] = useState([null]);
  const [sweepTotal, setSweepTotal] = useState(0);
  const [sweepFilter, setSweepFilter] = useState("todo");
  const [stove, setStove] = useState(null);
  const [queue, setQueue] = useState(null);
  const [stoves, setStoves] = useState(null);
  const [stovesError, setStovesError] = useState(null);

  const loadQueue = useCallback(() => {
    dataCenterImport
      .workbenchQueue()
      .then(setQueue)
      .catch(() => setQueue(null));
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  /*
   * The consignment's stoves, fetched once when it is opened.
   *
   * They feed both the table and the rail beside the form, and neither should
   * cost a round trip. Nothing about which stoves are in a consignment changes
   * while one of them is being typed; the one thing that does - a stove
   * becoming recorded - is applied locally by `markRecorded` below, so the
   * rail turns green the moment the save returns rather than on a refetch.
   */
  useEffect(() => {
    if (!batch) return undefined;
    let live = true;
    setStoves(null);
    setStovesError(null);
    dataCenterClient
      .batchStoves(batch.transfer_id)
      .then((r) => live && setStoves(r.stoves))
      .catch(
        (err) =>
          live &&
          setStovesError(
            err instanceof DataCenterError ? err.message : "Could not load stoves.",
          ),
      );
    return () => {
      live = false;
    };
  }, [batch]);

  /*
   * The same list, for a month or for the whole partner.
   *
   * A page at a time, and the search runs on the server. Both matter for the
   * same reason: a partner can hold thousands of stoves, and a filter that
   * only ever saw the loaded page would answer "not found" for a stove that is
   * there. That is the one answer a typist holding its receipt must not get.
   */
  const orgId = partner?.organization_id ?? null;
  useEffect(() => {
    if (batch || !sweep || !orgId) {
      if (!batch && !sweep) {
        setStoves(null);
        setStovesError(null);
      }
      return undefined;
    }
    let live = true;
    setStoves(null);
    setStovesError(null);
    dataCenterClient
      .partnerStoves({
        organizationId: orgId,
        period: sweep.kind === "month" ? sweep.period : null,
        search: sweepSearch || null,
        recorded: sweepFilter === "todo" ? "no" : sweepFilter === "done" ? "yes" : null,
        cursor: sweepCursors[sweepPage] ?? null,
        limit: sweepSize,
      })
      .then((r) => {
        if (!live) return;
        setStoves(r.stoves);
        setSweepTotal(r.total ?? r.stoves.length);
        // Remember the cursor that opens the NEXT page, so paging forward is
        // one step and paging back is a lookup rather than a refetch from the
        // top.
        if (r.nextCursor) {
          setSweepCursors((c) => {
            if (c[sweepPage + 1] === r.nextCursor) return c;
            const next = c.slice(0, sweepPage + 1);
            next[sweepPage + 1] = r.nextCursor;
            return next;
          });
        }
      })
      .catch(
        (err) =>
          live &&
          setStovesError(
            err instanceof DataCenterError ? err.message : "Could not load stoves.",
          ),
      );
    return () => {
      live = false;
    };
  }, [batch, sweep, sweepSearch, sweepFilter, sweepPage, sweepSize, sweepCursors, orgId]);

  /*
   * Anything that changes WHAT is being paged sends you back to page one and
   * throws the cursor stack away. A cursor is a position in one particular
   * ordered set; kept across a change of search or filter it points into a set
   * that no longer exists, and the page it opens is somebody else's.
   */
  const restart = useCallback(() => {
    setSweepPage(0);
    setSweepCursors([null]);
  }, []);
  const changeSearch = useCallback((term) => {
    setSweepSearch((prev) => {
      if (prev !== term) {
        setSweepPage(0);
        setSweepCursors([null]);
      }
      return term;
    });
  }, []);

  /** What this way in is called, wherever it needs naming. */
  const sweepLabel = sweep
    ? sweep.kind === "month"
      ? sweep.period
      : "Everything"
    : null;

  /** Which stove IDs somebody has part-typed, for the rail's amber marks. */
  const draftSerials = useMemo(
    () =>
      [...(queue?.mine ?? []), ...(queue?.abandoned ?? [])]
        .filter((r) => r.status === "draft")
        .map((r) => r.stove_serial_no),
    [queue],
  );

  /*
   * Turn one stove green without refetching the consignment.
   *
   * Its own flag rather than writing a made-up value into `sale_id`: that
   * column holds a real id everywhere else, and a placeholder sitting in it is
   * the kind of thing that is harmless until something starts reading it.
   */
  const markRecorded = useCallback((stoveId) => {
    setStoves((list) =>
      list
        ? list.map((s) => (s.stove_id === stoveId ? { ...s, just_recorded: true } : s))
        : list,
    );
  }, []);

  /**
   * The next stove worth opening, from where you are.
   *
   * Forward through the consignment first, then round to the top - because a
   * typist who started in the middle of the stack still wants the ones above
   * them, and stopping at the end would leave the run looking finished when it
   * is not. Returns null only when there is genuinely nothing left to type.
   */
  const nextTodo = useCallback(
    (fromId) => {
      const list = stoves ?? [];
      const drafts = new Set(draftSerials.map((d) => String(d).toUpperCase()));
      const todo = (s) =>
        !(s.sale_id || s.just_recorded) || drafts.has(String(s.stove_id).toUpperCase());
      const at = list.findIndex((s) => s.stove_id === fromId);
      for (let i = 1; i <= list.length; i++) {
        const candidate = list[(at + i + list.length) % list.length];
        if (candidate && candidate.stove_id !== fromId && todo(candidate)) return candidate;
      }
      return null;
    },
    [stoves, draftSerials],
  );

  const remaining = useMemo(() => {
    const drafts = new Set(draftSerials.map((d) => String(d).toUpperCase()));
    return (stoves ?? []).filter(
      (s) =>
        !(s.sale_id || s.just_recorded) || drafts.has(String(s.stove_id).toUpperCase()),
    ).length;
  }, [stoves, draftSerials]);

  const trail = [
    {
      label: "Partners",
      on: () => { setPartner(null); setBatch(null); setSweep(null); setStove(null); },
    },
    partner && {
      label: partner.partner_name,
      on: () => { setBatch(null); setSweep(null); setStove(null); },
    },
    batch && { label: batch.transaction_id, on: () => setStove(null) },
    sweep && { label: sweepLabel, on: () => setStove(null) },
    stove && { label: stove.stove_id, on: null },
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      {/* What this person left half-typed, offered before anything else. It is
          the reason most people open this page twice. */}
      {queue?.mine?.length > 0 && !stove && (
        <div className="rounded-lg border border-(--dc-accent)/25 bg-(--dc-accent-soft)/30 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
            On your bench
          </p>
          <div className="flex flex-wrap gap-1.5">
            {queue.mine.slice(0, 12).map((r) => (
              <button
                key={r.stove_serial_no}
                type="button"
                onClick={() => setStove({ stove_id: r.stove_serial_no })}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-800 transition hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/50"
              >
                <span className="font-mono">{r.stove_serial_no}</span>
                <span className="ml-1.5 text-gray-600">
                  {r.status === "draft" ? "draft" : "finished"}
                </span>
              </button>
            ))}
          </div>
          {queue.mine.length > 12 && (
            <p className="mt-1.5 text-xs text-gray-600">
              and {plural(queue.mine.length - 12, "more")}.
            </p>
          )}
        </div>
      )}

      {queue?.abandoned?.length > 0 && !stove && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          {plural(queue.abandoned.length, "draft")} nobody has touched for over{" "}
          {plural(queue.staleDays, "day")}, left by{" "}
          {[...new Set(queue.abandoned.map((a) => a.last_edited_by_name).filter(Boolean))].join(", ") ||
            "somebody"}
          . Open one to pick it up.
        </p>
      )}

      <nav className="flex flex-wrap items-center gap-1 text-xs text-gray-600">
        {trail.map((t, i) => (
          <span key={t.label} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 text-gray-400" />}
            {t.on ? (
              <button
                type="button"
                onClick={t.on}
                className="rounded px-1.5 py-0.5 font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)"
              >
                {t.label}
              </button>
            ) : (
              <span className="px-1.5 py-0.5 font-medium text-gray-700">{t.label}</span>
            )}
          </span>
        ))}
      </nav>

      {stove ? (
        /*
         * The consignment beside the form, not behind it.
         *
         * Only when a consignment is open: arriving straight from "on your
         * bench" there is no consignment to show, and inventing one by looking
         * it up would be a round trip to draw a sidebar nobody asked for.
         */
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          {(batch || sweep) && stoves && (
            <BenchRail
              stoves={stoves}
              current={stove.stove_id}
              drafts={draftSerials}
              onPick={(s) => setStove(s)}
              title={batch ? "This consignment" : `${partner?.partner_name ?? "Partner"}: ${sweepLabel}`}
              // Only a sweep searches the server. A consignment is fully
              // loaded, so its filter is instant and stays where it was.
              onSearch={sweep ? changeSearch : null}
              footer={
                /*
                 * Where you are in the partner, not how much has been fetched.
                 *
                 * This was a "Load more" that grew the rail without bound. A
                 * typist searching a serial wants to know the rail is showing
                 * the whole partner, which is what the count says now.
                 */
                sweep ? (
                  <p className="text-center text-xs text-gray-600">
                    {sweepSearch
                      ? `${plural(sweepTotal, "match", "matches")} across the whole partner`
                      : `Page ${sweepPage + 1} of ${Math.max(1, Math.ceil(sweepTotal / sweepSize))}, ${plural(sweepTotal, "stove")} in all`}
                  </p>
                ) : null
              }
            />
          )}
          <div className="min-w-0 flex-1">
            <Bench
              // Keyed by stove so switching gets a clean form rather than the
              // previous receipt's values bleeding into the next one.
              key={stove.stove_id}
              stoveId={stove.stove_id}
              onSaved={(out) => {
                markRecorded(stove.stove_id);
                loadQueue();
                return out;
              }}
              onBack={() => { setStove(null); loadQueue(); }}
              onNext={batch || sweep ? () => {
                const next = nextTodo(stove.stove_id);
                if (next) setStove(next);
                // Nothing left is worth saying rather than silently doing
                // nothing, so the run ends where it started.
                else { setStove(null); loadQueue(); }
              } : null}
              nextLabel={
                remaining > 1 ? `Save and next (${remaining - 1} left)` : "Save and finish the run"
              }
            />
          </div>
        </div>
      ) : batch ? (
        <StoveList batch={batch} stoves={stoves} error={stovesError} onPick={setStove} />
      ) : sweep ? (
        <PartnerSweep
          partner={partner}
          label={sweepLabel}
          stoves={stoves}
          error={stovesError}
          search={sweepSearch}
          onSearch={changeSearch}
          server={{
            page: sweepPage,
            pageSize: sweepSize,
            total: sweepTotal,
            filter: sweepFilter,
            onPage: setSweepPage,
            onPageSize: (n) => {
              setSweepSize(n);
              restart();
            },
            onFilter: (f) => {
              setSweepFilter(f);
              restart();
            },
          }}
          onPick={setStove}
        />
      ) : partner ? (
        <BatchList partner={partner} onPick={setBatch} onSweep={setSweep} />
      ) : (
        <PartnerList onPick={setPartner} />
      )}
    </div>
  );
}
