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
  TriangleAlert, Clock, UserRound, Lightbulb, FileText, WifiOff,
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

const whenOf = (v) => (v ? new Date(v).toLocaleString() : "never");

/** "2026-05" the way a person says it: "May 2026". */
const monthName = (period) => {
  const [y, m] = String(period ?? "").split("-").map(Number);
  if (!y || !m) return String(period ?? "");
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-NG", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};

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

const STOVE_COLUMNS = [
  { key: "stove_id", label: "Stove ID" },
  { key: "stock_status", label: "Stock status" },
  { key: "end_user_name", label: "Buyer" },
  { key: "phone", label: "Phone" },
  { key: "verification_outcome", label: "Verification" },
  { key: "agent_name", label: "Assigned to", get: (r) => r.agent_name ?? "unassigned" },
];

/*
 * The stoves are fetched by the shell, not here.
 *
 * They are needed in two places - this table, and the rail that sits beside
 * the form - and fetching them in each meant a round trip every time somebody
 * opened a stove and another every time they came back.
 */
/**
 * The stove list, over a set that is all here or over one page of a partner.
 *
 * `server` is what tells the two apart. Absent, the rows handed in are the
 * whole set and filtering and paging happen here, instantly, which is right.
 *
 * Present, the rows are ONE PAGE of a partner that may hold thousands, and
 * every number and every filter has to come from the server or it is a
 * statement about the page dressed up as a statement about the partner. That
 * was the actual defect: the bench loaded two hundred behind a "Load more",
 * showed "Still to type (37)" meaning 37 of those two hundred, and told a
 * typist a partner had 200 stoves when it had far more.
 */
function StoveList({ stoves, error, onPick, label = "stoves", server = null }) {
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
  /*
   * On the server path the rows arrived already sliced to one page, so putting
   * them through `usePaged` sliced them AGAIN: ask for 50 per page and the
   * screen drew 25, because the local pager was still cutting at its own
   * default. The hook stays called - hooks may not be conditional - but its
   * slice is only used when the rows really are the whole set.
   */
  const visible = server ? shown : paged.slice;

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (stoves === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading stove IDs...
      </p>
    );
  }

  // Counted by whoever can count honestly. The server now sends all three
  // totals from one scan, so every chip carries a real number whichever filter
  // is selected - "done" used to be pinned at nothing while todo was shown.
  const counts = server
    ? server.totals ?? { todo: null, done: null, all: null, [server.filter]: server.total }
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
            filename={`stoves-${label}.csv`}
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
                {visible.map((s) => (
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


function Bench({ stoveId, onSaved, onBack, onNext, nextLabel, api = null }) {
  const [state, setState] = useState(null);
  const [values, setValues] = useState({});
  const [error, setError] = useState(null);
  const [hint, setHint] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [showMissing, setShowMissing] = useState(false);
  /**
   * How many draft saves in a row have failed, and whether the network is
   * gone. Between them they decide what the status pill says, because the two
   * failures a typist meets are different: a server refusing is "retrying",
   * a cable pulled is "offline", and both used to be dressed as ordinary
   * not-saved-yet.
   */
  const [failCount, setFailCount] = useState(0);
  const [offline, setOffline] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false,
  );

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
  /*
   * The failure count as the retry logic sees it, and the pending retry
   * timer. Refs, because the count is read and bumped inside an async catch:
   * routed through a state updater the bump would be a side effect that
   * StrictMode runs twice, and read from state it would be a render old.
   */
  const failCountRef = useRef(0);
  const retryTimer = useRef(null);
  /** The bench's own root, so hidden-tab keyboard events can be refused. */
  const rootRef = useRef(null);

  /**
   * Try the failed draft again in 10s, then 20s, then every 40s.
   *
   * One silent error was the whole story before: the autosave failed once,
   * showed nothing a typist would read as failure, and never tried again. The
   * backoff keeps retrying without hammering a struggling server, and a save
   * that succeeds anywhere in between resets the ladder.
   */
  const scheduleRetry = useCallback((count) => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    const delay = Math.min(40_000, 10_000 * 2 ** (count - 1));
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      if (JSON.stringify(valuesRef.current) !== lastSaved.current) saveRef.current?.(false);
    }, delay);
  }, []);

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
        // A draft that exists on the server IS saved, and the pill should say
        // so with the draft's own time rather than opening on "not saved yet".
        setSavedAt(d.work?.last_edited_at ?? null);
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
        // Any save landing proves the path works again: the retry ladder
        // resets and the pill goes back to Saved.
        failCountRef.current = 0;
        setFailCount(0);
        setOffline(false);
        if (retryTimer.current) {
          clearTimeout(retryTimer.current);
          retryTimer.current = null;
        }
        if (complete) {
          onSaved?.(out);
          // The confirmation queue may be mounted behind another tab. Told
          // directly, it refreshes without waiting to be focused.
          window.dispatchEvent(new Event("data-center:bench-finished"));
        }
        return true;
      } catch (err) {
        // A dead network and a refusing server are different failures and the
        // pill must not merge them. navigator.onLine catches the pulled
        // cable; a status-0 DataCenterError catches the fetch that died
        // before any response existed.
        if (
          (typeof navigator !== "undefined" && navigator.onLine === false) ||
          (err instanceof DataCenterError && (err.code === "network" || err.status === 0))
        ) {
          setOffline(true);
        }
        if (complete) {
          // A finish is an act the typist is watching: the reason and the
          // hint go in the error box, and nothing retries a judgement call.
          if (err instanceof DataCenterError) {
            setError(err.message);
            setHint(err.data?.hint ?? null);
          } else {
            setError("That did not save.");
          }
        } else {
          // A draft save retries itself; the pill carries the state. An
          // error box for every failed background save would shout at a
          // typist forty times a morning about something being handled.
          const next = failCountRef.current + 1;
          failCountRef.current = next;
          setFailCount(next);
          scheduleRetry(next);
        }
        return false;
      } finally {
        setSaving(false);
      }
    },
    [stoveId, onSaved, scheduleRetry],
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
      // The bench stays mounted, hidden, while another import tab is open -
      // that is what lets its state survive the switch - so the shortcuts
      // have to check they are the screen being looked at before acting.
      if (rootRef.current && rootRef.current.offsetParent === null) return;
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
   * The network going and coming back, watched directly.
   *
   * A pulled cable fails the NEXT save; this flips the pill the moment it
   * happens. And the `online` event saves immediately rather than leaving the
   * recovered work to wait out the remainder of a backoff.
   */
  useEffect(() => {
    const goOffline = () => setOffline(true);
    const backOnline = () => {
      setOffline(false);
      if (JSON.stringify(valuesRef.current) !== lastSaved.current) saveRef.current?.(false);
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", backOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", backOnline);
    };
  }, []);

  /**
   * The page closing with typed work unsaved.
   *
   * Two things at once: the browser is asked to warn - the one dialog it
   * still allows - and the draft is fired with `keepalive` so the write can
   * land after the tab is gone. Neither alone is enough: the warning without
   * the save protects nothing if the typist closes anyway, and the save
   * without the warning is a race the browser usually wins.
   */
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (JSON.stringify(valuesRef.current) === lastSaved.current) return;
      dataCenterImport
        .workbenchSave(stoveId, valuesRef.current, false, { keepalive: true })
        .catch(() => {});
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [stoveId]);

  // A retry armed when the bench closes would save a stove nobody has open.
  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  /**
   * The shell's handle on this form: "get the draft to the server, then tell
   * me". Awaited before a stove swap, so switching is no longer fire-and-
   * forget - the one way an in-app move could still lose typed work.
   * Everything is read through refs, so the handle set at mount never goes
   * stale.
   */
  useEffect(() => {
    if (!api) return undefined;
    api.current = {
      flush: () =>
        JSON.stringify(valuesRef.current) !== lastSaved.current
          ? saveRef.current?.(false) ?? Promise.resolve(true)
          : Promise.resolve(true),
    };
    return () => {
      api.current = null;
    };
  }, [api]);

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
      // While saves are failing the backoff owns the cadence; the twenty
      // second timer joining in would defeat the point of backing off.
      if (failCountRef.current > 0) return;
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

  /**
   * The one sentence about sync, decided in one place.
   *
   * Failure used to be dressed as ordinary dirtiness: a failed autosave and a
   * form mid-edit both read "not saved yet", so the one state a typist should
   * act on looked exactly like the one they should ignore. The precedence is
   * the severity: an in-flight save, then the network being gone, then a
   * failing save mid-retry, then plain unsaved, then saved.
   */
  const pill = saving
    ? { cls: "border-gray-300 bg-white text-gray-700", Icon: Loader2, spin: true, text: "Saving…" }
    : offline && (dirty || failCount > 0)
    ? { cls: "border-red-200 bg-red-50 text-red-800", Icon: WifiOff, text: "Offline, will retry" }
    : failCount > 0
    ? {
        cls: "border-red-200 bg-red-50 text-red-800",
        Icon: TriangleAlert,
        text: `Could not save, retrying (${failCount})`,
      }
    : dirty
    ? { cls: "border-amber-200 bg-amber-50 text-amber-800", Icon: Clock, text: "Not saved yet" }
    : savedAt
    ? {
        cls: "border-(--dc-accent)/30 bg-(--dc-accent-soft)/50 text-(--dc-accent-strong)",
        Icon: CheckCircle2,
        text: `Saved ${new Date(savedAt).toLocaleTimeString("en-NG", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })} ✓`,
      }
    : { cls: "border-amber-200 bg-amber-50 text-amber-800", Icon: Clock, text: "Not saved yet" };

  return (
    <div ref={rootRef} className="space-y-4">
      {/*
        Sticky, because the form under it is long. The pill has to be readable
        from the phone field and from the signature box alike, or "visible
        sync" only holds for the top screenful.
      */}
      <div className="sticky top-0 z-10 rounded-lg border border-(--dc-accent)/20 bg-(--dc-accent-soft) p-3 shadow-sm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-600">Stock</p>
              <p className="mt-0.5 text-sm text-gray-900">{stove.stockStatus ?? "-"}</p>
            </div>
          </div>
        </div>
        <p
          role="status"
          aria-live="polite"
          className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${pill.cls}`}
        >
          <pill.Icon className={`h-3.5 w-3.5 shrink-0 ${pill.spin ? "animate-spin" : ""}`} />
          {pill.text}
        </p>
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

        {/* The sync state lives in the sticky pill above; a second copy down
            here would be one more place for the two to disagree. */}

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
 * Everything a partner holds, which is what clicking a partner now means.
 *
 * There used to be a chooser between here and the partner list: by
 * consignment, by month, or everything. Three screens for one question, and
 * the default hid whatever the default did not cover. The month and the
 * consignment are narrowing filters on this one list instead, so nothing a
 * typist holds a receipt for is ever behind a way in they did not pick.
 *
 * This list holds a page of a partner that may hold thousands, so its search,
 * its filters and its counts all run on the server. Anything decided here
 * would be a statement about the page dressed up as a statement about the
 * partner.
 */
function PartnerSweep({
  partner,
  detail,
  term,
  onTerm,
  month,
  onMonth,
  transaction,
  onTransaction,
  scope,
  narrowed,
  stoves,
  error,
  loading,
  server,
  onPick,
}) {
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
    for (const b of detail?.batches ?? []) {
      const m = typeof b.sales_date === "string" ? b.sales_date.slice(0, 7) : null;
      if (!m || !/^\d{4}-\d{2}$/.test(m)) continue;
      by.set(m, (by.get(m) ?? 0) + Number(b.issued_count ?? 0));
    }
    return [...by.entries()]
      .map(([period, issued]) => ({ period, issued }))
      .sort((a, z) => z.period.localeCompare(a.period));
  }, [detail]);

  const consignments = useMemo(
    () =>
      [...(detail?.batches ?? [])].sort((a, z) =>
        String(z.sales_date ?? "").localeCompare(String(a.sales_date ?? "")),
      ),
    [detail],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-0 flex-1 sm:max-w-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">
            Find a stove
          </span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={term}
              onChange={(e) => onTerm(e.target.value)}
              placeholder="Any part of the stove ID"
              aria-label="Find a stove ID"
              className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-2 text-sm focus:border-(--dc-accent) focus:outline-none"
            />
          </span>
        </label>
        {/*
          The old chooser, as two filters.

          A consignment and a month are ways of NARROWING what a partner
          holds, not separate places to go. As filters they compose with the
          search and the pager, and clearing them is one click back to
          everything rather than a walk back up a tree.
        */}
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">
            Month
          </span>
          <div className="w-full sm:w-44">
            <SearchableSelect
              ariaLabel="Month"
              value={month}
              onChange={onMonth}
              placeholder="Any month"
              searchPlaceholder="Type part of a month"
              emptyLabel="No month matches that"
              pinned={{ value: "", label: "Any month" }}
              options={months.map((m) => ({
                value: m.period,
                label: `${monthName(m.period)} (${m.issued})`,
              }))}
            />
          </div>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">
            Consignment
          </span>
          <div className="w-full sm:w-52">
            <SearchableSelect
              ariaLabel="Consignment"
              value={transaction}
              onChange={onTransaction}
              placeholder="All consignments"
              searchPlaceholder="Type part of a reference"
              emptyLabel="No consignment matches that"
              pinned={{ value: "", label: "All consignments" }}
              options={consignments.map((b) => ({
                value: b.transaction_id,
                label: `${b.transaction_id} (${b.issued_count})`,
              }))}
            />
          </div>
        </label>
      </div>

      {/*
        The scope, said plainly, whatever it is.

        "2,250 stoves, all consignments" is the honest default: nothing a
        typist holds a receipt for is hidden by an unspoken narrowing. When a
        filter IS applied, the same line names it, so the number on screen is
        never a number whose denominator has to be guessed.
      */}
      {stoves !== null && (
        <p className="flex items-center gap-1.5 text-xs text-gray-600">
          <span>
            {plural(server.total, "stove")}
            {narrowed ? ` · ${scope}` : ", all consignments"}
            {term.trim() ? ` matching "${term.trim()}"` : ""}
            {server.filter === "todo"
              ? ", still to type"
              : server.filter === "done"
              ? ", already recorded"
              : ""}
            . The search covers {narrowed ? "everything in this scope" : "every stove this partner holds"},
            not only the ones on this page.
          </span>
          {loading && <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-label="Loading" />}
        </p>
      )}

      <StoveList
        stoves={stoves}
        error={error}
        onPick={onPick}
        server={server}
        label={`${partner?.partner_id ?? "partner"}-${transaction || month || "all"}`}
      />
    </div>
  );
}

export default function Workbench() {
  const [partner, setPartner] = useState(null);
  /**
   * What clicking a partner opens: everything they hold.
   *
   * There is no separate "way in" state any more. A partner IS the sweep, and
   * the month and the consignment are narrowing filters over it, because a
   * default that hides part of what a typist holds a receipt for is a default
   * that answers "not found" to somebody holding the proof it exists.
   */
  const [detail, setDetail] = useState(null);
  /** What is typed in the search box, a keystroke at a time. */
  const [sweepTerm, setSweepTerm] = useState("");
  /** What the server was last asked to match: the term, debounced and trimmed. */
  const [sweepSearch, setSweepSearch] = useState("");
  const [sweepMonth, setSweepMonth] = useState("");
  const [sweepTransaction, setSweepTransaction] = useState("");
  /*
   * Paged, not accumulated.
   *
   * `partner_stoves` is keyset paginated - each page hands back the cursor for
   * the next - so going FORWARD is free and going BACK needs the cursor that
   * opened each page remembered. `sweepCursorsRef.current[n]` is the cursor
   * that opens page n, and page 0 opens with none.
   *
   * A ref, not state, and that is load-bearing: as state it was both written
   * by the fetch effect and a dependency of it, so every page landed twice -
   * once for the page change and once for the cursor the first fetch stored.
   */
  const [sweepPage, setSweepPage] = useState(0);
  const [sweepSize, setSweepSize] = useState(25);
  const sweepCursorsRef = useRef([null]);
  const [sweepTotal, setSweepTotal] = useState(0);
  const [sweepTotals, setSweepTotals] = useState(null);
  const [sweepHasMore, setSweepHasMore] = useState(false);
  const [sweepFilter, setSweepFilter] = useState("todo");
  const [sweepLoading, setSweepLoading] = useState(false);
  const [stove, setStove] = useState(null);
  const [queue, setQueue] = useState(null);
  const [stoves, setStoves] = useState(null);
  const [stovesError, setStovesError] = useState(null);
  /**
   * Stove IDs finished in this sitting.
   *
   * A bench finish does not create a sale - confirmation does - so the server
   * keeps counting a finished receipt as "still to type" until somebody
   * confirms it. This set is what lets the chips and "Save and next (N left)"
   * shrink as the typist works, across page changes, without pretending the
   * server said something it did not. Mirrored into a ref so the fetch effect
   * can read it without refetching every time it grows.
   */
  const [finishedIds, setFinishedIds] = useState(() => new Set());
  const finishedRef = useRef(finishedIds);
  finishedRef.current = finishedIds;
  /*
   * A run that crosses pages: set when "save and next" exhausts the loaded
   * page, read when the next page arrives, which is when its first todo row is
   * opened. `wrapped` guards the once-only round back to page one.
   */
  const autoOpenRef = useRef(false);
  const wrappedRef = useRef(false);
  /** The applied search, readable synchronously so applying "" twice is free. */
  const appliedSearchRef = useRef("");

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
   * The partner's consignments, for the month and consignment filters.
   *
   * One request per partner, and losing it costs only the filter options: the
   * sweep itself works without them, so a failure here degrades to "no
   * narrowing offered" rather than to a broken screen.
   */
  const orgId = partner?.organization_id ?? null;
  useEffect(() => {
    if (!orgId) {
      setDetail(null);
      return undefined;
    }
    let live = true;
    dataCenterClient
      .partnerDetail(orgId)
      .then((d) => live && setDetail(d))
      .catch(() => live && setDetail({ partner: null, batches: [], reps: [] }));
    return () => {
      live = false;
    };
  }, [orgId]);

  /*
   * The partner's stoves, a page at a time, everything decided on the server.
   *
   * The search, the filters and the counts all run there for the same reason:
   * a partner can hold thousands of stoves, and a filter that only ever saw
   * the loaded page would answer "not found" for a stove that is there. That
   * is the one answer a typist holding its receipt must not get.
   *
   * The rows are NOT nulled before the fetch. They used to be, and the rail -
   * mounted behind `&& stoves` - unmounted on every keystroke's refetch,
   * taking the search box, its focus and its term with it. The previous page
   * stays rendered, dimmed by `sweepLoading`, until the next one lands.
   */
  useEffect(() => {
    if (!orgId) {
      setStoves(null);
      setStovesError(null);
      return undefined;
    }
    let live = true;
    setSweepLoading(true);
    setStovesError(null);
    dataCenterClient
      .partnerStoves({
        organizationId: orgId,
        period: sweepMonth || null,
        transactionId: sweepTransaction || null,
        search: sweepSearch || null,
        recorded: sweepFilter === "todo" ? "no" : sweepFilter === "done" ? "yes" : null,
        cursor: sweepCursorsRef.current[sweepPage] ?? null,
        limit: sweepSize,
      })
      .then((r) => {
        if (!live) return;
        const finished = finishedRef.current;
        // A refetched page has never heard of this sitting's finishes, so the
        // local mark is put back on, or a finished row would flip back to a
        // grey circle every time the page reloads under the typist.
        setStoves(
          r.stoves.map((s) =>
            !s.sale_id && finished.has(s.stove_id) ? { ...s, just_recorded: true } : s,
          ),
        );
        // A finish somebody confirmed while we typed is a real sale now; the
        // server counts it, so this sitting must stop counting it too.
        const confirmed = r.stoves.filter((s) => s.sale_id && finished.has(s.stove_id));
        if (confirmed.length > 0) {
          setFinishedIds((prev) => {
            const next = new Set(prev);
            for (const s of confirmed) next.delete(s.stove_id);
            return next;
          });
        }
        setSweepTotal(r.total ?? r.stoves.length);
        setSweepTotals(r.totals ?? null);
        setSweepHasMore(Boolean(r.hasMore));
        // Remember the cursor that opens the NEXT page, so paging forward is
        // one step and paging back is a lookup rather than a refetch from the
        // top.
        if (r.nextCursor) sweepCursorsRef.current[sweepPage + 1] = r.nextCursor;
        setSweepLoading(false);
        /*
         * The run crossing a page: the typist pressed "save and next" with
         * nothing left on the loaded page, so this page was fetched to be
         * OPENED, not read. First todo row opens; a page with none advances
         * again; the end of the partner rounds to page one exactly once for
         * anything skipped; and only then does the run end.
         */
        if (autoOpenRef.current) {
          const next = r.stoves.find((s) => !s.sale_id && !finished.has(s.stove_id));
          if (next) {
            autoOpenRef.current = false;
            wrappedRef.current = false;
            setStove(next);
          } else if (r.hasMore) {
            setSweepPage((p) => p + 1);
          } else if (!wrappedRef.current && sweepPage > 0) {
            wrappedRef.current = true;
            sweepCursorsRef.current = [null];
            setSweepPage(0);
          } else {
            autoOpenRef.current = false;
            wrappedRef.current = false;
            setStove(null);
            loadQueue();
          }
        }
      })
      .catch((err) => {
        if (!live) return;
        setSweepLoading(false);
        autoOpenRef.current = false;
        wrappedRef.current = false;
        setStovesError(
          err instanceof DataCenterError ? err.message : "Could not load stoves.",
        );
      });
    return () => {
      live = false;
    };
  }, [orgId, sweepMonth, sweepTransaction, sweepSearch, sweepFilter, sweepPage, sweepSize, loadQueue]);

  /*
   * Anything that changes WHAT is being paged sends you back to page one and
   * throws the cursor stack away. A cursor is a position in one particular
   * ordered set; kept across a change of search or filter it points into a set
   * that no longer exists, and the page it opens is somebody else's.
   */
  const restart = useCallback(() => {
    setSweepPage(0);
    sweepCursorsRef.current = [null];
  }, []);
  /*
   * Applying a search is three state writes, done here in the open rather
   * than smuggled into a state updater: an updater runs twice under
   * StrictMode, and side effects inside one fire twice with it. The ref makes
   * re-applying an unchanged term - which is what a debounce timer does on
   * mount - a plain no-op.
   */
  const changeSearch = useCallback(
    (term) => {
      if (appliedSearchRef.current === term) return;
      appliedSearchRef.current = term;
      setSweepSearch(term);
      restart();
    },
    [restart],
  );

  /*
   * One debounce for the one search, owned where the term is owned.
   *
   * It used to live in the rail, over the rail's own copy of the term - so
   * every rail remount started at "" and the mount-time timer fired
   * `onSearch("")` 250ms later, erasing whatever the typist had narrowed to.
   * Here there is no remount to survive, and `changeSearch` ignores the
   * mount run because "" is already applied.
   */
  useEffect(() => {
    const id = setTimeout(() => changeSearch(sweepTerm.trim()), 250);
    return () => clearTimeout(id);
  }, [sweepTerm, changeSearch]);

  /** One partner swapped for another: every piece of sweep state starts over. */
  const openPartner = useCallback(
    (p) => {
      setPartner(p);
      setStove(null);
      setDetail(null);
      setStoves(null);
      setStovesError(null);
      setSweepTerm("");
      appliedSearchRef.current = "";
      setSweepSearch("");
      setSweepMonth("");
      setSweepTransaction("");
      setSweepFilter("todo");
      setSweepTotal(0);
      setSweepTotals(null);
      setSweepHasMore(false);
      setFinishedIds(new Set());
      autoOpenRef.current = false;
      wrappedRef.current = false;
      restart();
    },
    [restart],
  );

  /** The open form's flush handle, set by the Bench while one is mounted. */
  const benchApi = useRef(null);

  /**
   * Every stove swap goes through here, and waits.
   *
   * Clicking the rail mid-draft used to fire the parting save and replace the
   * form in the same breath - the one in-app move that could still lose typed
   * work if that save failed. Now the draft is flushed first, and a draft
   * that CANNOT save keeps its form: the pill says what is wrong, and the
   * typed values stay where the typist can see them.
   */
  const openStove = useCallback(async (s) => {
    const flush = benchApi.current?.flush;
    if (flush) {
      const ok = await flush().catch(() => false);
      if (!ok) return;
    }
    setStove(s);
  }, []);

  /** The narrowing, named so every count on screen says what it counts. */
  const narrowedParts = [
    sweepMonth ? monthName(sweepMonth) : null,
    sweepTransaction || null,
  ].filter(Boolean);
  const scopeShort = narrowedParts.length ? narrowedParts.join(" · ") : "all consignments";

  /** Which stove IDs somebody has part-typed, for the rail's amber marks. */
  const draftSerials = useMemo(
    () =>
      [...(queue?.mine ?? []), ...(queue?.abandoned ?? [])]
        .filter((r) => r.status === "draft")
        .map((r) => r.stove_serial_no),
    [queue],
  );

  /*
   * Turn one stove green without refetching the partner.
   *
   * Its own flag rather than writing a made-up value into `sale_id`: that
   * column holds a real id everywhere else, and a placeholder sitting in it is
   * the kind of thing that is harmless until something starts reading it. The
   * id also joins `finishedIds`, which is what keeps the counts shrinking when
   * this page is later refetched or paged away from.
   */
  const markRecorded = useCallback((stoveId) => {
    setStoves((list) =>
      list
        ? list.map((s) => (s.stove_id === stoveId ? { ...s, just_recorded: true } : s))
        : list,
    );
    setFinishedIds((prev) => {
      if (prev.has(stoveId)) return prev;
      const next = new Set(prev);
      next.add(stoveId);
      return next;
    });
  }, []);

  /**
   * The server's totals, corrected for this sitting.
   *
   * The server counts a stove "done" when a sale exists, and a bench finish
   * only becomes a sale at confirmation - so mid-run, the honest numbers are
   * the server's totals with this sitting's finishes moved across. This is
   * what the chips, the progress bar and "Save and next (N left)" all read,
   * which is the point: one arithmetic, not three.
   */
  const liveTotals = useMemo(() => {
    if (!sweepTotals) return null;
    return {
      all: sweepTotals.all,
      todo: Math.max(0, sweepTotals.todo - finishedIds.size),
      done: sweepTotals.done + finishedIds.size,
    };
  }, [sweepTotals, finishedIds]);

  /**
   * The next stove worth opening, from where you are.
   *
   * `forwardOnly` reads down the loaded page the way a typist reads down a
   * stack; the caller decides what happens at the bottom - the next page, not
   * the top of this one, because the partner does not end where the page does.
   * Without it the scan wraps modulo the page, which is right when the page is
   * everything there is.
   */
  const nextTodo = useCallback(
    (fromId, { forwardOnly = false } = {}) => {
      const list = stoves ?? [];
      const drafts = new Set(draftSerials.map((d) => String(d).toUpperCase()));
      const todo = (s) =>
        !(s.sale_id || s.just_recorded) || drafts.has(String(s.stove_id).toUpperCase());
      const at = list.findIndex((s) => s.stove_id === fromId);
      const reach = forwardOnly && at >= 0 ? list.length - 1 - at : list.length;
      for (let i = 1; i <= reach; i++) {
        const candidate =
          forwardOnly && at >= 0
            ? list[at + i]
            : list[(at + i + list.length) % list.length];
        if (candidate && candidate.stove_id !== fromId && todo(candidate)) return candidate;
      }
      return null;
    },
    [stoves, draftSerials],
  );

  /** What "N left" means now: the whole partner's todo, not the page's. */
  const remaining = liveTotals?.todo ?? 0;

  const trail = [
    {
      label: "Partners",
      on: () => { setPartner(null); setStove(null); },
    },
    partner && {
      label: partner.partner_name,
      on: () => setStove(null),
    },
    stove && { label: stove.stove_id, on: null },
  ].filter(Boolean);

  /** One server description, read by the rail and the list alike. */
  const server = {
    page: sweepPage,
    pageSize: sweepSize,
    total: sweepTotal,
    totals: liveTotals,
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
  };

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
                onClick={() => openStove({ stove_id: r.stove_serial_no })}
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
         * The partner beside the form, not behind it.
         *
         * Only when a partner is open: arriving straight from "on your bench"
         * there is no list to show, and inventing one by looking it up would
         * be a round trip to draw a sidebar nobody asked for.
         *
         * The rail is NOT gated on `stoves` any more. That gate is what
         * unmounted it on every refetch - it renders its own loading state
         * and keeps the previous page visible while the next one arrives.
         */
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          {partner && (
            <BenchRail
              stoves={stoves}
              current={stove.stove_id}
              drafts={draftSerials}
              onPick={openStove}
              title={`${partner.partner_name ?? "Partner"} · ${scopeShort}`}
              search={sweepTerm}
              onSearchInput={setSweepTerm}
              server={server}
              loading={sweepLoading}
            />
          )}
          <div className="min-w-0 flex-1">
            <Bench
              // Keyed by stove so switching gets a clean form rather than the
              // previous receipt's values bleeding into the next one.
              key={stove.stove_id}
              api={benchApi}
              stoveId={stove.stove_id}
              onSaved={(out) => {
                markRecorded(stove.stove_id);
                loadQueue();
                return out;
              }}
              onBack={() => { setStove(null); loadQueue(); }}
              onNext={partner ? () => {
                // Forward through the loaded page first: the run reads down
                // the stack the way the typist reads down the paper.
                const next = nextTodo(stove.stove_id, { forwardOnly: true });
                if (next) { setStove(next); return; }
                if (sweepHasMore) {
                  // The page is spent but the partner is not. Fetch the next
                  // page; its first todo row opens itself when it arrives.
                  autoOpenRef.current = true;
                  wrappedRef.current = false;
                  setSweepPage((p) => p + 1);
                  return;
                }
                if (sweepPage > 0) {
                  // The last page is done and the run started past the top:
                  // round to page one, once, for whatever was skipped.
                  autoOpenRef.current = true;
                  wrappedRef.current = true;
                  sweepCursorsRef.current = [null];
                  setSweepPage(0);
                  return;
                }
                // One page holds everything: wrap within it, as before.
                const wrapped = nextTodo(stove.stove_id);
                if (wrapped) { setStove(wrapped); return; }
                // Nothing left is worth saying rather than silently doing
                // nothing, so the run ends where it started.
                setStove(null);
                loadQueue();
              } : null}
              nextLabel={
                remaining > 1 ? `Save and next (${remaining - 1} left)` : "Save and finish the run"
              }
            />
          </div>
        </div>
      ) : partner ? (
        <PartnerSweep
          partner={partner}
          detail={detail}
          term={sweepTerm}
          onTerm={setSweepTerm}
          month={sweepMonth}
          onMonth={(m) => {
            setSweepMonth(m);
            restart();
          }}
          transaction={sweepTransaction}
          onTransaction={(t) => {
            setSweepTransaction(t);
            restart();
          }}
          scope={scopeShort}
          narrowed={narrowedParts.length > 0}
          stoves={stoves}
          error={stovesError}
          loading={sweepLoading}
          server={server}
          onPick={openStove}
        />
      ) : (
        <PartnerList onPick={openPartner} />
      )}
    </div>
  );
}
