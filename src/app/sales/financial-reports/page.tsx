
import DashboardLayout from "../../components/DashboardLayout";
import ProtectedRoute from "../../components/ProtectedRoute";
import FinancialReportsView from "../../admin/components/financial-reports/FinancialReportsView";
const SuperAdminFinancialReportsPage = () => (
  <ProtectedRoute requireSuperAdmin>
    <DashboardLayout currentRoute="financial-reports" title="Financial Reports">
      <FinancialReportsView viewFrom="superAdmin" />
    </DashboardLayout>
  </ProtectedRoute>
);

export default SuperAdminFinancialReportsPage;
