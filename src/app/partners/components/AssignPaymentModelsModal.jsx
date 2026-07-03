
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Layers,
  Loader2,
  Save,
  AlertCircle,
  Check,
  Clock,
  CreditCard,
} from "lucide-react";
import paymentModelService from "../../services/paymentModelService";

const AssignPaymentModelsModal = ({ organization, onClose, onSuccess }) => {
  const [allModels, setAllModels] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError("");

        const [modelsResult, assignedResult] = await Promise.all([
          paymentModelService.getPaymentModels({ show_all: "false" }),
          paymentModelService.getOrgPaymentModels(organization.id),
        ]);

        setAllModels(modelsResult.data || []);

        const assignedIds = (assignedResult.data || []).map(
          (a) => a.payment_model?.id
        ).filter(Boolean);
        setSelectedIds(new Set(assignedIds));
      } catch (err) {
        setError(err.message || "Failed to load data");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [organization.id]);

  const toggleModel = (modelId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError("");
      await paymentModelService.setOrgPaymentModels(
        organization.id,
        Array.from(selectedIds)
      );
      onSuccess();
    } catch (err) {
      setError(err.message || "Failed to save assignments");
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (amount) =>
    `₦${Number(amount).toLocaleString("en-NG")}`;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-brand" />
            Assign Payment Models
          </DialogTitle>
          <DialogDescription>
            Select which payment models{" "}
            <span className="font-medium">{organization.partner_name}</span> can
            use for installment sales.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col flex-1 min-h-0 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
              <span className="text-red-700 text-sm">{error}</span>
            </div>
          )}

          <p className="text-sm text-gray-600">
            <span className="font-medium text-brand">{selectedIds.size}</span>{" "}
            model{selectedIds.size !== 1 ? "s" : ""} selected
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-brand" />
              <span className="ml-2 text-sm text-gray-600">Loading...</span>
            </div>
          ) : allModels.length === 0 ? (
            <div className="text-center py-8">
              <Layers className="h-8 w-8 mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">
                No active payment models available. Create one first.
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-2">
              {allModels.map((model) => {
                const isSelected = selectedIds.has(model.id);
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => toggleModel(model.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-colors ${
                      isSelected
                        ? "bg-blue-50 border-blue-200 hover:bg-blue-100"
                        : "bg-white border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                        isSelected
                          ? "bg-brand border-brand"
                          : "border-gray-300"
                      }`}
                    >
                      {isSelected && (
                        <Check className="h-3 w-3 text-white" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900">{model.name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <CreditCard className="h-3 w-3" />
                          {formatCurrency(model.fixed_price)}
                        </span>
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {model.duration_months} months
                        </span>
                      </div>
                    </div>
                    {isSelected && (
                      <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-xs flex-shrink-0">
                        Assigned
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-2 flex-shrink-0 border-t">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || loading}
              className="bg-brand hover:bg-brand/90 text-white"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AssignPaymentModelsModal;
