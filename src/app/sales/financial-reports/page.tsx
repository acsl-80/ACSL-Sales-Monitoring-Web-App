
import DashboardLayout from "../../components/DashboardLayout";
import ProtectedRoute from "../../components/ProtectedRoute";
import FinancialReportsView from "../../admin/components/financial-reports/FinancialReportsView";
import salesAdvancedService from "../../services/salesAdvancedAPIService";

const loadSales = () =>
  salesAdvancedService.getSalesData({ limit: 500, responseFormat: "format2" }, "POST", "FinancialReports");

const SuperAdminFinancialReportsPage = () => (
  <ProtectedRoute requireSuperAdmin>
    <DashboardLayout currentRoute="financial-reports">
      <FinancialReportsView loadSales={loadSales} viewFrom="superAdmin" />
    </DashboardLayout>
  </ProtectedRoute>
);

export default SuperAdminFinancialReportsPage;
