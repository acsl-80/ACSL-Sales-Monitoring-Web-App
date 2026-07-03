
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import CreateSalesForm from "./CreateSalesForm";
import { CheckCircle2 } from "lucide-react";
import { useAuth } from "../../../contexts/useAuth";

const SalesFormModal = ({
  open,
  onOpenChange,
  onSuccess,
  mode = "create",
  saleData = null,
}) => {
  const { user, userRole } = useAuth();
  const [showSuccess, setShowSuccess] = useState(false);
  const [processedSale, setProcessedSale] = useState(null);
  const [step, setStep] = useState("init");

  const isEditMode = mode === "edit";

  useEffect(() => {
    if (open) {
      setShowSuccess(false);
      setProcessedSale(null);
      sessionStorage.removeItem("saa_selected_org_id");
      sessionStorage.removeItem("saa_selected_org_name");
      setStep("form");
    }
  }, [open]);

  const handleSuccess = (resultData) => {
    setProcessedSale(resultData);
    setShowSuccess(true);
  };

  const handleClose = () => {
    setShowSuccess(false);
    setProcessedSale(null);
    onOpenChange(false);
    if (onSuccess && processedSale) {
      onSuccess(processedSale);
    }
  };

  const modalTitle = isEditMode ? "Edit Sale" : "Create New Sale";
  const modalSubtitle = isEditMode
    ? `Transaction: ${saleData?.transaction_id || ""}`
    : "Record a new stove sale transaction";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-5 py-3 bg-gradient-to-r from-blue-50/80 to-sky-50/80 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base font-bold text-foreground">
                {showSuccess
                  ? isEditMode ? "Sale Updated" : "Sale Created"
                  : modalTitle}
              </DialogTitle>
              {!showSuccess && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {modalSubtitle}
                </p>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="overflow-y-auto flex-1">
          {showSuccess ? (
            <div className="flex flex-col items-center justify-center py-16 px-5 gap-4">
              <CheckCircle2 className="h-12 w-12 text-green-600" />
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">
                  {isEditMode ? "Sale updated successfully!" : "Sale created successfully!"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {isEditMode
                    ? "The sale has been updated and changes are saved."
                    : "The sale has been recorded and will be processed."}
                </p>
              </div>
              <Button onClick={handleClose} className="h-8 text-xs px-5 bg-brand hover:bg-brand/90 text-white">
                Close
              </Button>
            </div>
          ) : step === "form" ? (
            <CreateSalesForm
              isModal={true}
              showSuccessState={false}
              mode={mode}
              initialData={saleData}
              onSuccess={handleSuccess}
              onCancel={() => onOpenChange(false)}
              userRole={userRole}
              userId={user?.id}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SalesFormModal;
