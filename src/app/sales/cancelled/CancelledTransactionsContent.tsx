import { useEffect, useState, useMemo } from "react";
import DashboardLayout from "../../components/DashboardLayout";
import PageHeader from "../../components/PageHeader";
import { Ban, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClientComponentClient } from "@/lib/supabaseClient";

interface CancelledSale {
  id: string;
  transaction_id: string | null;
  sales_date: string | null;
  created_at: string | null;
  end_user_name: string | null;
  state_backup: string | null;
  stove_serial_no: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
}

const formatDate = (d?: string | null) => {
  if (!d) return "N/A";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "N/A";
  return dt.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

export default function CancelledTransactionsContent() {
  const supabase = useMemo(() => createClientComponentClient(), []);
  const [rows, setRows] = useState<CancelledSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
        // Primary query: sales flagged as cancelled (metadata columns present)
        let { data, error } = await supabase
          .from("sales")
          .select(
            "id, transaction_id, sales_date, created_at, end_user_name, state_backup, stove_serial_no, cancel_reason, cancelled_at"
          )
          .not("cancelled_at", "is", null)
          .order("cancelled_at", { ascending: false })
          .limit(1000);

        // Fallback if cancel columns don't exist yet: show archived sales
        if (error) {
          const fallback = await supabase
            .from("sales")
            .select(
              "id, transaction_id, sales_date, created_at, end_user_name, state_backup, stove_serial_no"
            )
            .eq("is_archived", true)
            .order("created_at", { ascending: false })
            .limit(1000);
          if (fallback.error) throw fallback.error;
          data = (fallback.data || []).map((r: any) => ({
            ...r,
            cancel_reason: null,
            cancelled_at: null,
          }));
        }

        if (!cancelled) setRows((data as CancelledSale[]) || []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load cancelled transactions");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [
        r.transaction_id,
        r.end_user_name,
        r.state_backup,
        r.stove_serial_no,
        r.cancel_reason,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [rows, search]);

  return (
    <DashboardLayout currentRoute="sales-cancelled" title="Cancelled Transactions">
      <div className="p-6 space-y-4">
        <PageHeader icon={Ban} title="Cancelled Transactions" />

        <div className="bg-[#fafcfd] border border-gray-200 rounded-md p-3 flex items-center gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by Trans #, end user, state, stove ID, reason..."
              className="pl-8 h-9 bg-white"
            />
          </div>
          <div className="ml-auto text-sm text-gray-600">
            {loading ? "Loading..." : `${filtered.length} record${filtered.length === 1 ? "" : "s"}`}
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
            {error}
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-md overflow-x-auto">
          <Table className="text-sm">
            <TableHeader className="bg-[#4a5d0f]">
              <TableRow className="hover:bg-[#4a5d0f]">
                <TableHead className="text-white font-semibold">Trans #</TableHead>
                <TableHead className="text-white font-semibold">Date</TableHead>
                <TableHead className="text-white font-semibold">End User</TableHead>
                <TableHead className="text-white font-semibold">State</TableHead>
                <TableHead className="text-white font-semibold">Stove ID</TableHead>
                <TableHead className="text-white font-semibold">Reason for Cancel</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-gray-500">
                    <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
                    Loading cancelled transactions...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-gray-500">
                    No cancelled transactions found.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r, idx) => (
                  <TableRow
                    key={r.id}
                    className={idx % 2 === 0 ? "bg-white" : "bg-[#eef3c4]"}
                  >
                    <TableCell className="font-medium">{r.transaction_id || "N/A"}</TableCell>
                    <TableCell>{formatDate(r.cancelled_at || r.sales_date || r.created_at)}</TableCell>
                    <TableCell>{r.end_user_name || "N/A"}</TableCell>
                    <TableCell>{r.state_backup || "N/A"}</TableCell>
                    <TableCell className="font-mono">{r.stove_serial_no || "N/A"}</TableCell>
                    <TableCell className="text-gray-700">
                      {r.cancel_reason || <span className="text-gray-400 italic">No reason provided</span>}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </DashboardLayout>
  );
}
