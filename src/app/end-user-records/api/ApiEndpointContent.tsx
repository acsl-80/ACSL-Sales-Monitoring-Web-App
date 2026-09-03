import { useState, useEffect, useMemo, useCallback } from "react";
import { format } from "date-fns";
import DashboardLayout from "../../components/DashboardLayout";
import PageHeader from "../../components/PageHeader";
import {
  Plug,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Send,
  CheckCircle2,
  XCircle,
  Calendar as CalendarIcon,
  RotateCcw,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { useToastNotification } from "@/app/contexts/useToastNotification";
import { useAuth } from "../../contexts/useAuth";
import { resolveRole } from "@/lib/permissions";
import {
  supabaseUrl,
  supabaseAnonKey,
  supabaseFunctionsUrl,
} from "@/lib/supabaseConfig";
import { createClientComponentClient } from "@/lib/supabaseClient";
import { getGeoData, getGeoDataSync } from "@/lib/geoDataService";
import { downloadApiDocsPdf } from "./apiDocsPdf";

const ENDPOINT_URL = `${supabaseUrl}/functions/v1/end-user-records-api`;
const KEY_FN_URL = `${supabaseUrl}/functions/v1/get-end-user-api-key`;

interface ParamDef {
  name: string;
  type: string;
  required: boolean;
  default?: string;
  description: string;
}

const PARAMS: ParamDef[] = [
  { name: "page", type: "integer", required: false, default: "1", description: "Page number, starting at 1." },
  { name: "limit", type: "integer", required: false, default: "100", description: "Records per page. Maximum 500." },
  { name: "status", type: "string", required: false, description: "Filter by completeness: completed, pending, or incomplete. Accepts a comma-separated list. Use status=completed to pull only records that are ready to synchronise." },
  { name: "updatedSince", type: "string (ISO 8601)", required: false, description: "Only records whose updated_at is on or after this timestamp. Use this for incremental syncs instead of re-pulling the full dataset." },
  { name: "dateFrom", type: "string (YYYY-MM-DD)", required: false, description: "Include sales on or after this date (sales_date)." },
  { name: "dateTo", type: "string (YYYY-MM-DD)", required: false, description: "Include sales on or before this date (sales_date)." },
  { name: "state", type: "string", required: false, description: "Filter by state (matches state_backup)." },
  { name: "lga", type: "string", required: false, description: "Filter by LGA (matches lga_backup)." },
  { name: "partner_id", type: "uuid", required: false, description: "Filter by partner organization id." },
  { name: "stove_serial_no", type: "string", required: false, description: "Exact match on a single stove serial number." },
  { name: "search", type: "string", required: false, description: "Search across end user name, contact person, phone, stove serial, transaction id, and partner name." },
  { name: "include_cancelled", type: "boolean", required: false, default: "false", description: "Set true to include archived / cancelled records. When false, both archived sales and sales with a cancellation record are excluded." },
];

const FIELDS: { name: string; description: string }[] = [
  { name: "id", description: "Sale UUID." },
  { name: "transaction_id", description: "Human-readable transaction reference (e.g. ASY1O4)." },
  { name: "is_ready_to_sync", description: "True when the record is complete and not cancelled — equivalent to status = completed and is_cancelled = false. Use this as the synchronisation gate." },
  { name: "status", description: "Completeness of the record. completed = every field the sales form requires is present, including a customer signature. pending = all required fields present but no valid signature. incomplete = at least one required field missing. Recalculated on every create and edit." },
  { name: "sales_reference", description: "The ERP batch reference for this stove, resolved from the stove serial. Join key back to the ERP sales order. Null when the serial has no ERP reference." },
  { name: "factory", description: "Factory the stove was produced at, resolved from the stove serial." },
  { name: "sales_date", description: "Date of the sale." },
  { name: "created_at / updated_at", description: "Record timestamps." },
  { name: "end_user_name", description: "End user's full name." },
  { name: "contact_person", description: "Contact person's name at the point of sale." },
  { name: "phone / contact_phone / other_phone", description: "End user and contact phone numbers." },
  { name: "state_backup / lga_backup", description: "State and LGA at time of sale." },
  { name: "address", description: "Full address record: street, city, state, country, latitude, longitude, full_address." },
  { name: "stove_serial_no", description: "Serial number of the stove sold." },
  { name: "stove_image / agreement_image", description: "Uploaded stove and agreement images (id, url, public_id, type)." },
  { name: "organization", description: "Partner organization: id, partner_name, branch, state, email." },
  { name: "partner_name", description: "Denormalized partner name at time of sale." },
  { name: "sales_agent / created_by_profile / updated_by_profile", description: "Profile of the agent/creator/last modifier (id, full_name, email, phone, role)." },
  { name: "payment_model", description: "Payment model: id, name, duration_months, fixed_price." },
  { name: "amount / total_paid / deposit / balance", description: "Sale amount, running total paid, initial deposit, and outstanding balance." },
  { name: "payment_records", description: "All installment payment rows: id, amount, payment_date, payment_method, notes, recorded_by, created_at." },
  { name: "payment_status / is_installment", description: "Payment status and whether the sale is on installments." },
  { name: "is_archived", description: "Archive flag." },
  { name: "is_cancelled / cancellation_reason / cancelled_by / cancelled_at", description: "Cancellation metadata (present for cancelled sales)." },
  { name: "retailer_branch / pot_quantity / heat_retention_device", description: "Additional sale attributes captured on the form." },
  { name: "previous_stove_type / previous_stove_other / meals_per_day / cooking_fuel_source / cooking_location", description: "End-user cooking profile captured on the sales form." },
];

function maskKey(k: string): string {
  if (!k) return "";
  if (k.length <= 8) return "•".repeat(k.length);
  return `${k.slice(0, 4)}${"•".repeat(Math.max(8, k.length - 8))}${k.slice(-4)}`;
}

function copy(text: string, label = "Copied", notify?: (label: string) => void) {
  navigator.clipboard.writeText(text).then(() => notify?.(label));
}

const ApiEndpointContent = () => {
  // sonner's <Toaster /> is mounted nowhere in this app; the app's own
  // provider is.
  const { toast } = useToastNotification();
  const { userRole } = useAuth();
  const resolvedRole = resolveRole(userRole) || "";
  const isSuperAdmin = resolvedRole === "super_admin";

  const [apiKey, setApiKey] = useState<string>("");
  const [keyLoading, setKeyLoading] = useState(true);
  const [keyError, setKeyError] = useState<string>("");
  const [reveal, setReveal] = useState(false);

  const [sample, setSample] = useState<{ status: number; ms: number; body: string } | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);

  const DEFAULT_TRY: Record<string, string> = { page: "1", limit: "10" };
  const [tryParams, setTryParams] = useState<Record<string, string>>(DEFAULT_TRY);
  const [tryResult, setTryResult] = useState<{ status: number; ms: number; body: string } | null>(null);
  const [tryLoading, setTryLoading] = useState(false);

  // Geo data (states + LGAs) and partners for Try-it dropdowns.
  const initialGeo = getGeoDataSync();
  const [geo, setGeo] = useState<{ states: string[]; lgas: Record<string, string[]> }>(
    { states: initialGeo.states, lgas: initialGeo.lgas },
  );
  const [partners, setPartners] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    let alive = true;
    getGeoData().then((g) => {
      if (alive && g?.states?.length) setGeo({ states: g.states, lgas: g.lgas });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let alive = true;
    (async () => {
      try {
        const supabase = createClientComponentClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const params = new URLSearchParams({
          limit: "500",
          offset: "0",
          include_admin_users: "false",
          sortBy: "partner_name",
          sortOrder: "asc",
        });
        const res = await fetch(`${supabaseFunctionsUrl}/manage-organizations?${params}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const json = await res.json();
        if (!res.ok || json.success === false) return;
        const rows: Array<{ id: string; partner_name?: string; name?: string }> = json.data || [];
        if (alive) {
          setPartners(rows.map((r) => ({ id: r.id, name: r.partner_name || r.name || r.id })));
        }
      } catch {
        /* non-fatal */
      }
    })();
    return () => { alive = false; };
  }, [isSuperAdmin]);

  const fetchKey = useCallback(async () => {
    if (!isSuperAdmin) {
      setKeyLoading(false);
      return;
    }
    try {
      setKeyLoading(true);
      setKeyError("");
      const supabase = createClientComponentClient();
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(KEY_FN_URL, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${session?.access_token || supabaseAnonKey}`,
        },
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to load key");
      setApiKey(json.api_key);
    } catch (e) {
      setKeyError((e as Error).message);
    } finally {
      setKeyLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => { fetchKey(); }, [fetchKey]);

  const callEndpoint = useCallback(async (params: Record<string, string>) => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== "" && v != null) search.append(k, v);
    }
    const url = `${ENDPOINT_URL}${search.toString() ? `?${search}` : ""}`;
    const start = performance.now();
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const ms = Math.round(performance.now() - start);
    const text = await res.text();
    let pretty = text;
    try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
    return { status: res.status, ms, body: pretty };
  }, [apiKey]);

  const loadSample = useCallback(async () => {
    if (!apiKey) return;
    setSampleLoading(true);
    try {
      const r = await callEndpoint({ limit: "3" });
      setSample(r);
    } catch (e) {
      setSample({ status: 0, ms: 0, body: (e as Error).message });
    } finally {
      setSampleLoading(false);
    }
  }, [apiKey, callEndpoint]);

  useEffect(() => { if (apiKey) loadSample(); }, [apiKey, loadSample]);

  const handleTry = useCallback(async () => {
    if (!apiKey) return;
    setTryLoading(true);
    try {
      const r = await callEndpoint(tryParams);
      setTryResult(r);
    } catch (e) {
      setTryResult({ status: 0, ms: 0, body: (e as Error).message });
    } finally {
      setTryLoading(false);
    }
  }, [apiKey, tryParams, callEndpoint]);

  const [pdfLoading, setPdfLoading] = useState(false);

  const handleDownloadPdf = useCallback(async () => {
    setPdfLoading(true);
    try {
      await downloadApiDocsPdf({
        endpointUrl: ENDPOINT_URL,
        params: PARAMS,
        fields: FIELDS,
        // Only embed a sample when one has already loaded successfully.
        sampleResponse:
          sample && sample.status >= 200 && sample.status < 300 ? sample.body : undefined,
      });
      toast.success("API documentation downloaded");
    } catch (e) {
      console.error("Failed to build API docs PDF:", e);
      toast.error("Could not generate the PDF. Please try again.");
    } finally {
      setPdfLoading(false);
    }
  }, [sample]);

  const displayKey = reveal ? apiKey : maskKey(apiKey);

  const curlSnippet = useMemo(() => {
    const key = reveal && apiKey ? apiKey : "YOUR_API_KEY";
    return `# Records ready to synchronise, changed since the last run
curl -X GET '${ENDPOINT_URL}?status=completed&updatedSince=2026-07-01T00:00:00Z&page=1&limit=500' \\
  -H 'Authorization: Bearer ${key}'`;
  }, [reveal, apiKey]);

  const jsSnippet = useMemo(() => {
    const key = reveal && apiKey ? apiKey : "YOUR_API_KEY";
    return `const params = new URLSearchParams({
  status: "completed",        // only records ready to sync
  updatedSince: lastRunIso,   // incremental — omit for a full pull
  page: "1",
  limit: "500",
});

const res = await fetch(\`${ENDPOINT_URL}?\${params}\`, {
  headers: { "Authorization": "Bearer ${key}" },
});
const { data, pagination } = await res.json();`;
  }, [reveal, apiKey]);

  return (
    <DashboardLayout
      currentRoute="end-user-records"
      title="End User Records API"
      description="Public API for external integrations"
    >
      <div className="p-6 space-y-4 max-w-5xl">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <PageHeader
            icon={Plug}
            title="End User Records API"
            description="Retrieve every End User Record — including all the fields shown in the details modal — over authenticated HTTP."
          />
          {isSuperAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-none shrink-0"
              onClick={handleDownloadPdf}
              disabled={pdfLoading}
            >
              {pdfLoading ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-1.5" />
              )}
              Download PDF
            </Button>
          )}
        </div>

        {!isSuperAdmin && (
          <div className="p-4 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            Super admin access required to view this page.
          </div>
        )}

        {isSuperAdmin && (
          <>
            {/* Endpoint card */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
              <h2 className="text-base font-semibold text-gray-800">Endpoint</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-[#4a5d0f] text-white">GET</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-[#4a5d0f] text-white">POST</span>
                <code className="flex-1 text-xs font-mono bg-gray-50 border border-gray-200 rounded px-2 py-1.5 break-all">
                  {ENDPOINT_URL}
                </code>
                <Button variant="outline" size="sm" className="h-8 rounded-none" onClick={() => copy(ENDPOINT_URL, "Endpoint URL copied", toast.success)}>
                  <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                </Button>
              </div>
              <p className="text-sm text-gray-600">
                Returns a paginated list of end user records. All filters can be supplied as query parameters (GET) or a JSON body (POST).
              </p>
            </div>

            {/* Auth card */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
              <h2 className="text-base font-semibold text-gray-800">Authentication</h2>
              <p className="text-sm text-gray-600">
                Every request must include a bearer API key. Never expose this key in browser code — keep it in your server or integration platform.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono bg-gray-50 border border-gray-200 rounded px-2 py-1.5 break-all">
                  Authorization: Bearer {keyLoading ? "…" : keyError ? "(unavailable)" : displayKey}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-none"
                  onClick={() => setReveal((v) => !v)}
                  disabled={!apiKey}
                >
                  {reveal ? <EyeOff className="h-3.5 w-3.5 mr-1" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
                  {reveal ? "Hide" : "Reveal"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-none"
                  onClick={() => copy(apiKey, "API key copied", toast.success)}
                  disabled={!apiKey}
                >
                  <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                </Button>
              </div>
              {keyError && <p className="text-sm text-red-600">{keyError}</p>}
            </div>

            {/* Parameters */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
              <h2 className="text-base font-semibold text-gray-800">Query parameters</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#4a5d0f] text-white">
                      <th className="text-left font-semibold py-2 px-2">Name</th>
                      <th className="text-left font-semibold py-2 px-2">Type</th>
                      <th className="text-left font-semibold py-2 px-2">Required</th>
                      <th className="text-left font-semibold py-2 px-2">Default</th>
                      <th className="text-left font-semibold py-2 px-2">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PARAMS.map((p) => (
                      <tr key={p.name} className="border-b border-gray-100 align-top">
                        <td className="py-2 px-2 font-mono text-xs">{p.name}</td>
                        <td className="py-2 px-2 text-gray-600">{p.type}</td>
                        <td className="py-2 px-2 text-gray-600">{p.required ? "yes" : "no"}</td>
                        <td className="py-2 px-2 text-gray-600 font-mono text-xs">{p.default || "—"}</td>
                        <td className="py-2 px-2 text-gray-600">{p.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Example request */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-800">Example request</h2>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-gray-500">cURL</span>
                    <Button variant="ghost" size="sm" className="h-7 px-2 rounded-none" onClick={() => copy(curlSnippet, "cURL copied", toast.success)}>
                      <Copy className="h-3 w-3 mr-1" /> Copy
                    </Button>
                  </div>
                  <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">{curlSnippet}</pre>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-gray-500">JavaScript (fetch)</span>
                    <Button variant="ghost" size="sm" className="h-7 px-2 rounded-none" onClick={() => copy(jsSnippet, "Snippet copied", toast.success)}>
                      <Copy className="h-3 w-3 mr-1" /> Copy
                    </Button>
                  </div>
                  <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">{jsSnippet}</pre>
                </div>
              </div>
            </div>

            {/* Example response */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-800">Example response</h2>
                <Button variant="outline" size="sm" className="h-8 rounded-none" onClick={loadSample} disabled={sampleLoading || !apiKey}>
                  {sampleLoading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                  Refresh sample
                </Button>
              </div>
              {sample && (
                <div className="flex items-center gap-3 text-xs text-gray-600">
                  {sample.status >= 200 && sample.status < 300 ? (
                    <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="h-3.5 w-3.5" /> {sample.status} OK</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-red-700"><XCircle className="h-3.5 w-3.5" /> {sample.status}</span>
                  )}
                  <span>{sample.ms} ms</span>
                </div>
              )}
              <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-3 overflow-auto max-h-96">
                {sampleLoading
                  ? "Fetching sample response…"
                  : sample?.body
                    ? sample.body
                    : keyLoading
                      ? "Waiting for API key…"
                      : keyError
                        ? `Cannot load sample — ${keyError}`
                        : !apiKey
                          ? "Sample unavailable — API key not loaded."
                          : "No sample yet. Click Refresh sample."}
              </pre>
            </div>

            {/* Try it */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-800">Try it</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-none text-gray-600"
                  onClick={() => { setTryParams(DEFAULT_TRY); setTryResult(null); }}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {/* Page */}
                <div>
                  <Label className="text-xs">page</Label>
                  <Input
                    type="number"
                    min={1}
                    className="h-9 text-sm bg-white shadow-none"
                    value={tryParams.page || ""}
                    onChange={(e) => setTryParams((s) => ({ ...s, page: e.target.value }))}
                  />
                </div>

                {/* Limit */}
                <div>
                  <Label className="text-xs">limit</Label>
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    className="h-9 text-sm bg-white shadow-none"
                    value={tryParams.limit || ""}
                    onChange={(e) => setTryParams((s) => ({ ...s, limit: e.target.value }))}
                  />
                </div>

                {/* Status */}
                <div>
                  <Label className="text-xs">status</Label>
                  <Select
                    value={tryParams.status || "__all__"}
                    onValueChange={(v) =>
                      setTryParams((s) => ({ ...s, status: v === "__all__" ? "" : v }))
                    }
                  >
                    <SelectTrigger className="h-9 text-sm bg-white shadow-none">
                      <SelectValue placeholder="Any status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Any status</SelectItem>
                      <SelectItem value="completed">completed (ready to sync)</SelectItem>
                      <SelectItem value="pending">pending</SelectItem>
                      <SelectItem value="incomplete">incomplete</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Stove serial */}
                <div>
                  <Label className="text-xs">stove_serial_no</Label>
                  <Input
                    className="h-9 text-sm bg-white shadow-none"
                    placeholder="Exact serial"
                    value={tryParams.stove_serial_no || ""}
                    onChange={(e) =>
                      setTryParams((s) => ({ ...s, stove_serial_no: e.target.value }))
                    }
                  />
                </div>

                {/* State */}
                <div>
                  <Label className="text-xs">state</Label>
                  <Select
                    value={tryParams.state || "__all__"}
                    onValueChange={(v) =>
                      setTryParams((s) => ({
                        ...s,
                        state: v === "__all__" ? "" : v,
                        lga: "", // reset LGA when state changes
                      }))
                    }
                  >
                    <SelectTrigger className="h-9 text-sm bg-white shadow-none">
                      <SelectValue placeholder="Any state" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="__all__">Any state</SelectItem>
                      {geo.states.map((st) => (
                        <SelectItem key={st} value={st}>{st}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* LGA */}
                <div>
                  <Label className="text-xs">lga</Label>
                  <Select
                    value={tryParams.lga || "__all__"}
                    onValueChange={(v) =>
                      setTryParams((s) => ({ ...s, lga: v === "__all__" ? "" : v }))
                    }
                    disabled={!tryParams.state}
                  >
                    <SelectTrigger className="h-9 text-sm bg-white shadow-none">
                      <SelectValue placeholder={tryParams.state ? "Any LGA" : "Select state first"} />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="__all__">Any LGA</SelectItem>
                      {(geo.lgas[tryParams.state] || []).map((l) => (
                        <SelectItem key={l} value={l}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Partner */}
                <div>
                  <Label className="text-xs">partner_id</Label>
                  <Select
                    value={tryParams.partner_id || "__all__"}
                    onValueChange={(v) =>
                      setTryParams((s) => ({ ...s, partner_id: v === "__all__" ? "" : v }))
                    }
                  >
                    <SelectTrigger className="h-9 text-sm bg-white shadow-none">
                      <SelectValue placeholder={partners.length ? "Any partner" : "Loading…"} />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="__all__">Any partner</SelectItem>
                      {partners.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Date from */}
                <div>
                  <Label className="text-xs">dateFrom</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "h-9 w-full justify-start text-left font-normal rounded-md bg-white shadow-none text-sm",
                          !tryParams.dateFrom && "text-muted-foreground",
                        )}
                      >
                        <CalendarIcon className="h-3.5 w-3.5 mr-2" />
                        {tryParams.dateFrom ? format(new Date(tryParams.dateFrom), "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={tryParams.dateFrom ? new Date(tryParams.dateFrom) : undefined}
                        onSelect={(d) =>
                          setTryParams((s) => ({
                            ...s,
                            dateFrom: d ? format(d, "yyyy-MM-dd") : "",
                          }))
                        }
                        disabled={(d) =>
                          tryParams.dateTo ? d > new Date(tryParams.dateTo) : false
                        }
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Date to */}
                <div>
                  <Label className="text-xs">dateTo</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "h-9 w-full justify-start text-left font-normal rounded-md bg-white shadow-none text-sm",
                          !tryParams.dateTo && "text-muted-foreground",
                        )}
                      >
                        <CalendarIcon className="h-3.5 w-3.5 mr-2" />
                        {tryParams.dateTo ? format(new Date(tryParams.dateTo), "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={tryParams.dateTo ? new Date(tryParams.dateTo) : undefined}
                        onSelect={(d) =>
                          setTryParams((s) => ({
                            ...s,
                            dateTo: d ? format(d, "yyyy-MM-dd") : "",
                          }))
                        }
                        disabled={(d) => {
                          const isFuture = d > new Date();
                          const beforeFrom = tryParams.dateFrom
                            ? d < new Date(tryParams.dateFrom)
                            : false;
                          return isFuture || beforeFrom;
                        }}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Updated since */}
                <div>
                  <Label className="text-xs">updatedSince</Label>
                  <Input
                    className="h-9 text-sm bg-white shadow-none"
                    placeholder="2026-07-01T00:00:00Z"
                    value={tryParams.updatedSince || ""}
                    onChange={(e) =>
                      setTryParams((s) => ({ ...s, updatedSince: e.target.value }))
                    }
                  />
                </div>

                {/* Search */}
                <div className="md:col-span-2">
                  <Label className="text-xs">search</Label>
                  <Input
                    className="h-9 text-sm bg-white shadow-none"
                    placeholder="End-user name, phone, or transaction id"
                    value={tryParams.search || ""}
                    onChange={(e) => setTryParams((s) => ({ ...s, search: e.target.value }))}
                  />
                </div>

                {/* Include cancelled */}
                <div className="flex items-end pb-1">
                  <div className="flex items-center gap-3">
                    <Switch
                      id="include_cancelled"
                      checked={tryParams.include_cancelled === "true"}
                      onCheckedChange={(checked) =>
                        setTryParams((s) => ({
                          ...s,
                          include_cancelled: checked ? "true" : "",
                        }))
                      }
                    />
                    <Label htmlFor="include_cancelled" className="text-xs">
                      Include cancelled
                    </Label>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <Button
                  className="bg-[#4a5d0f] hover:bg-[#3d4d0c] text-white rounded-none"
                  onClick={handleTry}
                  disabled={tryLoading || !apiKey}
                >
                  {tryLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                  Send request
                </Button>
                {!apiKey && !keyLoading && (
                  <span className="text-xs text-red-600">API key not loaded — cannot send.</span>
                )}
                {tryResult && (
                  <div className="text-xs text-gray-600 flex items-center gap-3">
                    {tryResult.status >= 200 && tryResult.status < 300 ? (
                      <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="h-3.5 w-3.5" /> {tryResult.status} OK</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-red-700"><XCircle className="h-3.5 w-3.5" /> {tryResult.status}</span>
                    )}
                    <span>{tryResult.ms} ms</span>
                  </div>
                )}
              </div>
              {tryResult && (
                <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-3 overflow-auto max-h-[500px]">{tryResult.body}</pre>
              )}
            </div>

            {/* Fields reference */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
              <h2 className="text-base font-semibold text-gray-800">Response fields</h2>
              <p className="text-sm text-gray-600">Each item in <code>data</code> contains the full detail-modal payload:</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#4a5d0f] text-white">
                      <th className="text-left font-semibold py-2 px-2">Field</th>
                      <th className="text-left font-semibold py-2 px-2">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FIELDS.map((f) => (
                      <tr key={f.name} className="border-b border-gray-100 align-top">
                        <td className="py-2 px-2 font-mono text-xs whitespace-nowrap">{f.name}</td>
                        <td className="py-2 px-2 text-gray-600">{f.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default ApiEndpointContent;
