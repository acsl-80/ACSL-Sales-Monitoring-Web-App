import { useEffect, useMemo, useState } from "react";
import { useRealtimeRefresh, useRefreshListener } from "../hooks/useRealtimeRefresh";
import { useStatesPerformance, type StoveStatus } from "../hooks/useStatesPerformance";
import StateStovesModal from "./StateStovesModal";
import { Kpi, Pill, SortableTh } from "./reportBits";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Search,
  MapPin,
  Building2,
  Package,
  CheckCircle2,
  Circle,
  Download,
  Loader2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Phone,
  X,
} from "lucide-react";
import { downloadCSV } from "@/utils/csvExportUtils";

/**
 * The tables behind the report. A change on any of them, debounced by the
 * realtime hook, invalidates the query; the view names the base table
 * because realtime never fires for a view.
 */
const REALTIME_STATE_TABLES = [
  "organizations",
  "profiles",
  "acsl_agent_organizations",
  "acsl_agent_states",
  "acsl_agent_scope",
  "sales",
  "stove_ids_base",
];

const AGENT_ROLE_LABELS: Record<string, string> = {
  acsl_agent: "ACSL Agent",
  acsl_agent_manager: "ACSL Manager",
  partner: "Partner",
  partner_agent: "Partner Agent",
  agent: "Agent",
  admin: "Admin",
};

function formatNumber(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "0";
  return n.toLocaleString("en-US");
}


type SortKey =
  | "state"
  | "partners"
  | "agents"
  | "stoves"
  | "sold"
  | "notSold"
  | "sellThrough";


const PAGE_SIZES = [10, 25, 50];

