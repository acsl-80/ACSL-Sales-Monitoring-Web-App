
import { useState, useEffect, useMemo } from "react";
import ProtectedRoute from "../../components/ProtectedRoute";
import DashboardLayout from "../../components/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  RefreshCw,
  Key,
  Shield,
  Database,
  Copy,
  Check,
  Users,
  Building2,
  Loader2,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  EyeOff,
  Download,
} from "lucide-react";
import { downloadTableAsCSV } from "@/utils/csvExportUtils";
import adminCredentialsService, { Credential } from "@/app/services/adminCredentialsService";
import CredentialsTable from "../../admin/components/credentials/CredentialsTable";
import ViewCredentialModal from "../../admin/components/credentials/ViewCredentialModal";
import ResetPasswordModal from "../../admin/components/credentials/ResetPasswordModal";
import PageHeader from "../../components/PageHeader";
import { useAuth } from "../../contexts/useAuth";

type TabKey = "partners" | "saa" | "super-admins";

interface UserCredential {
  id: string;
  user_id: string;
  partner_name: string | null;
  email: string;
  username: string | null;
  password: string | null;
  role: string;
  created_at: string;
}

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: "partners", label: "Partners", icon: Building2 },
  { key: "saa", label: "ACSL Agents", icon: Users },
  { key: "super-admins", label: "Super Admins", icon: Shield },
];

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

