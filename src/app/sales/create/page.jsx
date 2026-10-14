import { Suspense, useEffect } from "react";
import { useRouter } from "@/compat/navigation";
import ProtectedRoute from "../../components/ProtectedRoute";
import DashboardLayout from "../../components/DashboardLayout";
import { useAuth } from "../../contexts/useAuth";
import { useToastNotification } from "../../contexts/useToastNotification";
import CreateSalesForm from "../../admin/components/sales/CreateSalesForm";


function CreateSaleView() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToastNotification();

  // Reset any persisted partner/org selection so the form starts fresh
  // whenever the user enters or leaves the Sell Stove page.
  useEffect(() => {
    const clearSelection = () => {
      if (typeof sessionStorage === "undefined") return;
      sessionStorage.removeItem("saa_selected_org_id");
      sessionStorage.removeItem("saa_selected_org_name");
    };
    clearSelection();
    return clearSelection;
  }, []);

  const handleSuccess = (_sale, { sharesPhoneWith = [] } = {}) => {
    // A number shared with other sales is allowed (a family can share one
    // phone); the seller is told which, so a wrong number can still be caught.
    const others = sharesPhoneWith.map((r) => r.transaction_id).filter(Boolean);
    toast.success(
      "Sale Created Successfully",
      others.length > 0
        ? `The sale has been recorded. Its phone number is also on sale ${others.slice(0, 3).join(", ")}${others.length > 3 ? ` and ${others.length - 3} more` : ""}, under a different name.`
        : "The sale has been recorded and will be processed."
    );
    router.push("/sales");
  };

  const handleCancel = () => {
    router.push("/sales");
  };


  return (
    <DashboardLayout
      currentRoute="sales-create"
      title="Sell Stove"
      description="Record a new stove sale transaction"
    >
      <div className="px-6 pb-6 pt-2">
        <div className="bg-white p-6">
          <CreateSalesForm
            isModal={false}
            showSuccessState={true}
            onSuccess={handleSuccess}
            onCancel={handleCancel}
            cancelHref="/sales"
            userRole={user?.role}
            userId={user?.id}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}

export default function SalesCreatePage() {
  return (
    <ProtectedRoute requireAdminAccess>
      <Suspense fallback={<div className="p-6 text-gray-500">Loading...</div>}>
        <CreateSaleView />
      </Suspense>
    </ProtectedRoute>
  );
}
