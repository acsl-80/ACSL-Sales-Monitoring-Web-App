import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Loader2,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import PageHeader from "../../components/PageHeader";
import { createClientComponentClient } from "@/lib/supabaseClient";
import { supabaseFunctionsUrl } from "@/lib/supabaseConfig";
import { useToast, ToastContainer } from "@/components/ui/toast";

export default function PartnerAgentsProfilesContent() {
  const supabase = createClientComponentClient();
  const { toast, toasts, removeToast } = useToast();

  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const loadAgents = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");

      const params = new URLSearchParams({
        role: "partner_agent",
        page: "1",
        limit: "500",
        sortBy: "created_at",
        sortOrder: "desc",
      });

      const res = await fetch(`${supabaseFunctionsUrl}/manage-users?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to load");
      setAgents(result.data || []);
    } catch (err) {
      toast({ variant: "error", title: "Failed to load partner agents", description: err.message });
      setAgents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAgents(); }, []); // eslint-disable-line


  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) =>
      [a.full_name, a.phone, a.organization?.partner_name, a.organization?.state]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [agents, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * pageSize;
  const pageRows = filtered.slice(startIdx, startIdx + pageSize);
  const startRecord = filtered.length === 0 ? 0 : startIdx + 1;
  const endRecord = Math.min(startIdx + pageSize, filtered.length);

  const getVisiblePages = () => {
    const pages = [];
    const max = 5;
    let start = Math.max(1, currentPage - Math.floor(max / 2));
    let end = Math.min(totalPages, start + max - 1);
    if (end - start + 1 < max) start = Math.max(1, end - max + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  const hasFilter = !!search;

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Partner Agents Profile" description="View all partner agents" />

      {/* Filter bar */}
      <div
        className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 p-3"
        style={{ backgroundColor: "#f4f7e3" }}
      >
        <Input
          placeholder="Search by name, phone, partner or state…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="h-9 max-w-sm bg-white"
        />
        <Button
          onClick={() => setSearch("")}
          size="sm"
          variant="outline"
          className="h-9 bg-white shadow-none border-gray-200"
          disabled={!hasFilter}
        >
          <X className="h-4 w-4 mr-1" />
          Reset Filters
        </Button>
      </div>

      {/* Table */}
      <div className="space-y-0">
        <div className="bg-white border-x border-t border-gray-200 rounded-t-lg overflow-x-auto relative">
          {loading && (
            <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
              <Loader2 className="h-6 w-6 animate-spin text-[#4a5d0f]" />
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow style={{ backgroundColor: "#4a5d0f" }} className="hover:bg-transparent">
                <TableHead className="text-white font-semibold text-sm whitespace-nowrap first:rounded-tl-lg">Agent Name</TableHead>
                <TableHead className="text-white font-semibold text-sm whitespace-nowrap">Phone Number</TableHead>
                <TableHead className="text-white font-semibold text-sm whitespace-nowrap">Partner Name</TableHead>
                <TableHead className="text-white font-semibold text-sm whitespace-nowrap rounded-tr-lg">State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={loading ? "opacity-40" : ""}>
              {pageRows.length === 0 && !loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-10 text-gray-500">
                    No partner agents found
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((a, idx) => (
                  <TableRow
                    key={a.id}
                    className="hover:bg-[#eef3c4] text-gray-700"
                    style={{ backgroundColor: idx % 2 === 0 ? "#ffffff" : "#f4f7e3" }}
                  >
                    <TableCell className="text-sm font-medium text-gray-900">
                      {a.full_name || "N/A"}
                    </TableCell>
                    <TableCell className="text-sm text-gray-700 whitespace-nowrap">
                      {a.phone || ""}
                    </TableCell>
                    <TableCell className="text-sm text-gray-700">
                      {a.organization?.partner_name || ""}
                    </TableCell>
                    <TableCell className="text-sm text-gray-700">
                      {a.organization?.state || ""}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-gray-200 rounded-b-lg px-4 py-3">
            <div className="flex items-center gap-4">
              <p className="text-sm text-gray-600">
                Showing <span className="font-medium">{startRecord}</span> to{" "}
                <span className="font-medium">{endRecord}</span> of{" "}
                <span className="font-medium">{filtered.length}</span> partner agents
              </p>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Rows per page</span>
                <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                  <SelectTrigger className="h-8 w-[80px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setPage(1)} disabled={currentPage === 1}>
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1}>
                  <ChevronLeft className="h-4 w-4 mr-1" />Prev
                </Button>
                {getVisiblePages().map((p) => (
                  <Button
                    key={p}
                    variant={p === currentPage ? "default" : "outline"}
                    size="sm"
                    className={`h-8 w-8 p-0 ${p === currentPage ? "bg-black text-white hover:bg-black border-black" : ""}`}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </Button>
                ))}
                <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setPage(currentPage + 1)} disabled={currentPage >= totalPages}>
                  Next<ChevronRight className="h-4 w-4 ml-1" />
                </Button>
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setPage(totalPages)} disabled={currentPage >= totalPages}>
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}
