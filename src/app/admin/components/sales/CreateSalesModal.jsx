
import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import CreateSalesForm from "./CreateSalesForm";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const CreateSalesModal = ({ open, onOpenChange, onSuccess }) => {
  const [showSuccess, setShowSuccess] = useState(false);
  const [createdSale, setCreatedSale] = useState(null);

  const handleSuccess = (saleData) => {
    setCreatedSale(saleData);
    setShowSuccess(true);
  };

  const handleClose = () => {
    setShowSuccess(false);
    setCreatedSale(null);
    onOpenChange(false);
    if (onSuccess && createdSale) {
      onSuccess(createdSale);
    }
  };

  const handleViewSales = () => {
    handleClose();
  };

  return (
    <Modal
      open={open}
      onOpenChange={handleClose}
      title={showSuccess ? "Sale Created Successfully!" : "Create New Sale"}
      description={
        showSuccess
          ? "The sale has been recorded and will be processed."
          : "Record a new stove sale transaction"
      }
      className="max-w-5xl max-h-[90vh] overflow-hidden"
    >
      {showSuccess ? (
        <div className="text-center p-8">
          <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
          <div className="flex justify-center gap-4">
            <Button onClick={handleViewSales}>Close</Button>
          </div>
        </div>
      ) : (
        <div className="h-full">
          <CreateSalesForm
            isModal={true}
            showSuccessState={false}
            onSuccess={handleSuccess}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      )}
    </Modal>
  );
};

export default CreateSalesModal;