// ── Shared ERP user-credentials table (SAA + Super Admin tabs) ────────────────
const UserCredentialsSection = ({
  users,
  loadingState,
  onRefresh,
  copiedField,
  onCopy,
}: {
  users: UserCredential[];
  loadingState: boolean;
  onRefresh: () => void;
  copiedField: string | null;
  onCopy: (value: string, key: string) => void;
}) => {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all"); // all | with-password | no-password
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());

  const togglePwd = (id: string) =>
    setVisiblePasswords((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const filtered = useMemo(() => {
    let list = users;
    if (search.trim()) {
      const t = search.toLowerCase();
      list = list.filter((u) =>
        (u.partner_name || "").toLowerCase().includes(t) ||
        u.email.toLowerCase().includes(t)
      );
    }
    if (typeFilter === "with-password") list = list.filter((u) => !!u.password);
    if (typeFilter === "no-password") list = list.filter((u) => !u.password);
    return list;
  }, [users, search, typeFilter]);

  const totalRecords = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const startRecord = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endRecord = Math.min(currentPage * pageSize, totalRecords);
  const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const getVisiblePages = () => {
    const pages: number[] = [];
    let start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + 4);
    start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  const withPwdCount = users.filter((u) => !!u.password).length;

  return (
    <div className="space-y-5">
      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg"><Users className="h-5 w-5 text-blue-700" /></div>
            <div>
              <p className="text-sm text-blue-600 font-medium">Total Users</p>
              <p className="text-xl font-bold text-blue-900">{users.length}</p>
              <p className="text-xs text-blue-500">In this group</p>
            </div>
          </div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg"><Key className="h-5 w-5 text-green-700" /></div>
            <div>
              <p className="text-sm text-green-600 font-medium">With Password</p>
              <p className="text-xl font-bold text-green-900">{withPwdCount}</p>
              <p className="text-xs text-green-500">Credentials saved</p>
            </div>
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg"><Shield className="h-5 w-5 text-amber-700" /></div>
            <div>
              <p className="text-sm text-amber-600 font-medium">No Password</p>
              <p className="text-xl font-bold text-amber-900">{users.length - withPwdCount}</p>
              <p className="text-xs text-amber-500">Not yet set</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-blue-50 p-3 rounded-lg border border-gray-200 flex flex-wrap items-center gap-3">
        <div className="w-1/4 min-w-[180px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
            className="pl-9 bg-white h-9 text-sm"
          />
        </div>
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setCurrentPage(1); }}>
          <SelectTrigger className="w-[160px] h-9 bg-white text-sm">
            <SelectValue placeholder="All credentials" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Credentials</SelectItem>
            <SelectItem value="with-password">With Password</SelectItem>
            <SelectItem value="no-password">No Password</SelectItem>
          </SelectContent>
        </Select>
        {(search || typeFilter !== "all") && (
          <Button onClick={() => { setSearch(""); setTypeFilter("all"); setCurrentPage(1); }} size="sm" variant="outline" className="h-9">
            <X className="h-4 w-4 mr-1" />Clear
          </Button>
        )}
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loadingState} className="h-9">
            <RefreshCw className={`h-4 w-4 mr-2 ${loadingState ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ERP table */}
      <div className="space-y-0">
        <div className="bg-blue-50 rounded-t-lg px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <p className="text-sm text-gray-600">
              Showing <span className="font-medium">{startRecord}–{endRecord}</span> of{" "}
              <span className="font-medium">{totalRecords}</span> users
            </p>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">per page:</span>
              <Select value={pageSize.toString()} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}>
                <SelectTrigger className="w-[65px] h-7 bg-white text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-green-500">Total: <span className="text-brand">{totalRecords}</span></p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs flex items-center gap-1"
              onClick={() => {
                const headers = ["Name", "Email", "Role", "Created At"];
                const rows = filtered.map((u) => [
                  u.partner_name || "",
                  u.email,
                  u.role,
                  u.created_at ? new Date(u.created_at).toLocaleDateString() : "",
                ]);
                downloadTableAsCSV(headers, rows, `credentials-${new Date().toISOString().slice(0, 10)}.csv`);
              }}
              disabled={filtered.length === 0}
            >
              <Download className="h-3 w-3" />Download
            </Button>
          </div>
        </div>

        <div className="bg-white border-x border-gray-200 overflow-x-auto relative">
          {loadingState && (
            <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
              <Loader2 className="h-6 w-6 animate-spin text-brand" />
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow className="bg-brand hover:bg-brand">
                <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Name</TableHead>
                <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Email</TableHead>
                <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Password</TableHead>
                <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={loadingState ? "opacity-40" : ""}>
              {paged.length === 0 && !loadingState ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-10 text-gray-500 text-sm">
                    {users.length === 0
                      ? "No credentials found. Create users in User Management."
                      : "No users match your search."}
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((u, idx) => (
                  <TableRow key={u.id} className={`${idx % 2 === 0 ? "bg-white" : "bg-blue-50/50"} hover:bg-gray-50`}>
                    <TableCell className="text-xs font-medium text-gray-900">{u.partner_name || "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-700">{u.email}</span>
                        <button onClick={() => onCopy(u.email, `email-${u.id}`)} className="text-gray-400 hover:text-brand">
                          {copiedField === `email-${u.id}` ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
                        </button>
                      </div>
                    </TableCell>
                    <TableCell>
                      {u.password ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded">
                            {visiblePasswords.has(u.id) ? u.password : "•".repeat(Math.min(u.password.length, 12))}
                          </span>
                          <button onClick={() => togglePwd(u.id)} className="text-gray-400 hover:text-brand">
                            {visiblePasswords.has(u.id) ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          </button>
                          <button onClick={() => onCopy(u.password!, `pwd-${u.id}`)} className="text-gray-400 hover:text-brand">
                            {copiedField === `pwd-${u.id}` ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
                          </button>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-gray-600">{formatDate(u.created_at)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="border border-t-0 border-gray-200 rounded-b-lg px-4 py-3 flex items-center justify-between bg-white">
            <p className="text-sm text-gray-600">Showing {startRecord} to {endRecord} of {totalRecords}</p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}><ChevronsLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setCurrentPage((p) => p - 1)} disabled={currentPage === 1}><ChevronLeft className="h-4 w-4 mr-1" />Prev</Button>
              {getVisiblePages().map((p) => (
                <Button key={p} variant={p === currentPage ? "default" : "outline"} size="sm"
                  className={`h-8 w-8 p-0 ${p === currentPage ? "bg-brand text-white hover:bg-brand" : ""}`}
                  onClick={() => setCurrentPage(p)}>{p}</Button>
              ))}
              <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setCurrentPage((p) => p + 1)} disabled={currentPage >= totalPages}>Next<ChevronRight className="h-4 w-4 ml-1" /></Button>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentPage(totalPages)} disabled={currentPage >= totalPages}><ChevronsRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────
const CredentialsPage = () => {
  const { supabase } = useAuth();

  const [activeTab, setActiveTab] = useState<TabKey>("partners");

  // Partners tab
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [selectedCredential, setSelectedCredential] = useState<Credential | null>(null);

  // Partner filters
  const [partnerSearch, setPartnerSearch] = useState("");
  const [partnerTypeFilter, setPartnerTypeFilter] = useState("all"); // all | username | email

  // SAA / Super Admin tabs
  const [saaUsers, setSaaUsers] = useState<UserCredential[]>([]);
  const [superAdminUsers, setSuperAdminUsers] = useState<UserCredential[]>([]);
  const [loadingSaa, setLoadingSaa] = useState(false);
  const [loadingSuperAdmins, setLoadingSuperAdmins] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => { fetchCredentials(); }, []);

  const fetchCredentials = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await adminCredentialsService.getAllCredentials();
      if (response.success && response.data) {
        setCredentials(response.data);
      } else {
        setError(response.error || "Failed to fetch credentials");
      }
    } catch (err) {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const fetchUsersByRole = async (
    role: string,
    setUsers: (u: UserCredential[]) => void,
    setLoadingState: (b: boolean) => void
  ) => {
    setLoadingState(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("No auth token");
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-credentials?role=${role}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to fetch credentials");
      setUsers(result.data || []);
    } catch (err) {
      console.error(`Error fetching ${role} credentials:`, err);
    } finally {
      setLoadingState(false);
    }
  };

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    if (tab === "saa" && saaUsers.length === 0) fetchUsersByRole("acsl_agent", setSaaUsers, setLoadingSaa);
    if (tab === "super-admins" && superAdminUsers.length === 0) fetchUsersByRole("super_admin", setSuperAdminUsers, setLoadingSuperAdmins);
  };

  const copyToClipboard = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(key);
      setTimeout(() => setCopiedField(null), 2000);
    } catch { /* ignore */ }
  };

  const handleResetSuccess = () => {
    setSuccessMessage("Password reset successfully!");
    setTimeout(() => setSuccessMessage(""), 5000);
    fetchCredentials();
  };

  // Partner stats
  const partnerStats = {
    total: credentials.length,
    usernameOnly: credentials.filter((c) => c.is_dummy_email).length,
    emailBased: credentials.filter((c) => !c.is_dummy_email).length,
  };

  // Filtered partner credentials
  const filteredCredentials = useMemo(() => {
    let list = credentials;
    if (partnerSearch.trim()) {
      const t = partnerSearch.toLowerCase();
      list = list.filter((c) =>
        c.partner_id.toLowerCase().includes(t) ||
        c.partner_name.toLowerCase().includes(t) ||
        (c.email && c.email.toLowerCase().includes(t)) ||
        (c.username && c.username.toLowerCase().includes(t))
      );
    }
    if (partnerTypeFilter === "username") list = list.filter((c) => c.is_dummy_email);
    if (partnerTypeFilter === "email") list = list.filter((c) => !c.is_dummy_email);
    return list;
  }, [credentials, partnerSearch, partnerTypeFilter]);

  const hasPartnerFilters = partnerSearch !== "" || partnerTypeFilter !== "all";

  return (
    <ProtectedRoute requireSuperAdmin={true}>
      <DashboardLayout currentRoute="settings" title="Credentials Management">
        <div className="p-6 space-y-5">
          <PageHeader
            icon={Key}
            title="Credentials Management"
          />

          {/* Notifications */}
          {successMessage && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">✓ {successMessage}</div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">{error}</div>
          )}

          {/* ── Segment control (replaces tabs) ─────────────────────────── */}
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg w-fit">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => handleTabChange(key)}
                className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${
                  activeTab === key
                    ? "bg-white text-brand shadow-sm border border-gray-200"
                    : "text-gray-500 hover:text-gray-800 hover:bg-white/60"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
                {/* Count pills */}
                {key === "partners" && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-0.5 ${activeTab === key ? "bg-brand text-white" : "bg-gray-200 text-gray-600"}`}>
                    {partnerStats.total}
                  </span>
                )}
                {key === "saa" && saaUsers.length > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-0.5 ${activeTab === key ? "bg-brand text-white" : "bg-gray-200 text-gray-600"}`}>
                    {saaUsers.length}
                  </span>
                )}
                {key === "super-admins" && superAdminUsers.length > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-0.5 ${activeTab === key ? "bg-brand text-white" : "bg-gray-200 text-gray-600"}`}>
                    {superAdminUsers.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Partners Tab ──────────────────────────────────────────────── */}
          {activeTab === "partners" && (
            <div className="space-y-5">
              {/* Stats cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div
                  className="bg-blue-50 border border-blue-200 rounded-lg p-4 cursor-pointer hover:shadow-md hover:scale-[1.02] transition-all"
                  onClick={() => setPartnerTypeFilter("all")}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg"><Database className="h-5 w-5 text-blue-700" /></div>
                    <div>
                      <p className="text-sm text-blue-600 font-medium">Total Credentials</p>
                      <p className="text-xl font-bold text-blue-900">{partnerStats.total}</p>
                      <p className="text-xs text-blue-500">All partner accounts</p>
                    </div>
                  </div>
                </div>
                <div
                  className={`bg-purple-50 border rounded-lg p-4 cursor-pointer hover:shadow-md hover:scale-[1.02] transition-all ${partnerTypeFilter === "username" ? "border-purple-600 shadow-md" : "border-purple-200"}`}
                  onClick={() => setPartnerTypeFilter((f) => f === "username" ? "all" : "username")}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-100 rounded-lg"><Key className="h-5 w-5 text-purple-700" /></div>
                    <div>
                      <p className="text-sm text-purple-600 font-medium">Username-based</p>
                      <p className="text-xl font-bold text-purple-900">{partnerStats.usernameOnly}</p>
                      <p className="text-xs text-purple-500">Click to filter</p>
                    </div>
                  </div>
                  {partnerTypeFilter === "username" && (
                    <p className="text-xs font-semibold mt-2 opacity-70 text-center text-purple-700">✓ Filter active</p>
                  )}
                </div>
                <div
                  className={`bg-green-50 border rounded-lg p-4 cursor-pointer hover:shadow-md hover:scale-[1.02] transition-all ${partnerTypeFilter === "email" ? "border-green-600 shadow-md" : "border-green-200"}`}
                  onClick={() => setPartnerTypeFilter((f) => f === "email" ? "all" : "email")}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-100 rounded-lg"><Shield className="h-5 w-5 text-green-700" /></div>
                    <div>
                      <p className="text-sm text-green-600 font-medium">Email-based</p>
                      <p className="text-xl font-bold text-green-900">{partnerStats.emailBased}</p>
                      <p className="text-xs text-green-500">Click to filter</p>
                    </div>
                  </div>
                  {partnerTypeFilter === "email" && (
                    <p className="text-xs font-semibold mt-2 opacity-70 text-center text-green-700">✓ Filter active</p>
                  )}
                </div>
              </div>

              {/* Filter bar */}
              <div className="bg-blue-50 p-3 rounded-lg border border-gray-200 flex flex-wrap items-center gap-3">
                <div className="w-1/4 min-w-[180px] relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search by ID, name, or email..."
                    value={partnerSearch}
                    onChange={(e) => setPartnerSearch(e.target.value)}
                    className="pl-9 bg-white h-9 text-sm"
                  />
                </div>
                <Select value={partnerTypeFilter} onValueChange={setPartnerTypeFilter}>
                  <SelectTrigger className="w-[150px] h-9 bg-white text-sm">
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="username">Username-based</SelectItem>
                    <SelectItem value="email">Email-based</SelectItem>
                  </SelectContent>
                </Select>
                {hasPartnerFilters && (
                  <Button onClick={() => { setPartnerSearch(""); setPartnerTypeFilter("all"); }} size="sm" variant="outline" className="h-9">
                    <X className="h-4 w-4 mr-1" />Clear
                  </Button>
                )}
                <div className="ml-auto">
                  <Button variant="outline" size="sm" onClick={fetchCredentials} disabled={loading} className="h-9">
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                </div>
              </div>

              <CredentialsTable
                credentials={filteredCredentials}
                loading={loading}
                onViewDetails={(c) => { setSelectedCredential(c); setViewModalOpen(true); }}
                onResetPassword={(c) => { setSelectedCredential(c); setResetModalOpen(true); }}
              />
            </div>
          )}

          {/* ── ACSL Agents Tab ─────────────────────────────────────── */}
          {activeTab === "saa" && (
            <UserCredentialsSection
              users={saaUsers}
              loadingState={loadingSaa}
              onRefresh={() => fetchUsersByRole("acsl_agent", setSaaUsers, setLoadingSaa)}
              copiedField={copiedField}
              onCopy={copyToClipboard}
            />
          )}

          {/* ── Super Admins Tab ───────────────────────────────────────────── */}
          {activeTab === "super-admins" && (
            <UserCredentialsSection
              users={superAdminUsers}
              loadingState={loadingSuperAdmins}
              onRefresh={() => fetchUsersByRole("super_admin", setSuperAdminUsers, setLoadingSuperAdmins)}
              copiedField={copiedField}
              onCopy={copyToClipboard}
            />
          )}
        </div>

        <ViewCredentialModal
          isOpen={viewModalOpen}
          onClose={() => setViewModalOpen(false)}
          credential={selectedCredential}
        />
        <ResetPasswordModal
          isOpen={resetModalOpen}
          onClose={() => setResetModalOpen(false)}
          credential={selectedCredential}
          onSuccess={handleResetSuccess}
        />
      </DashboardLayout>
    </ProtectedRoute>
  );
};

export default CredentialsPage;