export default function StatesPerformanceContent() {
  // The report, its covered states and its loading state come from one query.
  const report = useStatesPerformance();
  const rows = report.rows;
  const loading = report.isPending;
  const error = report.error;
  const agentCoveredStates = report.coveredStates;

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("sold");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Partner detail modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalState, setModalState] = useState<string | null>(null);
  const [modalSearch, setModalSearch] = useState("");
  const [modalPage, setModalPage] = useState(1);
  const [modalPageSize, setModalPageSize] = useState(10);

  // Agent detail modal state
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [agentModalState, setAgentModalState] = useState<string | null>(null);
  const [agentModalSearch, setAgentModalSearch] = useState("");
  const [agentModalPage, setAgentModalPage] = useState(1);
  const [agentModalPageSize, setAgentModalPageSize] = useState(10);

  // Stove detail modal state
  const [stoveModalOpen, setStoveModalOpen] = useState(false);
  const [stoveModalState, setStoveModalState] = useState<string | null>(null);
  const [stoveModalStatus, setStoveModalStatus] = useState<StoveStatus>("all");

  useRealtimeRefresh("states", REALTIME_STATE_TABLES);
  useRefreshListener("states", report.invalidate);


  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? rows.filter((r) => r.state.toLowerCase().includes(q)) : rows;
    const sorted = [...list].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const va = a[sortKey];
      const vb = b[sortKey];
      if (typeof va === "string" && typeof vb === "string") {
        return va.localeCompare(vb) * dir;
      }
      return ((va as number) - (vb as number)) * dir;
    });
    return sorted;
  }, [rows, search, sortKey, sortDir]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => {
        acc.partners += r.partners;
        acc.stoves += r.stoves;
        acc.sold += r.sold;
        acc.notSold += r.notSold;
        return acc;
      },
      { partners: 0, stoves: 0, sold: 0, notSold: 0 },
    );
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const start = (clampedPage - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

  useEffect(() => setPage(1), [search, sortKey, sortDir, pageSize]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "state" ? "asc" : "desc");
    }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-50" />;
    return sortDir === "asc" ? (
      <ArrowUp className="ml-1 inline h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 inline h-3 w-3" />
    );
  };

  const handleExport = () => {
    const headers = [
      "State",
      "Partners",
      "Agents (Partner)",
      "Agents (ACSL)",
      "Agents (Total)",
      "Total Stoves",
      "Sold",
      "Not Sold",
      "Sell-through %",
    ];
    const lines = [headers.join(",")].concat(
      filtered.map((r) =>
        [
          `"${r.state.replace(/"/g, '""')}"`,
          r.partners,
          r.partnerAgents,
          r.acslAgents,
          r.agents,
          r.stoves,
          r.sold,
          r.notSold,
          (r.sellThrough * 100).toFixed(1),
        ].join(","),
      ),
    );
    downloadCSV(
      lines.join("\n"),
      `states-performance-${new Date().toISOString().split("T")[0]}.csv`,
    );
  };

  const openPartnerModal = (state: string) => {
    setModalState(state);
    setModalSearch("");
    setModalPage(1);
    setModalPageSize(10);
    setModalOpen(true);
  };

  const closePartnerModal = () => {
    setModalOpen(false);
    setModalState(null);
    setModalSearch("");
    setModalPage(1);
  };

  const modalPartners = useMemo(() => {
    if (!modalState) return [];
    const row = rows.find((r) => r.state === modalState);
    const list = row?.partnerDetails || [];
    const q = modalSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.phone.toLowerCase().includes(q),
    );
  }, [rows, modalState, modalSearch]);

  const modalTotalPages = Math.max(1, Math.ceil(modalPartners.length / modalPageSize));
  const modalClampedPage = Math.min(modalPage, modalTotalPages);
  const modalStart = (modalClampedPage - 1) * modalPageSize;
  const modalPageRows = modalPartners.slice(modalStart, modalStart + modalPageSize);

  useEffect(() => setModalPage(1), [modalSearch, modalPageSize]);

  const handleModalExport = () => {
    const headers = [
      "Partner Name",
      "Phone Number",
      "Total Stoves",
      "Stoves Sold",
      "Stoves Available",
    ];
    const lines = [headers.join(",")].concat(
      modalPartners.map((p) =>
        [
          `"${p.name.replace(/"/g, '""')}"`,
          `"${p.phone.replace(/"/g, '""')}"`,
          p.totalStoves,
          p.stovesSold,
          p.stovesAvailable,
        ].join(","),
      ),
    );
    downloadCSV(
      lines.join("\n"),
      `partners-in-${modalState?.toLowerCase().replace(/\s+/g, "-") || "state"}-${new Date().toISOString().split("T")[0]}.csv`,
    );
  };

  const openAgentModal = (state: string) => {
    setAgentModalState(state);
    setAgentModalSearch("");
    setAgentModalPage(1);
    setAgentModalPageSize(10);
    setAgentModalOpen(true);
  };

  const closeAgentModal = () => {
    setAgentModalOpen(false);
    setAgentModalState(null);
    setAgentModalSearch("");
    setAgentModalPage(1);
  };

  const agentModalRow = useMemo(
    () => (agentModalState ? rows.find((r) => r.state === agentModalState) : undefined),
    [rows, agentModalState],
  );

  const agentModalAgents = useMemo(() => {
    const list = agentModalRow?.agentDetails || [];
    const q = agentModalSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q) ||
        a.statesCovered.some((s) => s.toLowerCase().includes(q)),
    );
  }, [agentModalRow, agentModalSearch]);

  const agentModalTotalPages = Math.max(
    1,
    Math.ceil(agentModalAgents.length / agentModalPageSize),
  );
  const agentModalClampedPage = Math.min(agentModalPage, agentModalTotalPages);
  const agentModalStart = (agentModalClampedPage - 1) * agentModalPageSize;
  const agentModalPageRows = agentModalAgents.slice(
    agentModalStart,
    agentModalStart + agentModalPageSize,
  );

  useEffect(() => setAgentModalPage(1), [agentModalSearch, agentModalPageSize]);

  const handleAgentModalExport = () => {
    const headers = [
      "Agent Name",
      "Role",
      "States Covered (Count)",
      "States Covered",
      "Stoves Recorded (in state)",
      "Total Stoves in State",
      "Unsold Stoves in State",
    ];
    const totalStoves = agentModalRow?.stoves || 0;
    const unsold = agentModalRow?.notSold || 0;
    const lines = [headers.join(",")].concat(
      agentModalAgents.map((a) =>
        [
          `"${a.name.replace(/"/g, '""')}"`,
          `"${a.role}"`,
          a.statesCovered.length,
          `"${a.statesCovered.join("; ").replace(/"/g, '""')}"`,
          a.stovesRecorded,
          totalStoves,
          unsold,
        ].join(","),
      ),
    );
    downloadCSV(
      lines.join("\n"),
      `agents-in-${agentModalState?.toLowerCase().replace(/\s+/g, "-") || "state"}-${new Date().toISOString().split("T")[0]}.csv`,
    );
  };

  // ----- Stove modal -----
  const openStoveModal = (state: string, status: StoveStatus = "all") => {
    setStoveModalState(state);
    setStoveModalStatus(status);
    setStoveModalOpen(true);
  };
  const closeStoveModal = () => {
    setStoveModalOpen(false);
    setStoveModalState(null);
  };
  const stoveModalRow = useMemo(
    () => (stoveModalState ? rows.find((r) => r.state === stoveModalState) : undefined),
    [rows, stoveModalState],
  );



  return (
    <div className="space-y-4 p-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi
          icon={MapPin}
          label="States"
          value={filtered.length}
          tone="blue"
          sub={`${formatNumber(filtered.filter((r) => agentCoveredStates.has(r.state)).length)} of ${formatNumber(filtered.length)} covered by an agent`}
        />

        <Kpi icon={Building2} label="Partners" value={totals.partners} tone="orange" />
        <Kpi icon={Package} label="Stoves" value={totals.stoves} tone="orange" />
        <Kpi icon={CheckCircle2} label="Sold" value={totals.sold} tone="emerald" />
        <Kpi icon={Circle} label="Not Sold" value={totals.notSold} tone="violet" />
      </div>


      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#e5e7eb] bg-white p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search state..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-8 shadow-none"
          />
        </div>
        <Button
          onClick={handleExport}
          disabled={loading || filtered.length === 0}
          className="h-9 bg-[#4a5d0f] text-white hover:bg-[#3a4a0c] shadow-none"
        >
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-[#e5e7eb] bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#4a5d0f] hover:bg-[#4a5d0f]">
              <SortableTh label="State" k="state" sortKey={sortKey} onClick={toggleSort} align="left" icon={<SortIcon k="state" />} />
              <SortableTh label="Partners" k="partners" sortKey={sortKey} onClick={toggleSort} icon={<SortIcon k="partners" />} />
              <SortableTh label="Agents" k="agents" sortKey={sortKey} onClick={toggleSort} icon={<SortIcon k="agents" />} />
              <SortableTh label="Stoves" k="stoves" sortKey={sortKey} onClick={toggleSort} icon={<SortIcon k="stoves" />} />
              <SortableTh label="Sold" k="sold" sortKey={sortKey} onClick={toggleSort} icon={<SortIcon k="sold" />} />
              <SortableTh label="Not Sold" k="notSold" sortKey={sortKey} onClick={toggleSort} icon={<SortIcon k="notSold" />} />
              <SortableTh label="Sell-through" k="sellThrough" sortKey={sortKey} onClick={toggleSort} icon={<SortIcon k="sellThrough" />} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-gray-500">
                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                  Loading states performance...
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-red-600">
                  {error}
                </TableCell>
              </TableRow>
            ) : pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-gray-500">
                  No states found.
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((r) => (
                <TableRow key={r.state} className="border-b text-xs">
                  <TableCell className="align-top font-medium text-gray-800">
                    {r.state}
                  </TableCell>
                  <TableCell className="text-center align-top">
                    <button
                      onClick={() => openPartnerModal(r.state)}
                      className="inline-flex min-w-[2rem] cursor-pointer justify-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-[#eef3c4] text-[#4a5d0f] hover:bg-[#4a5d0f] hover:text-white"
                      title="View partners in this state"
                    >
                      {formatNumber(r.partners)}
                    </button>
                  </TableCell>
                  <TableCell className="text-center align-top">
                    <button
                      onClick={() => openAgentModal(r.state)}
                      className="inline-flex min-w-[2rem] cursor-pointer justify-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-[#eef3c4] text-[#4a5d0f] hover:bg-[#4a5d0f] hover:text-white"
                      title="View agents in this state"
                    >
                      {formatNumber(r.agents)}
                    </button>
                  </TableCell>


                  <TableCell className="text-center align-top">
                    <button
                      onClick={() => openStoveModal(r.state)}
                      className="inline-flex min-w-[2rem] cursor-pointer justify-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-[#4a5d0f] hover:text-white"
                      title="View stove IDs in this state"
                      disabled={r.stoves === 0}
                    >
                      {formatNumber(r.stoves)}
                    </button>
                  </TableCell>
                  <TableCell className="text-center align-top">
                    <button
                      onClick={() => openStoveModal(r.state, "sold")}
                      disabled={r.sold === 0}
                      title="View sold stove IDs in this state"
                      className="disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Pill tone="emerald">{formatNumber(r.sold)}</Pill>
                    </button>
                  </TableCell>
                  <TableCell className="text-center align-top">
                    <button
                      onClick={() => openStoveModal(r.state, "available")}
                      disabled={r.notSold === 0}
                      title="View unsold stove IDs in this state"
                      className="disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Pill tone="rose">{formatNumber(r.notSold)}</Pill>
                    </button>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full bg-[#4a5d0f]"
                          style={{ width: `${Math.round(r.sellThrough * 100)}%` }}
                        />
                      </div>
                      <span className="w-10 text-right text-[11px] text-gray-600">
                        {(r.sellThrough * 100).toFixed(1)}%
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Footer / pagination */}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t bg-white px-4 py-2 text-xs text-gray-600">
          <div>
            Showing {filtered.length === 0 ? 0 : formatNumber(start + 1)}–
            {formatNumber(Math.min(start + pageSize, filtered.length))} of {formatNumber(filtered.length)} states
          </div>
          <div className="flex items-center gap-2">
            <span>per page:</span>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="h-8 w-[70px] shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 shadow-none"
              disabled={clampedPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </Button>
            <span className="px-2">
              Page {clampedPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 shadow-none"
              disabled={clampedPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      {/* Partners in State Modal */}
      <Dialog open={modalOpen} onOpenChange={(open) => !open && closePartnerModal()}>
        <DialogContent className="max-w-3xl p-0">
          <DialogHeader className="border-b bg-[#4a5d0f] px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-base font-semibold text-white">
                  Partners in {modalState}
                </DialogTitle>
                <DialogDescription className="text-white/80 text-xs">
                  {formatNumber(modalPartners.length)} partner{modalPartners.length === 1 ? "" : "s"} found
                </DialogDescription>
              </div>
              <button
                onClick={closePartnerModal}
                className="rounded-md p-1 text-white/80 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </DialogHeader>

          <div className="space-y-3 p-5">
            {/* Modal search + export */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search partner name or phone..."
                  value={modalSearch}
                  onChange={(e) => setModalSearch(e.target.value)}
                  className="h-9 pl-9 shadow-none"
                />
              </div>
              <Button
                onClick={handleModalExport}
                disabled={modalPartners.length === 0}
                className="h-9 bg-[#4a5d0f] text-white hover:bg-[#3a4a0c] shadow-none"
              >
                <Download className="mr-2 h-4 w-4" /> Export CSV
              </Button>
            </div>

            {/* Modal table */}
            <div className="overflow-hidden rounded-lg border border-[#e5e7eb]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#eef3c4] hover:bg-[#eef3c4]">
                    <TableHead className="text-left text-[11px] font-semibold text-[#4a5d0f]">Name</TableHead>
                    <TableHead className="text-left text-[11px] font-semibold text-[#4a5d0f]">Phone Number</TableHead>
                    <TableHead className="text-center text-[11px] font-semibold text-[#4a5d0f]">Total Stoves</TableHead>
                    <TableHead className="text-center text-[11px] font-semibold text-[#4a5d0f]">Stoves Sold</TableHead>
                    <TableHead className="text-center text-[11px] font-semibold text-[#4a5d0f]">Stoves Available</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {modalPageRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-gray-500">
                        No partners found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    modalPageRows.map((p) => (
                      <TableRow key={p.id} className="border-b text-xs">
                        <TableCell className="align-top font-medium text-gray-800">{p.name}</TableCell>
                        <TableCell className="align-top text-gray-700">
                          <span className="inline-flex items-center gap-1.5">
                            <Phone className="h-3 w-3 text-gray-400" />
                            {p.phone}
                          </span>
                        </TableCell>
                        <TableCell className="text-center align-top">
                          <Pill tone="slate">{formatNumber(p.totalStoves)}</Pill>
                        </TableCell>
                        <TableCell className="text-center align-top">
                          <Pill tone="emerald">{formatNumber(p.stovesSold)}</Pill>
                        </TableCell>
                        <TableCell className="text-center align-top">
                          <Pill tone="green">{formatNumber(p.stovesAvailable)}</Pill>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Modal pagination */}
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#e5e7eb] pt-3 text-xs text-gray-600">
              <div>
                Showing {modalPartners.length === 0 ? 0 : formatNumber(modalStart + 1)}–
                {formatNumber(Math.min(modalStart + modalPageSize, modalPartners.length))} of {formatNumber(modalPartners.length)} partners
              </div>
              <div className="flex items-center gap-2">
                <span>per page:</span>
                <Select value={String(modalPageSize)} onValueChange={(v) => setModalPageSize(Number(v))}>
                  <SelectTrigger className="h-8 w-[70px] shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZES.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shadow-none"
                  disabled={modalClampedPage <= 1}
                  onClick={() => setModalPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </Button>
                <span className="px-2">
                  Page {modalClampedPage} of {modalTotalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shadow-none"
                  disabled={modalClampedPage >= modalTotalPages}
                  onClick={() => setModalPage((p) => Math.min(modalTotalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Agents in State Modal */}
      <Dialog open={agentModalOpen} onOpenChange={(open) => !open && closeAgentModal()}>
        <DialogContent className="max-w-6xl w-[95vw] max-h-[90vh] p-0 flex flex-col overflow-hidden">
          <DialogHeader className="border-b bg-[#4a5d0f] px-6 py-4 shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-base font-semibold text-white">
                  Agents in {agentModalState}
                </DialogTitle>
                <DialogDescription className="text-white/80 text-xs">
                  {formatNumber(agentModalAgents.length)} agent{agentModalAgents.length === 1 ? "" : "s"} · Total stoves in state: {formatNumber(agentModalRow?.stoves ?? 0)} · Unsold: {formatNumber(agentModalRow?.notSold ?? 0)}
                </DialogDescription>
              </div>
              <button
                onClick={closeAgentModal}
                className="rounded-md p-1 text-white/80 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </DialogHeader>

          <div className="flex flex-col flex-1 min-h-0 space-y-3 p-5 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search agent name, role, or state..."
                  value={agentModalSearch}
                  onChange={(e) => setAgentModalSearch(e.target.value)}
                  className="h-9 pl-9 shadow-none"
                />
              </div>
              <Button
                onClick={handleAgentModalExport}
                disabled={agentModalAgents.length === 0}
                className="h-9 bg-[#4a5d0f] text-white hover:bg-[#3a4a0c] shadow-none"
              >
                <Download className="mr-2 h-4 w-4" /> Export CSV
              </Button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-[#e5e7eb]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#eef3c4] hover:bg-[#eef3c4]">
                    <TableHead className="min-w-[220px] text-left text-[11px] font-semibold text-[#4a5d0f]">Agent</TableHead>
                    <TableHead className="text-center text-[11px] font-semibold text-[#4a5d0f]">States Covered</TableHead>
                    <TableHead className="text-left text-[11px] font-semibold text-[#4a5d0f]">State List</TableHead>
                    <TableHead className="text-center text-[11px] font-semibold text-[#4a5d0f]">Stoves Recorded</TableHead>
                    <TableHead className="text-center text-[11px] font-semibold text-[#4a5d0f]">Total in State</TableHead>
                    <TableHead className="text-center text-[11px] font-semibold text-[#4a5d0f]">Unsold in State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agentModalPageRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-gray-500">
                        No agents found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    agentModalPageRows.map((a) => (
                      <TableRow key={a.id} className="border-b text-xs">
                        <TableCell className="min-w-[220px] align-top whitespace-nowrap">
                          <span className="inline-block max-w-[180px] truncate align-bottom font-medium text-gray-800" title={a.name}>
                            {a.name}
                          </span>
                          <sup className="ml-1 whitespace-nowrap text-[9px] font-medium text-blue-600">
                            {AGENT_ROLE_LABELS[a.role] || a.role}
                          </sup>
                        </TableCell>
                        <TableCell className="text-center align-top">
                          <Pill tone="slate">{formatNumber(a.statesCovered.length)}</Pill>
                        </TableCell>
                        <TableCell className="align-top text-gray-700">
                          <div className="flex flex-wrap gap-1">
                            {a.statesCovered.map((s) => (
                              <span
                                key={s}
                                className="inline-flex rounded-full bg-[#eef3c4] px-2 py-0.5 text-[10px] font-medium text-[#4a5d0f]"
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-center align-top">
                          <Pill tone="emerald">{formatNumber(a.stovesRecorded)}</Pill>
                        </TableCell>
                        <TableCell className="text-center align-top">
                          <Pill tone="slate">{formatNumber(agentModalRow?.stoves ?? 0)}</Pill>
                        </TableCell>
                        <TableCell className="text-center align-top">
                          <Pill tone="rose">{formatNumber(agentModalRow?.notSold ?? 0)}</Pill>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#e5e7eb] pt-3 text-xs text-gray-600 shrink-0">
              <div>
                Showing {agentModalAgents.length === 0 ? 0 : formatNumber(agentModalStart + 1)}–
                {formatNumber(Math.min(agentModalStart + agentModalPageSize, agentModalAgents.length))} of {formatNumber(agentModalAgents.length)} agents
              </div>
              <div className="flex items-center gap-2">
                <span>per page:</span>
                <Select value={String(agentModalPageSize)} onValueChange={(v) => setAgentModalPageSize(Number(v))}>
                  <SelectTrigger className="h-8 w-[70px] shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZES.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shadow-none"
                  disabled={agentModalClampedPage <= 1}
                  onClick={() => setAgentModalPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </Button>
                <span className="px-2">
                  Page {agentModalClampedPage} of {agentModalTotalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shadow-none"
                  disabled={agentModalClampedPage >= agentModalTotalPages}
                  onClick={() => setAgentModalPage((p) => Math.min(agentModalTotalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Stoves in State Modal */}
      <StateStovesModal
        open={stoveModalOpen}
        state={stoveModalState}
        initialStatus={stoveModalStatus}
        summary={
          stoveModalRow
            ? { stoves: stoveModalRow.stoves, sold: stoveModalRow.sold, notSold: stoveModalRow.notSold }
            : null
        }
        onClose={closeStoveModal}
      />
    </div>

  );
}
