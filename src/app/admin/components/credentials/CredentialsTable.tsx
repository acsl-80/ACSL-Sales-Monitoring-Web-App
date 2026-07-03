
import React, { useState } from "react";
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
import { Eye, EyeOff, Copy, RefreshCw, Info, Loader2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Credential } from "@/app/services/adminCredentialsService";

interface CredentialsTableProps {
  credentials: Credential[];
  loading: boolean;
  onViewDetails: (credential: Credential) => void;
  onResetPassword: (credential: Credential) => void;
}

const CredentialsTable: React.FC<CredentialsTableProps> = ({
  credentials,
  loading,
  onViewDetails,
  onResetPassword,
}) => {
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const totalRecords = credentials.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const startRecord = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endRecord = Math.min(currentPage * pageSize, totalRecords);
  const paged = credentials.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const getVisiblePages = () => {
    const pages: number[] = [];
    let start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + 4);
    start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  const togglePasswordVisibility = (id: string) => {
    setVisiblePasswords((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch { /* ignore */ }
  };

  const maskPassword = (password: string) => "•".repeat(Math.min(password.length, 12));

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="space-y-0">
      {/* Pagination header */}
      <div className="bg-blue-50 rounded-t-lg px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-sm text-gray-600">
            Showing <span className="font-medium">{startRecord}–{endRecord}</span> of{" "}
            <span className="font-medium">{totalRecords}</span> credentials
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">per page:</span>
            <Select value={pageSize.toString()} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}>
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
          Total: <span className="text-brand">{totalRecords}</span>
        </p>
      </div>

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
              <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Partner ID</TableHead>
              <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Partner Name</TableHead>
              <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Email / Username</TableHead>
              <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Password</TableHead>
              <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Type</TableHead>
              <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Created</TableHead>
              <TableHead className="text-center text-white font-semibold text-xs whitespace-nowrap">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className={loading ? "opacity-40" : ""}>
            {paged.length === 0 && !loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-gray-500 text-sm">
                  No credentials found
                </TableCell>
              </TableRow>
            ) : (
              paged.map((cred, idx) => {
                const isVisible = visiblePasswords.has(cred.partner_id);
                const emailCopyId = `email-${cred.partner_id}`;
                const pwdCopyId = `pwd-${cred.partner_id}`;
                const loginValue = cred.is_dummy_email
                  ? cred.username ?? ""
                  : cred.email ?? cred.organizations?.email ?? "";

                return (
                  <TableRow
                    key={cred.partner_id}
                    className={`${idx % 2 === 0 ? "bg-white" : "bg-blue-50/50"} hover:bg-gray-50 text-gray-700`}
                  >
                    <TableCell className="text-xs font-mono text-gray-700">{cred.partner_id}</TableCell>
                    <TableCell className="text-xs font-medium text-gray-900">{cred.partner_name}</TableCell>

                    {/* Email / Username */}
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-700 truncate max-w-[160px]">{loginValue}</span>
                        <button
                          onClick={() => copyToClipboard(loginValue, emailCopyId)}
                          className="text-gray-400 hover:text-brand transition-colors flex-shrink-0"
                          title="Copy"
                        >
                          {copiedField === emailCopyId
                            ? <span className="text-[10px] text-green-600 font-bold">✓</span>
                            : <Copy className="h-3 w-3" />}
                        </button>
                      </div>
                    </TableCell>

                    {/* Password */}
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-gray-700">
                          {isVisible ? cred.password : maskPassword(cred.password)}
                        </span>
                        <button
                          onClick={() => togglePasswordVisibility(cred.partner_id)}
                          className="text-gray-400 hover:text-brand transition-colors flex-shrink-0"
                          title={isVisible ? "Hide" : "Show"}
                        >
                          {isVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </button>
                        <button
                          onClick={() => copyToClipboard(cred.password, pwdCopyId)}
                          className="text-gray-400 hover:text-brand transition-colors flex-shrink-0"
                          title="Copy"
                        >
                          {copiedField === pwdCopyId
                            ? <span className="text-[10px] text-green-600 font-bold">✓</span>
                            : <Copy className="h-3 w-3" />}
                        </button>
                      </div>
                    </TableCell>

                    {/* Type badge */}
                    <TableCell>
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                        cred.is_dummy_email
                          ? "bg-purple-100 text-purple-700"
                          : "bg-blue-100 text-blue-700"
                      }`}>
                        {cred.is_dummy_email ? "Username" : "Email"}
                      </span>
                    </TableCell>

                    <TableCell className="text-xs text-gray-600">{formatDate(cred.created_at)}</TableCell>

                    {/* Actions — inline buttons */}
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <Button
                          size="sm"
                          className="bg-brand hover:bg-brand/90 text-white h-7 px-2 text-xs"
                          onClick={() => onViewDetails(cred)}
                        >
                          <Info className="h-3 w-3 mr-1" />
                          Details
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs text-amber-600 border-amber-200 hover:bg-amber-50"
                          onClick={() => onResetPassword(cred)}
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Reset Password
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination footer */}
      {totalPages > 1 && (
        <div className="border border-t-0 border-gray-200 rounded-b-lg px-4 py-3 flex items-center justify-between bg-white">
          <p className="text-sm text-gray-600">
            Showing {startRecord} to {endRecord} of {totalRecords} credentials
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setCurrentPage((p) => p - 1)} disabled={currentPage === 1}>
              <ChevronLeft className="h-4 w-4 mr-1" />Prev
            </Button>
            {getVisiblePages().map((p) => (
              <Button
                key={p}
                variant={p === currentPage ? "default" : "outline"}
                size="sm"
                className={`h-8 w-8 p-0 ${p === currentPage ? "bg-brand text-white hover:bg-brand" : ""}`}
                onClick={() => setCurrentPage(p)}
              >{p}</Button>
            ))}
            <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setCurrentPage((p) => p + 1)} disabled={currentPage >= totalPages}>
              Next<ChevronRight className="h-4 w-4 ml-1" />
            </Button>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentPage(totalPages)} disabled={currentPage >= totalPages}>
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CredentialsTable;
