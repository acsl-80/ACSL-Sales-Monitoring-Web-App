
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "../../contexts/useAuth";
import DashboardLayout from "../../components/DashboardLayout";
import ProtectedRoute from "../../components/ProtectedRoute";
import { useToast } from "@/components/ui/toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Layers,
  Plus,
  Search,
  Loader2,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
  Save,
  Calendar,
  CreditCard as CreditCardIcon,
  Trophy,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  CircleDashed,
} from "lucide-react";
import PageHeader from "../../components/PageHeader";
import paymentModelService from "../../services/paymentModelService";
import adminSalesService from "../../services/adminSalesService";
import FinancialReportsTable from "../../admin/components/financial-reports/FinancialReportsTable";
import { AdminSales } from "@/types/adminSales";

interface PaymentModel {
  id: string;
  name: string;
  description: string | null;
  duration_months: number;
  fixed_price: number;
  min_down_payment: number;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  creator?: { id: string; full_name: string; email: string };
  assigned_organizations_count?: number;
}

interface FormData {
  name: string;
  description: string;
  duration_months: string;
  fixed_price: string;
  min_down_payment: string;
}

const initialFormData: FormData = {
  name: "",
  description: "",
  duration_months: "",
  fixed_price: "",
  min_down_payment: "0",
};

const PAGE_SIZE_OPTIONS = [10, 25, 50];

