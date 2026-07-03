
import React, { useState } from "react";
import { useAuth } from "../../contexts/useAuth";
import DashboardLayout from "../../components/DashboardLayout";
import ProtectedRoute from "../../components/ProtectedRoute";
import { useToast } from "@/components/ui/toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Wrench,
  Database,
  Upload,
  Download,
  AlertTriangle,
  CheckCircle2,
  Copy,
} from "lucide-react";

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + "/functions/v1";

// ── Types mirroring the edge function responses ──
interface Bucket {
  count: number;
  sample: unknown[];
  truncated: boolean;
}
interface InternalReport {
  generated_at: string;
  totals: {
    distinct_stove_ids_sent: number;
    distinct_stove_ids_existing: number;
    sent_but_missing: number;
    orphan_no_transfer: number;
    duplicated_in_transfers: number;
  };
  buckets: {
    sent_but_missing: Bucket;
    orphan_no_transfer: Bucket;
    duplicated_in_transfers: Bucket;
  };
}
interface ErpReport {
  generated_at: string;
  totals: {
    erp_distinct: number;
    monitoring_distinct: number;
    matched: number;
    in_erp_not_monitoring: number;
    in_monitoring_not_erp: number;
  };
  buckets: {
    in_erp_not_monitoring: Bucket;
    in_monitoring_not_erp: Bucket;
  };
}
interface FullReport {
  generated_at: string;
  year: number;
  totals: {
    erp_transferred_distinct: number;
    erp_declared_sum: number;
    erp_declared_vs_actual_gap: number;
    erp_duplicate_ids: number;
    monitoring_distinct: number;
    matched: number;
    missing_in_monitoring: number;
    extra_in_monitoring: number;
    date_mismatch: number;
    ref_mismatch: number;
    duplicates_in_monitoring: number;
  };
  buckets: {
    missing_in_monitoring: Bucket;
    extra_in_monitoring: Bucket;
    date_mismatch: Bucket;
    ref_mismatch: Bucket;
    duplicates_in_monitoring: Bucket;
    erp_duplicate_ids: Bucket;
    erp_declared_vs_actual: Bucket;
  };
  note: string;
}

