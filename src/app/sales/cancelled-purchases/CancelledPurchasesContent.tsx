import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "../../components/DashboardLayout";
import PageHeader from "../../components/PageHeader";
import { Ban, Eye, Loader2, Search } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listCancelledPurchases,
  type CancelledPurchaseRecord,
} from "@/app/services/cancelPurchaseService";

const fmt = (d?: string | null) =>
  !d ? "—" : new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default function CancelledPurchasesContent() {
  const [rows, setRows] = useState<CancelledPurchaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<CancelledPurchaseRecord | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError("");
        const data = await listCancelledPurchases();
        setRows(data);
      } catch (e: any) {
        setError(e?.message || "Failed to load cancelled purchases");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.transaction_id, r.partner_name, r.state, r.branch, r.cancellation_reason]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [rows, search]);

  return (
    <DashboardLayout currentRoute="sales-cancelled-purchases" title="Cancelled Purchases">
      <div className="p-6 space-y-4">
        <PageHeader icon={Ban} title="Cancelled Purchases" />

        <div className="bg-[#FAFCFD] border border-gray-200 rounded-md p-3 flex items-center gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by transaction, partner, state, reason…"
              className="pl-8 h-9 bg-white text-xs"
            />
          </div>
          <div className="ml-auto text-sm text-gray-600">
            {loading ? "Loading..." : `${filtered.length} record${filtered.length === 1 ? "" : "s"}`}
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</div>
        )}

        <div className="bg-white border border-gray-200 overflow-x-auto">
          <Table className="text-sm">
            <TableHeader>
              <TableRow className="bg-[#4a5d0f] hover:bg-[#4a5d0f]">
                <TableHead className="text-white font-semibold">Transaction ID</TableHead>
                <TableHead className="text-white font-semibold">Partner</TableHead>
                <TableHead className="text-white font-semibold">State</TableHead>
                <TableHead className="text-white font-semibold">Branch</TableHead>
                <TableHead className="text-white font-semibold text-center">Stoves</TableHead>
                <TableHead className="text-white font-semibold">Original Transfer</TableHead>
                <TableHead className="text-white font-semibold">Cancelled At</TableHead>
                <TableHead className="text-white font-semibold">Reason</TableHead>
                <TableHead className="text-white font-semibold text-center">Stove IDs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-gray-500">
                    <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
                    Loading…
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-gray-500">
                    No cancelled purchases yet.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r, idx) => (
                  <TableRow
                    key={r.id}
                    className={`${idx % 2 === 0 ? "bg-white" : "bg-[#eef3c4]/40"} hover:bg-[#eef3c4] text-gray-700`}
                  >
                    <TableCell className="font-mono">{r.transaction_id || "—"}</TableCell>
                    <TableCell className="font-medium text-gray-900">{r.partner_name || "—"}</TableCell>
                    <TableCell>{r.state || "—"}</TableCell>
                    <TableCell>{r.branch || "—"}</TableCell>
                    <TableCell className="text-center">
                      <span className="inline-flex items-center justify-center min-w-[2rem] text-sm font-semibold px-2 py-0.5 rounded-full bg-[#eef3c4] text-[#4a5d0f]">
                        {r.stove_count}
                      </span>
                    </TableCell>
                    <TableCell>{fmt(r.transfer_date)}</TableCell>
                    <TableCell>{fmt(r.cancelled_at)}</TableCell>
                    <TableCell className="max-w-xs truncate" title={r.cancellation_reason}>
                      {r.cancellation_reason}
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => setPreview(r)}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" />
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl w-[95vw] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              Stove IDs — {preview?.transaction_id} ({preview?.stove_count})
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto">
            {preview && preview.stove_ids_snapshot?.length ? (
              <div className="grid grid-cols-4 md:grid-cols-6 gap-1.5">
                {preview.stove_ids_snapshot.map((s) => (
                  <div
                    key={s.stove_id}
                    className="px-2 py-1 text-xs rounded border text-center truncate bg-muted/50"
                    title={s.stove_id}
                  >
                    {s.stove_id}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 py-6 text-center">No stove IDs recorded.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
