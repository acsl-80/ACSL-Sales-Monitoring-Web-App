
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Eye,
  Edit,
  Trash2,
  User,
  Loader2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  KeyRound,
} from "lucide-react";
import { SalesAgent } from "@/types/salesAgent";

interface SalesAgentTableProps {
  data: SalesAgent[];
  loading: boolean;
  sortBy: string;
  sortOrder: string;
  onSort: (column: string) => void;
  onView: (agent: SalesAgent) => void;
  onEdit: (agent: SalesAgent) => void;
  onDelete: (agent: SalesAgent) => void;
  onViewPerformance: (agent: SalesAgent) => void;
  onViewCredentials?: (agent: SalesAgent) => void;
  loadingCredentialId?: string | null;
  // Pagination
  currentPage: number;
  pageSize: number;
  totalRecords: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  hidePaginationHeader?: boolean;
}

const formatRelativeTime = (dateString: string | null | undefined): string => {
  if (!dateString) return "Never";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor(diffMs / (1000 * 60));

  if (diffMins < 1) return "Just now";
  if (diffHours < 1) return `${diffMins}m ago`;
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 30) return `${diffDays} days ago`;
  if (diffDays < 60) return "1 month ago";
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths} months ago`;
};

const formatDateJoined = (dateString: string): string => {
  if (!dateString) return "N/A";
  try {
    return new Date(dateString).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "Invalid Date";
  }
};

const SalesAgentTable: React.FC<SalesAgentTableProps> = ({
  data,
  loading,
  sortBy,
  sortOrder,
  onSort,
  onView,
  onEdit,
  onDelete,
  onViewCredentials,
  loadingCredentialId,
  currentPage,
  pageSize,
  totalRecords,
  onPageChange,
  onPageSizeChange,
  hidePaginationHeader = false,
}) => {
  const totalPages = Math.ceil(totalRecords / pageSize);
  const startRecord = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endRecord = Math.min(currentPage * pageSize, totalRecords);

  const getVisiblePages = () => {
    const pages: number[] = [];
    let start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + 4);
    start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sortBy !== column) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />;
    return sortOrder === "asc"
      ? <ArrowUp className="h-3 w-3 ml-1" />
      : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  return (
    <div className="space-y-0">
      {/* Pagination header */}
      {!hidePaginationHeader && <div className="bg-blue-50 rounded-t-lg px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-sm text-gray-600">
            Showing <span className="font-medium">{startRecord}–{endRecord}</span> of{" "}
            <span className="font-medium">{totalRecords}</span> records
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">per page:</span>
            <Select value={pageSize.toString()} onValueChange={(val) => onPageSizeChange(Number(val))}>
              <SelectTrigger className="w-[65px] h-7 bg-white text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-sm font-bold text-green-500">
          Total Agents: <span className="text-brand">{totalRecords}</span>
        </p>
      </div>}

      {/* Table */}
      <div className="bg-white border-x border-gray-200 overflow-x-auto relative">
        {loading && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
            <Loader2 className="h-6 w-6 animate-spin text-brand" />
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow className="bg-brand hover:bg-brand">
              <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Agent Name</TableHead>
              <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Phone</TableHead>
              <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Email</TableHead>
              <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Stoves Sold</TableHead>
              <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Last Login</TableHead>
              <TableHead
                className="text-white font-semibold text-xs whitespace-nowrap cursor-pointer select-none"
                onClick={() => onSort("created_at")}
              >
                <div className="flex items-center">
                  Date Joined
                  <SortIcon column="created_at" />
                </div>
              </TableHead>
              <TableHead className="text-white font-semibold text-xs text-center whitespace-nowrap">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className={loading ? "opacity-40" : ""}>
            {data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  <div className="flex flex-col items-center gap-3 text-gray-500">
                    <User className="h-12 w-12 text-gray-300" />
                    <div>
                      <p className="text-gray-900 font-medium">No sales agents found</p>
                      <p className="text-sm">Try adjusting your search or add your first agent</p>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              data.map((agent, index) => (
                <TableRow
                  key={agent.id || index}
                  className={`${index % 2 === 0 ? "bg-white" : "bg-blue-50/50"} hover:bg-gray-50 text-gray-700`}
                >
                  {/* Agent Name — no avatar */}
                  <TableCell className="text-xs font-medium text-gray-900">
                    {agent.full_name || "N/A"}
                  </TableCell>

                  <TableCell className="text-xs text-gray-600">
                    {agent.phone || "—"}
                  </TableCell>

                  <TableCell className="text-xs max-w-[180px] truncate">
                    {agent.email || "N/A"}
                  </TableCell>

                  <TableCell className="text-xs font-medium text-gray-900">
                    {(agent.total_sold ?? 0).toLocaleString()}
                  </TableCell>

                  {/* Last Login — relative time */}
                  <TableCell className="text-xs text-gray-600">
                    {formatRelativeTime(agent.last_login)}
                  </TableCell>

                  {/* Date Joined — "19 Mar 2026" */}
                  <TableCell className="text-xs text-gray-600">
                    {formatDateJoined(agent.created_at)}
                  </TableCell>

                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <Button
                        size="sm"
                        onClick={() => onView(agent)}
                        className="bg-brand hover:bg-brand/90 text-white h-7 px-2 text-xs"
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        View
                      </Button>
                      {onViewCredentials && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onViewCredentials(agent)}
                          disabled={loadingCredentialId === agent.id}
                          className="h-7 px-2 text-xs border-brand/40 text-brand hover:bg-brand/5"
                        >
                          <KeyRound className="h-3 w-3 mr-1" />
                          {loadingCredentialId === agent.id ? "…" : "Credentials"}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onEdit(agent)}
                        className="h-7 px-2 text-xs"
                      >
                        <Edit className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onDelete(agent)}
                        className="text-red-600 border-red-200 hover:bg-red-50 h-7 px-2 text-xs"
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination footer */}
      {totalPages > 1 && (
        <div className="border border-t-0 border-gray-200 rounded-b-lg px-4 py-3 flex items-center justify-between bg-white">
          <p className="text-sm text-gray-600">
            Showing {startRecord} to {endRecord} of {totalRecords} records
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => onPageChange(1)} disabled={currentPage === 1}>
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1}>
              <ChevronLeft className="h-4 w-4 mr-1" />Prev
            </Button>
            {getVisiblePages().map((p) => (
              <Button key={p} variant={p === currentPage ? "default" : "outline"} size="sm"
                className={`h-8 w-8 p-0 ${p === currentPage ? "bg-brand text-white hover:bg-brand" : ""}`}
                onClick={() => onPageChange(p)}
              >
                {p}
              </Button>
            ))}
            <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages}>
              Next<ChevronRight className="h-4 w-4 ml-1" />
            </Button>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => onPageChange(totalPages)} disabled={currentPage === totalPages}>
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesAgentTable;
