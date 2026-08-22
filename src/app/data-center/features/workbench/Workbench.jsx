import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dataCenterClient, dataCenterImport, DataCenterError } from "../../lib/client";
import { usePaged } from "../../lib/usePaged";
import Pagination from "../../components/Pagination";
import ExportButton from "../../components/ExportButton";
import SaleForm, { blankSale, saleProblems, withDefaults, TERMS } from "./SaleForm";
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
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none sm:w-48"
          >
            <option value="">Everywhere</option>
            {states.map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
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

function BatchList({ partner, onPick }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

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

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading consignments...
      </p>
    );
  }

  return (
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

function StoveList({ batch, onPick }) {
  const [stoves, setStoves] = useState(null);
  const [error, setError] = useState(null);
  const [only, setOnly] = useState("todo");

  useEffect(() => {
    let live = true;
    dataCenterClient
      .batchStoves(batch.transfer_id)
      .then((r) => live && setStoves(r.stoves))
      .catch(
        (err) =>
          live &&
          setError(err instanceof DataCenterError ? err.message : "Could not load stoves."),
      );
    return () => {
      live = false;
    };
  }, [batch.transfer_id]);

  const shown = useMemo(() => {
    const all = stoves ?? [];
    if (only === "todo") return all.filter((s) => !s.sale_id);
    if (only === "done") return all.filter((s) => s.sale_id);
    return all;
  }, [stoves, only]);

  const paged = usePaged(shown, 25);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (stoves === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading stove IDs...
      </p>
    );
  }

  const counts = {
    todo: stoves.filter((s) => !s.sale_id).length,
    done: stoves.filter((s) => s.sale_id).length,
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
            aria-pressed={only === f.key}
            onClick={() => setOnly(f.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              only === f.key
                ? "border-(--dc-accent) bg-(--dc-accent) text-white"
                : "border-gray-300 text-gray-700 hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/50"
            }`}
          >
            {f.label} ({counts[f.key]})
          </button>
        ))}
        <div className="ml-auto">
          <ExportButton
            columns={STOVE_COLUMNS}
            rows={() => shown}
            filename={`stoves-${batch.transaction_id}.csv`}
            label="Export stoves"
            disabled={shown.length === 0}
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-(--dc-accent)/40 bg-(--dc-accent-soft)/20 px-4 py-8 text-center text-sm text-gray-600">
          {only === "todo"
            ? "Every stove in this consignment has been recorded. Nothing left to type here."
            : "Nothing to show under that filter."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="bg-(--dc-accent-soft) text-left text-xs uppercase tracking-wide text-(--dc-accent-strong)">
                  <th className="px-3 py-2 font-semibold">Stove ID</th>
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
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            onPage={paged.setPage}
            onPageSize={paged.setPageSize}
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


function Bench({ stoveId, onSaved, onBack }) {
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

  const save = useCallback(
    async (complete) => {
      setSaving(true);
      setError(null);
      setHint(null);
      try {
        // The contact defaults are applied before saving, so what is stored is
        // what the validator judged rather than a shape only the screen had.
        const body = complete ? withDefaults(valuesRef.current) : valuesRef.current;
        const out = await dataCenterImport.workbenchSave(stoveId, body, complete);
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
            onClick={async () => {
              setShowMissing(true);
              if (problemCount > 0 || termsMissing) {
                setError(
                  problemCount > 0
                    ? `${plural(problemCount, "field")} still to sort out.`
                    : "The six terms all have to be ticked.",
                );
                setHint(
                  "What is wrong is written under each one. Save draft instead if you " +
                    "want to come back to it: nothing typed is lost either way.",
                );
                return;
              }
              await save(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-4 py-1.5 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-40"
          >
            <CheckCircle2 className="h-4 w-4" /> Save as finished
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-600">
        Finished records wait for somebody to confirm them before they reach the
        sales app. Nothing typed here is lost by leaving: a draft saves every
        twenty seconds and again on the way out.
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------- the shell */

export default function Workbench() {
  const [partner, setPartner] = useState(null);
  const [batch, setBatch] = useState(null);
  const [stove, setStove] = useState(null);
  const [queue, setQueue] = useState(null);

  const loadQueue = useCallback(() => {
    dataCenterImport
      .workbenchQueue()
      .then(setQueue)
      .catch(() => setQueue(null));
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const trail = [
    { label: "Partners", on: () => { setPartner(null); setBatch(null); setStove(null); } },
    partner && {
      label: partner.partner_name,
      on: () => { setBatch(null); setStove(null); },
    },
    batch && { label: batch.transaction_id, on: () => setStove(null) },
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
        <Bench
          stoveId={stove.stove_id}
          onSaved={loadQueue}
          onBack={() => { setStove(null); loadQueue(); }}
        />
      ) : batch ? (
        <StoveList batch={batch} onPick={setStove} />
      ) : partner ? (
        <BatchList partner={partner} onPick={setBatch} />
      ) : (
        <PartnerList onPick={setPartner} />
      )}
    </div>
  );
}
