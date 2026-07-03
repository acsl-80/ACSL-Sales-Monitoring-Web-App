
import { useState, useRef } from "react";
import DashboardLayout from "../../components/DashboardLayout";
import PageHeader from "../../components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Search,
  Package,
  Loader2,
  AlertCircle,
  XCircle,
  Flame,
  CheckCircle2,
  ChevronLeft,
} from "lucide-react";
import { useAuth } from "../../contexts/useAuth";

// ── Primitives ────────────────────────────────────────────────────────────────
const DetailItem = ({ label, value, highlight }) => (
  <div className="space-y-0">
    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
      {label}
    </p>
    <p className={`text-xs font-medium ${highlight ? "text-blue-600" : ""}`}>
      {value ?? <span className="text-gray-400">N/A</span>}
    </p>
  </div>
);

const SectionCard = ({ title, children, className = "" }) => (
  <div className={`bg-muted/30 rounded-lg p-3 border border-border/50 ${className}`}>
    <h3 className="text-[10px] font-semibold text-primary uppercase tracking-wider border-b border-primary/20 pb-0.5 mb-2">
      {title}
    </h3>
    {children}
  </div>
);

// ── Shimmers ──────────────────────────────────────────────────────────────────
const DetailShimmer = () => (
  <div className="animate-pulse flex gap-6">
    <div className="w-64 flex-shrink-0 space-y-4">
      <div className="bg-gray-200 rounded-2xl h-64 w-full" />
      <div className="bg-gray-200 rounded-lg h-14 w-full" />
      <div className="bg-gray-200 rounded-lg h-10 w-full" />
    </div>
    <div className="flex-1 space-y-3">
      <div className="bg-gray-200 rounded-lg h-14 w-full" />
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-200 rounded-lg h-32" />
        <div className="bg-gray-200 rounded-lg h-32" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-200 rounded-lg h-28" />
        <div className="bg-gray-200 rounded-lg h-28" />
      </div>
      <div className="bg-gray-200 rounded-lg h-20 w-full" />
    </div>
  </div>
);

const ListShimmer = () => (
  <div className="animate-pulse space-y-2">
    <div className="bg-gray-200 rounded-lg h-10 w-1/3" />
    {[...Array(5)].map((_, i) => (
      <div key={i} className="bg-gray-200 rounded-lg h-14 w-full" />
    ))}
  </div>
);

// ── Not found ─────────────────────────────────────────────────────────────────
const UnavailableState = ({ isSuperAdmin, searchedId }) => (
  <div className="flex flex-col items-center justify-center py-20 gap-4">
    <div className="p-5 bg-red-50 rounded-full">
      {isSuperAdmin ? (
        <XCircle className="h-14 w-14 text-red-400" />
      ) : (
        <AlertCircle className="h-14 w-14 text-amber-400" />
      )}
    </div>
    <div className="text-center space-y-2">
      <p className="text-xl font-bold text-gray-800">
        {isSuperAdmin ? "Stove Does Not Exist" : "Stove Unavailable"}
      </p>
      <p className="text-gray-500 text-sm max-w-xs">
        {isSuperAdmin
          ? `No stove with ID "${searchedId}" was found in the system.`
          : `Stove ID "${searchedId}" is not available or does not belong to you.`}
      </p>
    </div>
  </div>
);