function downloadCsv(filename: string, rows: unknown[]) {
  const lines = rows.map((r) =>
    typeof r === "string" ? r : JSON.stringify(r)
  );
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function StatCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "bad" | "warn" | "good";
}) {
  const toneClass =
    tone === "bad"
      ? "text-red-600"
      : tone === "warn"
      ? "text-amber-600"
      : tone === "good"
      ? "text-green-600"
      : "text-gray-800";
  return (
    <div className="rounded-lg border border-gray-200 p-4 bg-white">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

function BucketRow({
  title,
  description,
  bucket,
  filename,
  tone,
}: {
  title: string;
  description: string;
  bucket: Bucket;
  filename: string;
  tone: "bad" | "warn" | "good" | "neutral";
}) {
  const badge =
    bucket.count === 0 ? (
      <Badge className="bg-green-100 text-green-800">Clean</Badge>
    ) : tone === "bad" ? (
      <Badge variant="destructive">Needs action</Badge>
    ) : (
      <Badge variant="secondary">Review</Badge>
    );
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-800">{title}</span>
          {badge}
        </div>
        <p className="text-sm text-gray-500 mt-1">{description}</p>
        {bucket.truncated && (
          <p className="text-xs text-amber-600 mt-1">
            Showing first {bucket.sample.length} of {bucket.count}. Download
            exports the visible sample — raise sample limit for the full set.
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-2 shrink-0">
        <span className="text-2xl font-bold">{bucket.count}</span>
        {bucket.count > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadCsv(filename, bucket.sample)}
          >
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
        )}
      </div>
    </div>
  );
}

const ToolsContentInner = () => {
  const { supabase } = useAuth();
  const { toast } = useToast();

  const [internalLoading, setInternalLoading] = useState(false);
  const [internalReport, setInternalReport] = useState<InternalReport | null>(
    null
  );

  const [erpLoading, setErpLoading] = useState(false);
  const [erpReport, setErpReport] = useState<ErpReport | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState("");
  const [csvFileName, setCsvFileName] = useState("");

  // Full ERP reconciliation (direct API)
  const [fullLoading, setFullLoading] = useState(false);
  const [fullReport, setFullReport] = useState<FullReport | null>(null);
  const [erpToken, setErpToken] = useState("");
  const [fullYear, setFullYear] = useState(new Date().getFullYear());

  // Backfill / fix tool
  const backfillInputRef = React.useRef<HTMLInputElement>(null);
  const [backfillRows, setBackfillRows] = useState<any[] | null>(null);
  const [backfillFileName, setBackfillFileName] = useState("");
  const [backfillOverwrite, setBackfillOverwrite] = useState(false);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillReport, setBackfillReport] = useState<any | null>(null);

  const getToken = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token;
  };

  const runInternal = async () => {
    setInternalLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${FUNCTIONS_URL}/reconcile-internal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ sample_limit: 5000 }),
      });
      const data = await res.json();
      if (!res.ok || !data.success)
        throw new Error(data.message || "Audit failed");
      setInternalReport(data);
      toast({ title: "Audit complete", description: data.note });
    } catch (err) {
      toast({
        title: "Audit failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setInternalLoading(false);
    }
  };

  const onFile = async (file: File) => {
    setCsvFileName(file.name);
    const text = await file.text();
    setCsvText(text);
  };

  const runErp = async () => {
    if (!csvText.trim()) {
      toast({
        title: "No CSV provided",
        description: "Upload or paste an ERP stove-ID export first.",
        variant: "destructive",
      });
      return;
    }
    setErpLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${FUNCTIONS_URL}/reconcile-erp-csv`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ csv_data: csvText, sample_limit: 10000 }),
      });
      const data = await res.json();
      if (!res.ok || !data.success)
        throw new Error(data.message || "Reconciliation failed");
      setErpReport(data);
      toast({ title: "Reconciliation complete", description: data.note });
    } catch (err) {
      toast({
        title: "Reconciliation failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setErpLoading(false);
    }
  };

  const runFull = async () => {
    if (!erpToken.trim()) {
      toast({
        title: "ERP token required",
        description: "Paste your ERP login access token first.",
        variant: "destructive",
      });
      return;
    }
    setFullLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${FUNCTIONS_URL}/reconcile-erp-full`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          erp_token: erpToken.trim(),
          year: fullYear,
          sample_limit: 20000,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success)
        throw new Error(data.message || "Reconciliation failed");
      setFullReport(data);
      toast({ title: "Reconciliation complete", description: data.note });
    } catch (err) {
      toast({
        title: "Reconciliation failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setFullLoading(false);
    }
  };

  const onBackfillFile = async (file: File) => {
    setBackfillFileName(file.name);
    setBackfillReport(null);
    const text = await file.text();
    try {
      const parsed = JSON.parse(text);
      const rows = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.data)
        ? parsed.data
        : null;
      if (!rows) throw new Error("not an array");
      setBackfillRows(rows);
      toast({ title: "File loaded", description: `${rows.length} rows ready` });
    } catch {
      setBackfillRows(null);
      toast({
        title: "Couldn't read file",
        description: "Must be the ERP JSON array export (the response from the query).",
        variant: "destructive",
      });
    }
  };

  const runBackfill = async (apply: boolean) => {
    if (!backfillRows) {
      toast({
        title: "No file loaded",
        description: "Upload the ERP JSON export first.",
        variant: "destructive",
      });
      return;
    }
    setBackfillLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${FUNCTIONS_URL}/backfill-stove-fields`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          rows: backfillRows,
          overwrite: backfillOverwrite,
          apply,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success)
        throw new Error(data.message || "Backfill failed");
      setBackfillReport(data);
      toast({
        title: apply ? "Applied" : "Preview ready",
        description: apply
          ? "Stove fields updated."
          : "Dry run — nothing was written.",
      });
    } catch (err) {
      toast({
        title: "Backfill failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBackfillLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-2">
        <Wrench className="h-6 w-6 text-gray-700" />
        <h1 className="text-2xl font-bold text-gray-800">Tools</h1>
        <Badge variant="secondary">Super admin only</Badge>
      </div>
      <p className="text-sm text-gray-500">
        Personal data-integrity tools for reconciling stove-ID transfers between
        the ERP and this monitoring app.
      </p>

      {/* ── Tool 0: Full ERP reconciliation (direct API) ── */}
      <Card className="border-blue-200">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-blue-700" />
            <CardTitle>Full ERP Reconciliation</CardTitle>
            <Badge className="bg-blue-100 text-blue-800">Recommended</Badge>
          </div>
          <CardDescription>
            One-click, field-by-field reconciliation on <strong>actual stove IDs</strong>.
            Pulls every transferred stove for the year straight from the ERP (with
            its <code>sales_date</code> and <code>sales_reference</code>) and compares
            it to this app — surfacing missing stoves, phantoms, date mismatches,
            reference mismatches and duplicates. Dry-run — nothing is written.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs space-y-1">
            <p className="font-medium text-gray-700">How to get your ERP token:</p>
            <p className="text-gray-600">
              Log into the ERP site → open DevTools → Application → Local Storage →
              copy the <code>access_token</code> value (or grab it from any logged-in
              Postman request). Paste it below. Tokens expire after ~1 hour — just
              grab a fresh one if it fails.
            </p>
          </div>

          <textarea
            placeholder="Paste ERP access token here…"
            value={erpToken}
            onChange={(e) => setErpToken(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-700">Year:</label>
            <input
              type="number"
              value={fullYear}
              onChange={(e) => setFullYear(Number(e.target.value))}
              className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
            <Button onClick={runFull} disabled={fullLoading}>
              {fullLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Reconcile now
            </Button>
          </div>

          {fullReport && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                  label={`ERP transferred (${fullReport.year})`}
                  value={fullReport.totals.erp_transferred_distinct}
                />
                <StatCard
                  label="Monitoring distinct"
                  value={fullReport.totals.monitoring_distinct}
                />
                <StatCard label="Matched" value={fullReport.totals.matched} tone="good" />
                <StatCard
                  label="Missing here"
                  value={fullReport.totals.missing_in_monitoring}
                  tone={fullReport.totals.missing_in_monitoring > 0 ? "bad" : "good"}
                />
              </div>
              <BucketRow
                title="Missing in Monitoring"
                description="ERP transferred these but you never received them. Re-transfer from the ERP — its ingest is idempotent, so re-sending is safe."
                bucket={fullReport.buckets.missing_in_monitoring}
                filename={`missing_in_monitoring_${fullReport.year}.csv`}
                tone="bad"
              />
              <BucketRow
                title="Extra in Monitoring"
                description="You have these (org assigned, dated in-year) but the ERP's transferred set doesn't — phantom, stale, or test data."
                bucket={fullReport.buckets.extra_in_monitoring}
                filename={`extra_in_monitoring_${fullReport.year}.csv`}
                tone="warn"
              />
              <BucketRow
                title="Date mismatch"
                description="transfer_sales_date here differs from the ERP's sales_date. These skew per-month/period totals. Fix with the 'Fix Stove Fields' tool."
                bucket={fullReport.buckets.date_mismatch}
                filename={`date_mismatch_${fullReport.year}.csv`}
                tone="warn"
              />
              <BucketRow
                title="Reference mismatch"
                description="sales_reference here differs from the ERP's. Usually cosmetic; fix with the 'Fix Stove Fields' tool."
                bucket={fullReport.buckets.ref_mismatch}
                filename={`ref_mismatch_${fullReport.year}.csv`}
                tone="neutral"
              />
              <BucketRow
                title="Duplicates in Monitoring"
                description="One stove ID with more than one row here (e.g. transferred to two orgs). Each extra row inflates counts."
                bucket={fullReport.buckets.duplicates_in_monitoring}
                filename={`duplicates_in_monitoring_${fullReport.year}.csv`}
                tone="warn"
              />
              <div className="rounded-lg border border-gray-200 p-4 bg-amber-50/40">
                <p className="text-sm text-gray-700">
                  <strong>Why the ERP dashboard differs:</strong> the ERP shows
                  its <em>declared</em> total{" "}
                  <span className="font-mono">
                    {fullReport.totals.erp_declared_sum.toLocaleString()}
                  </span>
                  , but only{" "}
                  <span className="font-mono">
                    {fullReport.totals.erp_transferred_distinct.toLocaleString()}
                  </span>{" "}
                  actual stove IDs exist (gap of{" "}
                  <span className="font-mono">
                    {fullReport.totals.erp_declared_vs_actual_gap}
                  </span>
                  ). Monitoring counts the actual IDs, so it can only ever reach{" "}
                  {fullReport.totals.erp_transferred_distinct.toLocaleString()}.
                  Fix the orders below <strong>in the ERP</strong> so its
                  declared count matches reality.
                </p>
              </div>
              <BucketRow
                title="ERP declared ≠ actual (per order)"
                description="Orders whose number_of_stoves doesn't match the count of stove-ID rows attached. diff > 0 = ERP over-declares on that order."
                bucket={fullReport.buckets.erp_declared_vs_actual}
                filename={`erp_declared_vs_actual_${fullReport.year}.csv`}
                tone="warn"
              />
              <BucketRow
                title="ERP duplicate stove IDs (fix in ERP)"
                description="Stove IDs that appear MORE THAN ONCE in the ERP's own sold_stove_ids (same physical stove on two order lines / double-sale). The ERP counts each twice — this is the gap. Remove the duplicate line in the ERP."
                bucket={fullReport.buckets.erp_duplicate_ids}
                filename={`erp_duplicate_ids_${fullReport.year}.csv`}
                tone="warn"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Tool 1: Internal audit ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-blue-600" />
            <CardTitle>Internal Transfer Audit</CardTitle>
          </div>
          <CardDescription>
            Checks consistency within this app only — no ERP access needed.
            Reconstructs everything ever sent to you (from transfer history) and
            compares it to what actually exists in the stove IDs table.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={runInternal} disabled={internalLoading}>
            {internalLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            )}
            Run audit
          </Button>

          {internalReport && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                  label="Distinct sent"
                  value={internalReport.totals.distinct_stove_ids_sent}
                />
                <StatCard
                  label="Distinct existing"
                  value={internalReport.totals.distinct_stove_ids_existing}
                />
                <StatCard
                  label="Sent but missing"
                  value={internalReport.totals.sent_but_missing}
                  tone={
                    internalReport.totals.sent_but_missing > 0
                      ? "bad"
                      : "good"
                  }
                />
                <StatCard
                  label="Orphans"
                  value={internalReport.totals.orphan_no_transfer}
                  tone={
                    internalReport.totals.orphan_no_transfer > 0
                      ? "warn"
                      : "good"
                  }
                />
              </div>
              <BucketRow
                title="Sent but missing"
                description="Logged in transfer history but never created in stove_ids — silent ingest failure. These are the records to recover."
                bucket={internalReport.buckets.sent_but_missing}
                filename="sent_but_missing.csv"
                tone="bad"
              />
              <BucketRow
                title="Orphan — no transfer record"
                description="Exists in stove_ids but never appeared in any transfer batch — manual, test, or pre-logging data."
                bucket={internalReport.buckets.orphan_no_transfer}
                filename="orphan_no_transfer.csv"
                tone="warn"
              />
              <BucketRow
                title="Duplicated across transfers"
                description="Same stove ID sent in more than one batch (re-sends, skipped on ingest). Informational."
                bucket={internalReport.buckets.duplicated_in_transfers}
                filename="duplicated_in_transfers.csv"
                tone="neutral"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Tool 2: ERP CSV reconciliation ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-purple-600" />
            <CardTitle>ERP Export Reconciliation</CardTitle>
          </div>
          <CardDescription>
            Closes the gap the internal audit can&apos;t see: stoves the ERP has
            but never sent you. Export the stove-ID list from the ERP&apos;s live
            site, then upload or paste it here. Dry-run — nothing is written.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                // reset so re-selecting the same file still fires onChange
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-2" />
              Choose CSV
            </Button>
            {csvFileName && (
              <span className="text-sm text-gray-600">{csvFileName}</span>
            )}
          </div>

          <textarea
            placeholder="…or paste the ERP CSV / stove IDs here"
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value);
              setCsvFileName("");
            }}
            rows={5}
            className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <Button onClick={runErp} disabled={erpLoading}>
            {erpLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Copy className="h-4 w-4 mr-2" />
            )}
            Reconcile (dry run)
          </Button>

          {erpReport && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                  label="ERP distinct"
                  value={erpReport.totals.erp_distinct}
                />
                <StatCard
                  label="Monitoring distinct"
                  value={erpReport.totals.monitoring_distinct}
                />
                <StatCard label="Matched" value={erpReport.totals.matched} tone="good" />
                <StatCard
                  label="In ERP, not here"
                  value={erpReport.totals.in_erp_not_monitoring}
                  tone={
                    erpReport.totals.in_erp_not_monitoring > 0 ? "bad" : "good"
                  }
                />
              </div>
              <BucketRow
                title="In ERP, not in Monitoring"
                description="ERP has these but you never received them — never landed. Re-transfer from the ERP (its ingest is idempotent, so re-sending is safe)."
                bucket={erpReport.buckets.in_erp_not_monitoring}
                filename="in_erp_not_monitoring.csv"
                tone="bad"
              />
              <BucketRow
                title="In Monitoring, not in ERP export"
                description="You have these but the ERP export doesn't — orphans, test data, or an incomplete export."
                bucket={erpReport.buckets.in_monitoring_not_erp}
                filename="in_monitoring_not_erp.csv"
                tone="warn"
              />
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800">
              Accepts a “stove_id” / “Stove ID” column (one per row — what the
              Supabase REST API returns), a semicolon-separated “Stove IDs”
              column (ERP transfer format), or a single-column list. The ERP
              site&apos;s Export button only exports the current page — for a
              complete set, pull from the REST API (see the guide).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Tool 3: Backfill / fix stove fields from ERP ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-emerald-600" />
            <CardTitle>Fix Stove Fields from ERP</CardTitle>
          </div>
          <CardDescription>
            Corrects <code>sales_reference</code>, <code>transfer_sales_date</code>{" "}
            and <code>factory</code> on stove rows using authoritative ERP data.
            Export from the ERP (query below), upload the JSON, preview, then
            apply. Writes to the base table, so it fixes hidden pre-2026 rows too.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs">
            <p className="font-medium text-gray-700 mb-1">
              ERP query (Postman, GET, Accept: application/json):
            </p>
            <code className="block break-all text-gray-600">
              /rest/v1/sold_stove_ids?select=stove_id,sales_reference,sales_orders(sales_date,factories(factory_location))
            </code>
            <p className="text-gray-500 mt-1">
              Save the JSON response to a file and upload it below.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              ref={backfillInputRef}
              type="file"
              accept=".json,application/json,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onBackfillFile(f);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => backfillInputRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-2" />
              Choose ERP JSON
            </Button>
            {backfillFileName && (
              <span className="text-sm text-gray-600">
                {backfillFileName}
                {backfillRows ? ` — ${backfillRows.length} rows` : ""}
              </span>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={backfillOverwrite}
              onChange={(e) => setBackfillOverwrite(e.target.checked)}
            />
            Also overwrite existing values that differ (otherwise fill blanks only)
          </label>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => runBackfill(false)}
              disabled={backfillLoading || !backfillRows}
            >
              {backfillLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Preview (dry run)
            </Button>
            <Button
              onClick={() => {
                if (
                  window.confirm(
                    backfillOverwrite
                      ? "Apply: fill blanks AND overwrite differing values on stove rows. Proceed?"
                      : "Apply: fill blank fields on stove rows. Proceed?"
                  )
                )
                  runBackfill(true);
              }}
              disabled={backfillLoading || !backfillRows || !backfillReport}
            >
              <Wrench className="h-4 w-4 mr-2" />
              Apply
            </Button>
          </div>

          {backfillReport?.report && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Input rows" value={backfillReport.report.input_rows} />
                <StatCard label="Matched in app" value={backfillReport.report.matched} tone="good" />
                <StatCard
                  label="Not found in app"
                  value={backfillReport.report.not_found_in_app}
                  tone={backfillReport.report.not_found_in_app > 0 ? "warn" : "good"}
                />
              </div>
              <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left p-2">Field</th>
                    <th className="text-right p-2">Would fill (blank)</th>
                    <th className="text-right p-2">Would overwrite (differs)</th>
                  </tr>
                </thead>
                <tbody>
                  {(["sales_reference", "transfer_sales_date", "factory"] as const).map(
                    (f) => (
                      <tr key={f} className="border-t border-gray-100">
                        <td className="p-2 font-mono text-xs">{f}</td>
                        <td className="p-2 text-right">{backfillReport.report[f]?.would_fill ?? 0}</td>
                        <td className="p-2 text-right">{backfillReport.report[f]?.would_overwrite ?? 0}</td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
              <p className="text-xs text-gray-500">
                {backfillReport.mode === "apply"
                  ? "✅ Applied. Re-run Preview to confirm counts are now 0."
                  : backfillOverwrite
                  ? "Dry run. Apply will fill blanks AND overwrite the 'differs' column."
                  : "Dry run. Apply will fill blanks only (overwrite column ignored unless you tick the box)."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const ToolsContent = () => (
  <ProtectedRoute requireSuperAdmin>
    <DashboardLayout currentRoute="settings-tools" title="Tools">
      <ToolsContentInner />
    </DashboardLayout>
  </ProtectedRoute>
);

export default ToolsContent;
