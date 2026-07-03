
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import DashboardLayout from "../../components/DashboardLayout";
import FinancialReportsView from "../../admin/components/financial-reports/FinancialReportsView";
import SalesFormModal from "../../admin/components/sales/SalesFormModal";
import adminSalesService from "../../services/adminSalesService";
import salesAdvancedService from "../../services/salesAdvancedAPIService";
import superAdminAgentService from "../../services/superAdminAgentService";
import { AdminSales } from "@/types/adminSales";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, ShoppingCart, Download, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "@/compat/navigation";
import PageHeader from "../../components/PageHeader";
import { useAuth } from "../../contexts/useAuth";
import { usePermissions } from "../../hooks/usePermissions";
import ApproveSaleConfirmModal from "@/app/admin/components/sales/ApproveSaleConfirmModal";
import CancelSaleModal from "@/app/admin/components/sales/CancelSaleModal";
// import ApproveSaleConfirmModal from "../../admin/components/sales/ApproveSaleConfirmModal";

export default function UnifiedSalesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, userRole } = useAuth() as any;
  const { can } = usePermissions();

  const isSuperAdmin = userRole === "super_admin";
  const isAcslAgent = userRole === "acsl_agent" || userRole === "super_admin_agent";
  const isAcslAgentManager = userRole === "acsl_agent_manager";
  const isPartner = userRole === "partner" || userRole === "admin";

  const viewFrom = isSuperAdmin ? "superAdmin" : ((isAcslAgent || isAcslAgentManager) ? "acsl_agent" : (isPartner ? "admin" : "agent"));

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  const CURRENT_YEAR = new Date().getFullYear();
  const YEARS = Array.from({ length: CURRENT_YEAR - 2023 }, (_, i) => 2024 + i);
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);

  const exportFnRef = useRef<(() => void) | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selectedExportCount, setSelectedExportCount] = useState(0);

  const [editSale, setEditSale] = useState<AdminSales | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [approveSale, setApproveSale] = useState<AdminSales | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AdminSales | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const initialPartnerFilter = searchParams.get("partner") ?? "";

  // Auto-open create modal if ?create=true is in URL
  useEffect(() => {
    if (searchParams.get("create") === "true") {
      setShowCreateModal(true);
      // Clean up URL
      router.replace("/sales");
    }
  }, [searchParams, router]);

  // Single fetch path for every role — get-sales-advanced scopes rows
  // server-side per the RBAC matrix (all / assigned orgs / own org / own sales).
  const loadSales = useCallback(async () => {
    return salesAdvancedService.getSalesData(
      { limit: 1000, responseFormat: "format2" },
      "POST",
      "ManageSales"
    );
  }, []);

  const handleEditSale = useCallback(async (sale: AdminSales) => {
    try {
      setEditLoading(true);
      const result = await (adminSalesService as any).getSale(sale.id);
      if (result.success && result.data) {
        setEditSale(result.data);
      } else {
        setEditSale(sale);
      }
    } catch {
      setEditSale(sale);
    } finally {
      setEditLoading(false);
    }
  }, []);

  const handleDeleteSale = useCallback(async (sale: AdminSales) => {
    if (window.confirm(`Are you sure you want to delete the sale for ${sale.end_user_name}?`)) {
      try {
        const result = await adminSalesService.deleteSale(sale.id);
        if (result.success) {
          reload();
        } else {
          alert(result.error || "Failed to delete sale");
        }
      } catch (err: any) {
        alert(err.message || "An error occurred");
      }
    }
  }, []);

  const handleCancelSale = useCallback((sale: AdminSales) => {
    setCancelTarget(sale);
  }, []);

  const confirmCancelSale = useCallback(async (reason: string) => {
    if (!cancelTarget) return;
    const result = await (adminSalesService as any).cancelSale(cancelTarget.id, reason);
    if (result?.success) {
      setCancelTarget(null);
      reload();
    } else {
      alert(result?.error || "Failed to cancel sale");
    }
  }, [cancelTarget]);

  return (
    <DashboardLayout currentRoute="sales" title="Sales Record">
      <div className="p-6 space-y-6">
        <PageHeader
          icon={ShoppingCart}
          title="Sales Record"
          right={
            <div className="flex items-center gap-3">
              {isSuperAdmin && (
                <>
                  <span className="text-sm font-medium text-gray-700">Year:</span>
                  <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                    <SelectTrigger className="w-[110px] h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {YEARS.map((y) => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
              {(isSuperAdmin || isPartner) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs flex items-center gap-1.5"
                  disabled={exporting}
                  onClick={() => {
                    if (exportFnRef.current) {
                      setExporting(true);
                      Promise.resolve(exportFnRef.current()).finally(() => setExporting(false));
                    }
                  }}
                >
                  {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Export{selectedExportCount > 0 ? ` (${selectedExportCount})` : ""}
                </Button>
              )}
              {can("create-sale") && (
                <Button
                  size="sm"
                  className="bg-green-500 hover:bg-green-600 text-white flex items-center gap-1.5"
                  onClick={() => setShowCreateModal(true)}
                >
                  <Plus className="h-4 w-4" />
                  Create Sale
                </Button>
              )}
            </div>
          }
        />

        <FinancialReportsView
          key={reloadKey}
          loadSales={loadSales}
          onEditSale={handleEditSale}
          onDeleteSale={handleDeleteSale}
          onCancelSale={handleCancelSale}
          onApproveSale={(isAcslAgent || isAcslAgentManager) ? setApproveSale : undefined}
          viewFrom={viewFrom as any}
          selectedYear={isSuperAdmin ? selectedYear : undefined}
          onYearChange={isSuperAdmin ? (v) => setSelectedYear(v ?? CURRENT_YEAR) : undefined}
          availableYears={isSuperAdmin ? YEARS : undefined}
          onExportReady={(fn) => { exportFnRef.current = fn; }}
          onSelectionChange={setSelectedExportCount}
          initialSearchTerm={initialPartnerFilter}
        />
      </div>

      {editLoading && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-lg px-8 py-6 flex items-center gap-4 shadow-lg">
            <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
            <span className="text-gray-700 font-medium">Loading sale details...</span>
          </div>
        </div>
      )}

      {editSale && (
        <SalesFormModal
          open={true}
          onOpenChange={(open: boolean) => { if (!open) setEditSale(null); }}
          mode="edit"
          saleData={editSale as any}
          onSuccess={() => { setEditSale(null); reload(); }}
        />
      )}

      {showCreateModal && (
        <SalesFormModal
          open={true}
          onOpenChange={setShowCreateModal}
          mode="create"
          onSuccess={() => { setShowCreateModal(false); reload(); }}
        />
      )}

      <ApproveSaleConfirmModal
        open={!!approveSale}
        onClose={() => setApproveSale(null)}
        saleId={approveSale?.id || ""}
        customerName={approveSale?.end_user_name || ""}
        onApproved={() => { setApproveSale(null); reload(); }}
      />

      <CancelSaleModal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancelSale}
        sale={cancelTarget}
      />
    </DashboardLayout>
  );
}