// ── Reference result list ─────────────────────────────────────────────────────
const ReferenceList = ({ stoves, salesReference, onSelect }) => {
  const soldCount = stoves.filter((s) => s.status === "sold").length;
  const availableCount = stoves.filter((s) => s.status === "available").length;

  return (
    <div className="space-y-4">
      <div className="px-4 py-3 bg-gradient-to-r from-blue-50/80 to-sky-50/80 border rounded-lg flex items-center justify-between">
        <div>
          <p className="text-base font-bold text-foreground">Sales Reference</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ref:{" "}
            <span className="font-semibold text-primary font-mono">{salesReference}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="bg-blue-100 text-blue-800 border border-blue-200 px-2 py-1 rounded-md font-medium">
            {soldCount} Sold
          </span>
          <span className="bg-green-100 text-green-800 border border-green-200 px-2 py-1 rounded-md font-medium">
            {availableCount} Available
          </span>
          <span className="bg-gray-100 text-gray-700 border border-gray-200 px-2 py-1 rounded-md font-medium">
            {stoves.length} Total
          </span>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="grid grid-cols-5 gap-3 px-4 py-2 bg-brand text-white text-xs font-semibold">
          <span>Stove ID</span>
          <span>Status</span>
          <span>Partner</span>
          <span>Branch / State</span>
          <span>Date Sold / Customer</span>
        </div>
        {stoves.map((stove, idx) => (
          <button
            key={stove.id || stove.stove_id}
            onClick={() => onSelect(stove.stove_id)}
            className={`grid grid-cols-5 gap-3 px-4 py-3 w-full text-left text-xs hover:bg-brand/5 transition-colors border-b border-gray-100 last:border-0 ${
              idx % 2 === 0 ? "bg-white" : "bg-blue-50/30"
            }`}
          >
            <span className="font-mono font-semibold text-gray-900">{stove.stove_id}</span>
            <span>
              <Badge
                className={
                  stove.status === "sold"
                    ? "bg-blue-100 text-blue-800 border-blue-200 text-[10px]"
                    : "bg-green-100 text-green-800 border-green-200 text-[10px]"
                }
              >
                {stove.status.charAt(0).toUpperCase() + stove.status.slice(1)}
              </Badge>
            </span>
            <span className="text-gray-600 truncate">{stove.organization_name || "—"}</span>
            <span className="text-gray-600 truncate">
              {[stove.branch, stove.location].filter(Boolean).join(" / ") || "—"}
            </span>
            <span className="text-gray-600 truncate">
              {stove.status === "sold"
                ? stove.sold_to
                  ? stove.sold_to
                  : stove.sale_date
                  ? new Date(stove.sale_date).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })
                  : "—"
                : "—"}
            </span>
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-400 text-center">
        Click any row to view full stove details
      </p>
    </div>
  );
};

// ── Search bar shared component ───────────────────────────────────────────────
function SearchBar({ query, onChange, onKeyDown, onClear, searching, inputRef, size = "default" }) {
  const isLarge = size === "large";
  return (
    <div className={`flex items-center gap-2 ${isLarge ? "w-full max-w-xl" : ""}`}>
      <div className="relative flex-1">
        <Search
          className={`absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 ${
            isLarge ? "h-5 w-5" : "h-4 w-4"
          }`}
        />
        <Input
          ref={inputRef}
          value={query}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder="Enter stove ID."
          className={`pl-10 pr-8 border-gray-300 focus:border-brand focus:ring-brand ${
            isLarge ? "h-12 text-base w-full rounded-full shadow-sm" : "h-9 pr-8 w-64 text-sm"
          }`}
        />
        {query && (
          <button
            onClick={onClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {searching ? (
              <Loader2 className={`animate-spin ${isLarge ? "h-4 w-4" : "h-3.5 w-3.5"}`} />
            ) : (
              <XCircle className={isLarge ? "h-4 w-4" : "h-3.5 w-3.5"} />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function StoveManagerContent() {
  const { supabase, isSuperAdmin, isAcslAgent } = useAuth();

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchedId, setSearchedId] = useState("");

  // result type: "stove" | "reference" | null
  const [resultType, setResultType] = useState(null);

  // Stove detail result
  const [stove, setStove] = useState(null);
  const [sale, setSale] = useState(null);

  // Reference list result
  const [referenceStoves, setReferenceStoves] = useState([]);
  const [selectedStoveId, setSelectedStoveId] = useState(null);
  const [drillStove, setDrillStove] = useState(null);
  const [drillSale, setDrillSale] = useState(null);
  const [drilling, setDrilling] = useState(false);

  const inputRef = useRef(null);
  const centeredInputRef = useRef(null);

  const hasResult = stove !== null || referenceStoves.length > 0;

  const getSession = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("No authentication token");
    return session;
  };

  const fetchStoveById = async (id, token) => {
    const baseUrl = import.meta.env.VITE_SUPABASE_URL;
    const res = await fetch(
      `${baseUrl}/functions/v1/stove-lookup?stove_id=${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return res.json();
  };

  const fetchByReference = async (ref, token) => {
    const baseUrl = import.meta.env.VITE_SUPABASE_URL;
    const params = new URLSearchParams({
      sales_reference: ref,
      page: "1",
      page_size: "200",
      sort_by: "stove_id",
      sort_dir: "asc",
    });
    const res = await fetch(`${baseUrl}/functions/v1/manage-stove-ids?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
  };

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setSearching(true);
    setSearched(false);
    setStove(null);
    setSale(null);
    setReferenceStoves([]);
    setResultType(null);
    setSelectedStoveId(null);
    setDrillStove(null);
    setDrillSale(null);
    setSearchedId(trimmed);

    try {
      const session = await getSession();
      const token = session.access_token;

      // 1. Try stove ID first
      const stoveResult = await fetchStoveById(trimmed, token);
      if (stoveResult.found) {
        setStove(stoveResult.stove);
        setSale(stoveResult.sale || null);
        setResultType("stove");
        return;
      }

      // 2. Super admin only: silently try sales reference
      if (isSuperAdmin) {
        const refResult = await fetchByReference(trimmed, token);
        const rows = refResult.data || [];
        if (rows.length > 0) {
          setReferenceStoves(rows);
          setResultType("reference");
          return;
        }
      }

      // 3. Nothing found
      setResultType(null);
    } catch {
      setResultType(null);
    } finally {
      setSearching(false);
      setSearched(true);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleClear = () => {
    setQuery("");
    setSearched(false);
    setSearchedId("");
    setStove(null);
    setSale(null);
    setReferenceStoves([]);
    setResultType(null);
    setSelectedStoveId(null);
    setDrillStove(null);
    setDrillSale(null);
  };

  const handleSelectFromList = async (stoveSerial) => {
    setSelectedStoveId(stoveSerial);
    setDrilling(true);
    setDrillStove(null);
    setDrillSale(null);
    try {
      const session = await getSession();
      const result = await fetchStoveById(stoveSerial, session.access_token);
      if (result.found) {
        setDrillStove(result.stove);
        setDrillSale(result.sale || null);
      }
    } catch {
      // leave null
    } finally {
      setDrilling(false);
    }
  };

  const sharedSearchProps = {
    query,
    onChange: (e) => setQuery(e.target.value),
    onKeyDown: handleKeyDown,
    onClear: handleClear,
    searching,
  };

  return (
    <DashboardLayout currentRoute="stove-manager" title="Stove Manager">
      <div className="p-6 space-y-5">
        {/* Header — search only visible when there's a result */}
        <PageHeader
          icon={Package}
          title="Stove Manager"
          right={
            hasResult ? (
              <SearchBar {...sharedSearchProps} inputRef={inputRef} size="default" />
            ) : null
          }
        />

        {/* Results area */}
        <div className="min-h-[400px]">
          {/* Centered search — shown when no result yet (idle or not-found) */}
          {!hasResult && (
            <div className="flex flex-col items-center justify-center py-16 gap-6">
              <div className="flex flex-col items-center gap-3">
                <div className="p-5 bg-brand/10 rounded-full">
                  <Package className="h-14 w-14 text-brand/60" />
                </div>
                <p className="text-xl font-semibold text-gray-700">Search for a Stove</p>
                <p className="text-gray-400 text-sm text-center max-w-sm">
                  Enter a stove ID to look up its details, status, and sale information.
                </p>
              </div>

              <SearchBar
                {...sharedSearchProps}
                inputRef={centeredInputRef}
                size="large"
              />

              {/* Not found message — stays centered */}
              {searched && !searching && (
                <div className="flex flex-col items-center gap-3 mt-2">
                  <div className="p-4 bg-red-50 rounded-full">
                    {isSuperAdmin ? (
                      <XCircle className="h-10 w-10 text-red-400" />
                    ) : (
                      <AlertCircle className="h-10 w-10 text-amber-400" />
                    )}
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-lg font-bold text-gray-800">
                      {isSuperAdmin ? "Stove Does Not Exist" : "Stove Unavailable"}
                    </p>
                    <p className="text-gray-500 text-sm max-w-xs">
                      {isSuperAdmin
                        ? `No stove with ID "${searchedId}" was found in the system.`
                        : `Stove ID "${searchedId}" is not available or does not belong to you.`}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Loading */}
          {searching && (
            <div className="py-8">
              {resultType === "reference" ? <ListShimmer /> : <DetailShimmer />}
            </div>
          )}

          {/* Stove detail result */}
          {!searching && hasResult && resultType === "stove" && stove && (
            <StoveDetail
              stove={stove}
              sale={sale}
              isSuperAdmin={isSuperAdmin}
              isAcslAgent={isAcslAgent}
            />
          )}

          {/* Reference list result */}
          {!searching && hasResult && resultType === "reference" && (
            <>
              {selectedStoveId ? (
                <div className="space-y-4">
                  <button
                    onClick={() => {
                      setSelectedStoveId(null);
                      setDrillStove(null);
                      setDrillSale(null);
                    }}
                    className="flex items-center gap-1.5 text-sm text-brand hover:text-brand/80 font-medium"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Back to results for "{searchedId}"
                    <span className="ml-1 text-gray-400 font-normal">
                      ({referenceStoves.length} stoves)
                    </span>
                  </button>
                  {drilling ? (
                    <DetailShimmer />
                  ) : drillStove ? (
                    <StoveDetail
                      stove={drillStove}
                      sale={drillSale}
                      isSuperAdmin={isSuperAdmin}
                      isAcslAgent={isAcslAgent}
                    />
                  ) : (
                    <UnavailableState isSuperAdmin={isSuperAdmin} searchedId={selectedStoveId} />
                  )}
                </div>
              ) : (
                <ReferenceList
                  stoves={referenceStoves}
                  salesReference={searchedId}
                  onSelect={handleSelectFromList}
                />
              )}
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

// ── Full stove detail view ────────────────────────────────────────────────────
function StoveDetail({ stove, sale, isSuperAdmin, isAcslAgent }) {
  const isSold = stove.status === "sold";

  const formatDate = (dateStr) => {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return null;
    }
  };

  const formatCurrency = (amount) => {
    if (amount == null) return null;
    return `₦${Number(amount).toLocaleString("en-NG")}`;
  };

  const statusBadge = isSold ? (
    <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-[10px]">Sold</Badge>
  ) : (
    <Badge className="bg-green-100 text-green-800 border-green-200 text-[10px]">Available</Badge>
  );

  const stoveImageUrl = sale?.stove_image?.url;
  const agreementImageUrl = sale?.agreement_image?.url;
  const address = sale?.address;
  const isInstallment = sale?.is_installment === true;
  const totalPaid = sale?.total_paid ?? 0;
  const saleAmount = sale?.amount ?? 0;
  const remainingBalance = saleAmount - totalPaid;
  const progressPercent = saleAmount > 0 ? (totalPaid / saleAmount) * 100 : 0;
  const isFullyPaid = sale?.payment_status === "fully_paid";

  const creatorName =
    sale?.creator?.full_name || sale?.agent_name || null;

  const previousStoveLabel =
    sale?.previous_stove_type === "wood_stove"
      ? "Wood Stove (3 stone)"
      : sale?.previous_stove_type === "charcoal"
      ? "Charcoal Stove"
      : sale?.previous_stove_type === "other"
      ? `Other — ${sale.previous_stove_other || "not specified"}`
      : sale?.previous_stove_type || null;

  const hasStoveSet =
    sale &&
    (sale.pot_quantity != null || sale.heat_retention_device != null || sale.previous_stove_type);

  return (
    <div className="flex gap-6">
      {/* Left: image + quick info */}
      <div className="w-64 flex-shrink-0 space-y-3">
        {stoveImageUrl ? (
          <img
            src={stoveImageUrl}
            alt="Stove"
            className="w-full h-64 object-cover rounded-2xl border border-gray-200"
          />
        ) : (
          <div
            className={`w-full h-64 rounded-2xl flex flex-col items-center justify-center gap-3 border-2 ${
              isSold
                ? "bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200"
                : "bg-gradient-to-br from-green-50 to-emerald-100 border-green-200"
            }`}
          >
            <div className={`p-5 rounded-full ${isSold ? "bg-blue-200/60" : "bg-green-200/60"}`}>
              <Flame className={`h-14 w-14 ${isSold ? "text-blue-600" : "text-green-600"}`} />
            </div>
            <p className={`text-sm font-semibold ${isSold ? "text-blue-700" : "text-green-700"}`}>
              Atmosfair Clean Stove
            </p>
          </div>
        )}

        {agreementImageUrl && (
          <SectionCard title="Documents">
            <div className="space-y-1.5">
              <DetailItem
                label="Agreement Image"
                value={
                  <a
                    href={agreementImageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline"
                  >
                    View Image
                  </a>
                }
              />
              {sale?.signature && (
                <DetailItem
                  label="Signature"
                  value={
                    <img
                      src={`data:image/png;base64,${sale.signature}`}
                      alt="Signature"
                      className="h-8 w-24 object-contain border border-gray-200 rounded bg-white cursor-pointer hover:opacity-80"
                      onClick={() => {
                        const win = window.open();
                        win.document.write(`<img src="data:image/png;base64,${sale.signature}" style="max-width:100%" />`);
                      }}
                    />
                  }
                />
              )}
            </div>
          </SectionCard>
        )}

        <SectionCard title="Stove ID">
          <div className="space-y-2">
            <DetailItem label="ID" value={<span className="font-mono">{stove.stove_id}</span>} />
            <DetailItem label="Status" value={statusBadge} />
            <DetailItem label="Registered" value={formatDate(stove.created_at)} />
            {!isAcslAgent && stove.sales_reference && (
              <DetailItem label="Sales Ref." value={stove.sales_reference} />
            )}
          </div>
        </SectionCard>
      </div>

      {/* Right: detail sections */}
      <div className="flex-1 space-y-3 min-w-0">
        <div className="px-4 py-3 bg-gradient-to-r from-blue-50/80 to-sky-50/80 border rounded-lg flex items-center justify-between">
          <div>
            <p className="text-base font-bold text-foreground">Stove Details</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Stove ID:{" "}
              <span className="font-semibold text-primary font-mono">{stove.stove_id}</span>
              {sale?.transaction_id && (
                <>
                  {" "}
                  · Transaction:{" "}
                  <span className="font-semibold text-primary">{sale.transaction_id}</span>
                </>
              )}
            </p>
          </div>
          {statusBadge}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <SectionCard title="Stove Information">
            <div className="grid grid-cols-2 gap-2">
              {sale?.stove_serial_no && <DetailItem label="Serial No." value={sale.stove_serial_no} />}
              {(sale?.sales_date || stove.sale_date) && (
                <DetailItem label="Sale Date" value={formatDate(sale?.sales_date || stove.sale_date)} />
              )}
              <DetailItem label="Registered" value={formatDate(stove.created_at)} />
              {creatorName && <DetailItem label="Agent" value={creatorName} />}
              {sale && (
                <DetailItem
                  label="Payment Type"
                  value={
                    isInstallment ? (
                      <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-[10px] px-1.5 py-0">
                        Installment
                      </Badge>
                    ) : (
                      <Badge className="bg-green-100 text-green-800 border-green-200 text-[10px] px-1.5 py-0">
                        Full Payment
                      </Badge>
                    )
                  }
                />
              )}
              {!isAcslAgent && stove.sales_reference && (
                <DetailItem label="Sales Ref." value={stove.sales_reference} />
              )}
            </div>
          </SectionCard>

          <SectionCard title="Organization">
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <DetailItem label="Partner Name" value={stove.organization_name} />
              </div>
              <DetailItem label="Branch" value={stove.branch} />
              <DetailItem label="State" value={stove.location || stove.state} />
              <div className="col-span-2">
                <DetailItem label="Address" value={stove.address} />
              </div>
              <DetailItem label="Contact Name" value={stove.contact_name} />
              <DetailItem label="Contact Phone" value={stove.contact_phone} />
            </div>
          </SectionCard>
        </div>

        {isSold && (
          <div className="grid grid-cols-2 gap-3">
            <SectionCard title="Customer Details">
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <DetailItem label="Customer Name" value={sale?.end_user_name || stove.sold_to} />
                </div>
                <DetailItem label="AKA" value={sale?.aka} />
                <DetailItem label="Phone" value={sale?.phone} />
                <DetailItem label="Other Phone" value={sale?.other_phone} />
                <DetailItem label="Contact Person" value={sale?.contact_person} />
                <DetailItem label="Contact Phone" value={sale?.contact_phone} />
                {sale?.retailer_branch && (
                  <div className="col-span-2">
                    <DetailItem
                      label="Retailer / Branch / Agency / CSO"
                      value={sale.retailer_branch}
                    />
                  </div>
                )}
              </div>
            </SectionCard>

            <SectionCard title="Location">
              <div className="grid grid-cols-2 gap-2">
                <DetailItem label="State" value={sale?.state_backup || stove.location} />
                <DetailItem label="LGA" value={sale?.lga_backup} />
                <DetailItem label="City" value={address?.city} />
                <DetailItem label="Country" value={address?.country} />
                <div className="col-span-2">
                  <DetailItem
                    label="Address"
                    value={address?.full_address || address?.street || sale?.end_user_address}
                  />
                </div>
                {address?.latitude && <DetailItem label="Latitude" value={address.latitude} />}
                {address?.longitude && <DetailItem label="Longitude" value={address.longitude} />}
              </div>
            </SectionCard>
          </div>
        )}

        {isSold && sale && (
          <div className="bg-gradient-to-r from-blue-50/50 to-green-50/50 rounded-lg p-3 border border-primary/10">
            <h3 className="text-[10px] font-semibold text-primary uppercase tracking-wider border-b border-primary/20 pb-0.5 mb-2">
              Financial Details
            </h3>
            <div className="grid grid-cols-4 gap-3">
              <DetailItem label="Total Amount" value={formatCurrency(saleAmount)} highlight />
              <DetailItem
                label="Amount Paid"
                value={
                  <span className="text-green-600 font-semibold">
                    {formatCurrency(isInstallment ? totalPaid : saleAmount)}
                  </span>
                }
              />
              <DetailItem
                label="Amount Owed"
                value={
                  <span className={remainingBalance > 0 ? "text-red-600 font-semibold" : "text-green-600"}>
                    {formatCurrency(isInstallment ? remainingBalance : 0)}
                  </span>
                }
              />
              <DetailItem
                label="Payment Status"
                value={
                  !isInstallment || isFullyPaid ? (
                    <Badge className="bg-green-100 text-green-800 border-green-200 text-[10px]">Paid</Badge>
                  ) : totalPaid > 0 ? (
                    <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">Partial</Badge>
                  ) : (
                    <Badge className="bg-red-100 text-red-800 border-red-200 text-[10px]">Unpaid</Badge>
                  )
                }
              />
              {isInstallment && sale.payment_model && (
                <>
                  <DetailItem label="Payment Model" value={sale.payment_model.name} />
                  <DetailItem label="Duration" value={`${sale.payment_model.duration_months} months`} />
                  <DetailItem
                    label="Installment Price"
                    value={formatCurrency(sale.payment_model.fixed_price)}
                  />
                  <DetailItem label="Progress" value={`${progressPercent.toFixed(0)}% complete`} />
                </>
              )}
            </div>
            {isInstallment && (
              <div className="mt-3 space-y-1">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{formatCurrency(totalPaid)} paid</span>
                  <span>{formatCurrency(remainingBalance)} remaining</span>
                </div>
                <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${isFullyPaid ? "bg-green-500" : "bg-brand"}`}
                    style={{ width: `${Math.min(progressPercent, 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {isSold && hasStoveSet && (
          <div className="grid grid-cols-2 gap-3">
            <SectionCard title="Stove Set">
              <div className="grid grid-cols-2 gap-2">
                <DetailItem
                  label="Pots Quantity"
                  value={
                    sale.pot_quantity != null
                      ? `${sale.pot_quantity} pot${sale.pot_quantity !== 1 ? "s" : ""}`
                      : null
                  }
                />
                <DetailItem
                  label="Wonderbox (Heat Retention)"
                  value={
                    sale.heat_retention_device != null
                      ? sale.heat_retention_device
                        ? "Yes"
                        : "No"
                      : null
                  }
                />
              </div>
            </SectionCard>
            <SectionCard title="Cooking Habits">
              <div className="grid grid-cols-1 gap-2">
                <DetailItem label="Previous Stove" value={previousStoveLabel} />
                <DetailItem label="Meals Per Day" value={sale?.meals_per_day} />
                <DetailItem label="Fuel Source" value={sale?.cooking_fuel_source} />
                <DetailItem label="Cooking Location" value={sale?.cooking_location} />
              </div>
            </SectionCard>
          </div>
        )}

        {isSold && sale?.terms_accepted && (
          <SectionCard title="Terms & Conditions">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {[
                { key: "poaGoverned", label: "PoA / UNFCCC governed" },
                { key: "monitoring", label: "Agreed to monitoring" },
                { key: "noResell", label: "Agreed not to resell" },
                { key: "emissionReductions", label: "Ceded emission reductions" },
                { key: "noExport", label: "Agreed not to export" },
                { key: "demonstration", label: "Received demonstration" },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center gap-1.5">
                  {sale.terms_accepted?.[key] ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
                  )}
                  <span className="text-xs text-gray-700">{label}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {isSold && sale?.notes && (
          <SectionCard title="Notes">
            <p className="text-xs text-gray-700">{sale.notes}</p>
          </SectionCard>
        )}

        {isSold && !sale && (
          <div className="grid grid-cols-2 gap-3">
            <SectionCard title="Customer Details">
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <DetailItem label="Customer Name" value={stove.sold_to} />
                </div>
                <DetailItem label="Sale Date" value={formatDate(stove.sale_date)} />
              </div>
            </SectionCard>
          </div>
        )}
      </div>
    </div>
  );
}