export default function PaymentModelsPage() {
  const { userRole } = useAuth();
  const { toast } = useToast();

  const [models, setModels] = useState<PaymentModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all | active | inactive
  const [topModel, setTopModel] = useState<{ name: string; use_count: number } | null>(null);

  // Sort
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedModel, setSelectedModel] = useState<PaymentModel | null>(null);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Top model sales modal
  const [showTopModelModal, setShowTopModelModal] = useState(false);
  const [topModelSales, setTopModelSales] = useState<AdminSales[]>([]);
  const [topModelSalesLoading, setTopModelSalesLoading] = useState(false);
  const [topModelSalesPage, setTopModelSalesPage] = useState(1);
  const [topModelSalesPageSize, setTopModelSalesPageSize] = useState(10);
  const [topModelSalesTotal, setTopModelSalesTotal] = useState(0);

  const openTopModelModal = async () => {
    if (!topModel) return;
    const modelRecord = models.find((m) => m.name === topModel.name);
    if (!modelRecord) return;
    setShowTopModelModal(true);
    setTopModelSalesLoading(true);
    setTopModelSalesPage(1);
    try {
      const result = await adminSalesService.getFinancialReportSales({
        page: 1,
        limit: 10,
        paymentModelId: modelRecord.id,
      });
      setTopModelSales(result.data || []);
      setTopModelSalesTotal(result.pagination?.total || result.data?.length || 0);
    } catch (err: any) {
      toast({ variant: "destructive", title: err.message || "Failed to load sales" });
    } finally {
      setTopModelSalesLoading(false);
    }
  };

  const fetchTopModelSalesPage = async (page: number, size: number) => {
    if (!topModel) return;
    const modelRecord = models.find((m) => m.name === topModel.name);
    if (!modelRecord) return;
    setTopModelSalesLoading(true);
    try {
      const result = await adminSalesService.getFinancialReportSales({
        page,
        limit: size,
        paymentModelId: modelRecord.id,
      });
      setTopModelSales(result.data || []);
      setTopModelSalesTotal(result.pagination?.total || result.data?.length || 0);
      setTopModelSalesPage(page);
      setTopModelSalesPageSize(size);
    } catch (err: any) {
      toast({ variant: "destructive", title: err.message || "Failed to load sales" });
    } finally {
      setTopModelSalesLoading(false);
    }
  };

  const fetchModels = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = { show_all: "true" };
      if (searchTerm.trim()) params.search = searchTerm.trim();
      if (statusFilter !== "all") params.status = statusFilter;
      const result = await paymentModelService.getPaymentModels(params);
      setModels(result.data || []);
      if (result.top_model) setTopModel(result.top_model);
    } catch (err: any) {
      toast({ variant: "destructive", title: err.message || "Failed to load payment models" });
    } finally {
      setLoading(false);
    }
  }, [searchTerm, statusFilter, toast]);

  useEffect(() => {
    const t = setTimeout(() => { fetchModels(); setCurrentPage(1); }, 300);
    return () => clearTimeout(t);
  }, [fetchModels]);

  // Client-side sort + pagination
  const sortedModels = [...models].sort((a, b) => {
    const aVal = new Date(a.created_at).getTime();
    const bVal = new Date(b.created_at).getTime();
    return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
  });
  const totalRecords = sortedModels.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const startRecord = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endRecord = Math.min(currentPage * pageSize, totalRecords);
  const pagedModels = sortedModels.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const getVisiblePages = () => {
    const pages: number[] = [];
    let start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + 4);
    start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  // Stats
  const activeCount = models.filter((m) => m.is_active).length;
  const inactiveCount = models.filter((m) => !m.is_active).length;

  const hasActiveFilters = searchTerm !== "" || statusFilter !== "all";

  const handleClearFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setCurrentPage(1);
  };

  const handleCreate = async () => {
    try {
      setSaving(true);
      setFormError("");
      if (!formData.name.trim()) { setFormError("Name is required"); return; }
      if (!formData.duration_months || parseInt(formData.duration_months) < 1) { setFormError("Duration must be at least 1 month"); return; }
      if (!formData.fixed_price || parseFloat(formData.fixed_price) <= 0) { setFormError("Sales price must be greater than 0"); return; }
      await paymentModelService.createPaymentModel({
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        duration_months: parseInt(formData.duration_months),
        fixed_price: parseFloat(formData.fixed_price),
        min_down_payment: parseFloat(formData.min_down_payment) || 0,
      });
      toast({ variant: "success", title: "Payment model created successfully" });
      setShowCreateModal(false);
      setFormData(initialFormData);
      fetchModels();
    } catch (err: any) {
      setFormError(err.message || "Failed to create payment model");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedModel) return;
    try {
      setSaving(true);
      setFormError("");
      await paymentModelService.updatePaymentModel(selectedModel.id, {
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        duration_months: parseInt(formData.duration_months),
        fixed_price: parseFloat(formData.fixed_price),
        min_down_payment: parseFloat(formData.min_down_payment) || 0,
      });
      toast({ variant: "success", title: "Payment model updated successfully" });
      setShowEditModal(false);
      setSelectedModel(null);
      fetchModels();
    } catch (err: any) {
      setFormError(err.message || "Failed to update payment model");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedModel) return;
    try {
      setSaving(true);
      await paymentModelService.deletePaymentModel(selectedModel.id);
      toast({ variant: "success", title: "Payment model deleted/deactivated" });
      setShowDeleteModal(false);
      setSelectedModel(null);
      fetchModels();
    } catch (err: any) {
      toast({ variant: "destructive", title: err.message || "Failed to delete" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (model: PaymentModel) => {
    try {
      await paymentModelService.updatePaymentModel(model.id, { is_active: !model.is_active });
      toast({ variant: "success", title: `Payment model ${model.is_active ? "deactivated" : "activated"}` });
      fetchModels();
    } catch (err: any) {
      toast({ variant: "destructive", title: err.message || "Failed to toggle status" });
    }
  };

  const openEditModal = (model: PaymentModel) => {
    setSelectedModel(model);
    setFormData({
      name: model.name,
      description: model.description || "",
      duration_months: String(model.duration_months),
      fixed_price: String(model.fixed_price),
      min_down_payment: String(model.min_down_payment),
    });
    setFormError("");
    setShowEditModal(true);
  };

  const openCreateModal = () => {
    setFormData(initialFormData);
    setFormError("");
    setShowCreateModal(true);
  };

  const formatCurrency = (amount: number) =>
    `₦${amount.toLocaleString("en-NG", { minimumFractionDigits: 0 })}`;

  const formatAmountInput = (value: string) => {
    const digits = value.replace(/[^0-9]/g, "");
    if (!digits) return "";
    return Number(digits).toLocaleString("en-NG");
  };

  const parseAmountInput = (value: string) => value.replace(/[^0-9]/g, "");

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <ProtectedRoute requireSuperAdmin>
      <DashboardLayout currentRoute="settings" title="Payment Models">
        <div className="p-6 space-y-5">
          <PageHeader
            icon={Layers}
            title="Payment Models"
            right={
              userRole === "super_admin" ? (
                <Button
                  onClick={openCreateModal}
                  size="sm"
                  className="bg-green-500 hover:bg-green-600 text-white flex items-center gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  Create Model
                </Button>
              ) : undefined
            }
          />

          {/* Stats Cards */}
          {(() => {
            const cards = [
              {
                gradient: "from-[#194977] to-[#2563EB]",
                Icon: Layers,
                value: models.length.toString(),
                label: "Total Models",
                sub: "All payment plans",
                clickable: false,
                filterKey: null as string | null,
              },
              {
                gradient: "from-[#047857] to-[#10B981]",
                Icon: CheckCircle2,
                value: activeCount.toString(),
                label: "Active",
                sub: statusFilter === "active" ? "Click to clear filter" : "Click to filter",
                clickable: true,
                filterKey: "active",
              },
              {
                gradient: "from-[#334155] to-[#64748b]",
                Icon: CircleDashed,
                value: inactiveCount.toString(),
                label: "Inactive",
                sub: statusFilter === "inactive" ? "Click to clear filter" : "Click to filter",
                clickable: true,
                filterKey: "inactive",
              },
              {
                gradient: "from-[#B45309] to-[#F59E0B]",
                Icon: Trophy,
                value: topModel ? topModel.name : "—",
                label: "Top Used Model",
                sub: topModel ? `${topModel.use_count} sale${topModel.use_count !== 1 ? "s" : ""} · Click to view` : "No sales yet",
                clickable: !!topModel,
                filterKey: null,
                isTopModel: true,
              },
            ] as const;

            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {cards.map(({ gradient, Icon, value, label, sub, clickable, filterKey, ...rest }) => {
                  const isTopModel = (rest as any).isTopModel === true;
                  const isActive = clickable && filterKey !== null && statusFilter === filterKey;
                  const handleClick = isTopModel
                    ? openTopModelModal
                    : clickable && filterKey !== null
                    ? () => { setStatusFilter((f) => f === filterKey ? "all" : filterKey); setCurrentPage(1); }
                    : undefined;

                  return isActive ? (
                    <div
                      key={label}
                      onClick={handleClick}
                      className={`relative overflow-hidden rounded-lg border-transparent px-4 py-3.5 shadow-md cursor-pointer transition-all bg-gradient-to-br ${gradient} ring-2 ring-white/40`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xl font-bold text-white tracking-tight leading-tight truncate">{value}</p>
                          <p className="text-[11px] font-semibold text-white/80 mt-0.5">{label}</p>
                          <p className="text-[10px] text-white/60 mt-0.5 truncate">{sub}</p>
                        </div>
                        <div className="rounded-lg p-1.5 bg-white/20 text-white shadow-sm shrink-0">
                          <Icon className="h-4 w-4" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={label}
                      onClick={handleClick}
                      className={`relative overflow-hidden rounded-lg border bg-white px-4 py-3.5 shadow-sm transition-all group ${clickable ? "cursor-pointer hover:shadow-md" : ""}`}
                    >
                      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${gradient}`} />
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xl font-bold text-gray-900 tracking-tight leading-tight truncate">{value}</p>
                          <p className="text-[11px] font-semibold text-gray-500 mt-0.5">{label}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5 truncate">{sub}</p>
                        </div>
                        <div className={`rounded-lg p-1.5 bg-gradient-to-br ${gradient} text-white shadow-sm shrink-0`}>
                          <Icon className="h-4 w-4" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* Filter Bar */}
          <div className="bg-blue-50 p-3 rounded-lg border border-gray-200 flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="w-1/4 min-w-[180px] relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search models..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                className="pl-9 bg-white h-9 text-sm"
              />
            </div>

            {/* Status filter */}
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}>
              <SelectTrigger className="w-[140px] h-9 bg-white text-sm">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>

            {/* Clear */}
            {hasActiveFilters && (
              <Button onClick={handleClearFilters} size="sm" variant="outline" className="h-9">
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>

          {/* Table */}
          <div className="space-y-0">
            {/* Pagination header */}
            <div className="bg-blue-50 rounded-t-lg px-4 py-2 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <p className="text-sm text-gray-600">
                  Showing <span className="font-medium">{startRecord}–{endRecord}</span> of{" "}
                  <span className="font-medium">{totalRecords}</span> models
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">per page:</span>
                  <Select value={pageSize.toString()} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}>
                    <SelectTrigger className="w-[65px] h-7 bg-white text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s.toString()}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-sm font-bold text-green-500">
                Total Models: <span className="text-brand">{totalRecords}</span>
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
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Model Name</TableHead>
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Sales Price</TableHead>
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Duration</TableHead>
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Min Down Payment</TableHead>
                    <TableHead className="text-white font-semibold text-xs whitespace-nowrap">Status</TableHead>
                    <TableHead
                      className="text-white font-semibold text-xs whitespace-nowrap cursor-pointer select-none"
                      onClick={() => { setSortOrder((o) => o === "asc" ? "desc" : "asc"); setCurrentPage(1); }}
                    >
                      <div className="flex items-center">
                        Created
                        {sortOrder === "asc"
                          ? <ArrowUp className="h-3 w-3 ml-1" />
                          : <ArrowDown className="h-3 w-3 ml-1" />}
                      </div>
                    </TableHead>
                    <TableHead className="text-center text-white font-semibold text-xs whitespace-nowrap">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className={loading ? "opacity-40" : ""}>
                  {pagedModels.length === 0 && !loading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12">
                        <Layers className="h-8 w-8 mx-auto text-gray-300 mb-2" />
                        <p className="text-sm text-gray-500">No payment models found</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    pagedModels.map((model, idx) => (
                      <TableRow
                        key={model.id}
                        className={`${idx % 2 === 0 ? "bg-white" : "bg-blue-50/50"} hover:bg-gray-50 text-gray-700 ${!model.is_active ? "opacity-60" : ""}`}
                      >
                        <TableCell className="text-xs font-medium text-gray-900">
                          {model.name}
                          {model.description && (
                            <p className="text-[10px] text-gray-400 mt-0.5 truncate max-w-[180px]">{model.description}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-semibold text-gray-900">
                          {formatCurrency(model.fixed_price)}
                        </TableCell>
                        <TableCell className="text-xs text-gray-600">
                          {model.duration_months} month{model.duration_months !== 1 ? "s" : ""}
                        </TableCell>
                        <TableCell className="text-xs text-gray-600">
                          {model.min_down_payment > 0 ? formatCurrency(model.min_down_payment) : "None"}
                        </TableCell>
                        <TableCell>
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                            model.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                          }`}>
                            {model.is_active ? "Active" : "Inactive"}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-gray-600">{formatDate(model.created_at)}</TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() => openEditModal(model)}
                            >
                              <Pencil className="h-3 w-3 mr-1" />
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className={`h-7 px-2 text-xs ${model.is_active ? "text-amber-600 border-amber-200 hover:bg-amber-50" : "text-green-600 border-green-200 hover:bg-green-50"}`}
                              onClick={() => handleToggleActive(model)}
                            >
                              {model.is_active
                                ? <><ToggleLeft className="h-3 w-3 mr-1" />Deactivate</>
                                : <><ToggleRight className="h-3 w-3 mr-1" />Activate</>}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs text-red-600 border-red-200 hover:bg-red-50"
                              onClick={() => { setSelectedModel(model); setShowDeleteModal(true); }}
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
                  Showing {startRecord} to {endRecord} of {totalRecords} models
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
                  <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setCurrentPage((p) => p + 1)} disabled={currentPage === totalPages}>
                    Next<ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Create/Edit Modal */}
        {(showCreateModal || showEditModal) && (
          <Dialog
            open={showCreateModal || showEditModal}
            onOpenChange={() => {
              setShowCreateModal(false);
              setShowEditModal(false);
              setSelectedModel(null);
              setFormError("");
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {showCreateModal ? "Create Payment Model" : "Edit Payment Model"}
                </DialogTitle>
                <DialogDescription>
                  {showCreateModal
                    ? "Define a new installment payment plan."
                    : `Update "${selectedModel?.name}" payment model.`}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                {formError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                    <span className="text-red-700 text-sm">{formError}</span>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="model-name">Model Name *</Label>
                  <Input
                    id="model-name"
                    placeholder="e.g., Amina Model"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="model-desc">Description</Label>
                  <Input
                    id="model-desc"
                    placeholder="Optional description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="model-price">Sales Price (₦) *</Label>
                    <Input
                      id="model-price"
                      type="text"
                      inputMode="numeric"
                      placeholder="e.g., 80,000"
                      value={formatAmountInput(formData.fixed_price)}
                      onChange={(e) => setFormData({ ...formData, fixed_price: parseAmountInput(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="model-duration">Duration (months) *</Label>
                    <Input
                      id="model-duration"
                      type="number"
                      placeholder="e.g., 6"
                      value={formData.duration_months}
                      onChange={(e) => setFormData({ ...formData, duration_months: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="model-downpayment">Minimum Down Payment (₦)</Label>
                  <Input
                    id="model-downpayment"
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={formatAmountInput(formData.min_down_payment)}
                    onChange={(e) => setFormData({ ...formData, min_down_payment: parseAmountInput(e.target.value) })}
                  />
                  <p className="text-xs text-gray-500">Leave at 0 if no minimum is required</p>
                </div>

                {formData.fixed_price && formData.duration_months && (
                  <div className="bg-brand/5 border border-brand/20 rounded-lg p-3">
                    <p className="text-sm text-gray-700">
                      Monthly payment:{" "}
                      <span className="font-semibold text-brand">
                        {formatCurrency(
                          Math.ceil(
                            parseFloat(formData.fixed_price) / parseInt(formData.duration_months)
                          )
                        )}
                      </span>
                      <span className="text-gray-500"> / month</span>
                    </p>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => { setShowCreateModal(false); setShowEditModal(false); }}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  onClick={showCreateModal ? handleCreate : handleEdit}
                  disabled={saving}
                  className="bg-brand hover:bg-brand/90 text-white"
                >
                  {saving ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</>
                  ) : (
                    <><Save className="h-4 w-4 mr-2" />{showCreateModal ? "Create" : "Save Changes"}</>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Top Model Sales Modal */}
        {showTopModelModal && topModel && (
          <Dialog open onOpenChange={() => setShowTopModelModal(false)}>
            <DialogContent className="max-w-[95vw] w-full max-h-[90vh] flex flex-col">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-amber-500" />
                  {topModel.name}
                </DialogTitle>
                <DialogDescription>
                  {topModel.use_count} sale{topModel.use_count !== 1 ? "s" : ""} using this payment model
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-y-auto flex-1 mt-2">
                <FinancialReportsTable
                  data={topModelSales}
                  loading={topModelSalesLoading}
                  currentPage={topModelSalesPage}
                  pageSize={topModelSalesPageSize}
                  totalRecords={topModelSalesTotal}
                  onPageChange={(p) => fetchTopModelSalesPage(p, topModelSalesPageSize)}
                  onPageSizeChange={(s) => fetchTopModelSalesPage(1, s)}
                  onViewDetails={() => {}}
                  onViewHistory={() => {}}
                  onRecordPayment={() => {}}
                  sortOrder="desc"
                  onToggleSort={() => {}}
                  viewFrom="superAdmin"
                />
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteModal && selectedModel && (
          <Dialog open onOpenChange={() => setShowDeleteModal(false)}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle className="text-red-600">Delete Payment Model</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete &quot;{selectedModel.name}&quot;? If this model has associated sales, it will be deactivated instead.
                </DialogDescription>
              </DialogHeader>
              <div className="flex justify-end gap-3 pt-4">
                <Button variant="outline" onClick={() => setShowDeleteModal(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleDelete} disabled={saving}>
                  {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting...</> : "Delete"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DashboardLayout>
    </ProtectedRoute>
  );
}
