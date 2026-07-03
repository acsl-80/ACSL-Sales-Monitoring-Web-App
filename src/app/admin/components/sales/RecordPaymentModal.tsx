
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CreditCard,
  Loader2,
  Save,
  AlertCircle,
} from "lucide-react";
import paymentModelService from "../../../services/paymentModelService";

interface SaleSummary {
  transactionId?: string;
  customerName?: string;
  totalAmount: number;
  amountPaid: number;
  amountOwed: number;
}

interface RecordPaymentModalProps {
  saleId: string;
  remainingBalance: number;
  onClose: () => void;
  onSuccess: () => void;
  saleSummary?: SaleSummary;
}

const RecordPaymentModal: React.FC<RecordPaymentModalProps> = ({
  saleId,
  remainingBalance,
  onClose,
  onSuccess,
  saleSummary,
}) => {
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const formatCurrency = (val: number) =>
    `₦${Number(val).toLocaleString("en-NG")}`;

  const handleSave = async () => {
    setError("");

    if (!amount || parseFloat(amount) <= 0) {
      setError("Please enter a valid payment amount");
      return;
    }
    if (parseFloat(amount) > remainingBalance) {
      setError(
        `Amount exceeds remaining balance of ${formatCurrency(remainingBalance)}`
      );
      return;
    }
    if (!paymentMethod) {
      setError("Please select a payment method");
      return;
    }

    try {
      setSaving(true);
      await paymentModelService.recordInstallmentPayment(saleId, {
        amount: parseFloat(amount),
        payment_method: paymentMethod,
        payment_date: paymentDate,
        notes: notes || undefined,
      });
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Failed to record payment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size="3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-brand" />
            Record Payment for {saleSummary?.customerName || "Customer"}
          </DialogTitle>
          <DialogDescription>
            Outstanding Balance:{" "}
            <span className="font-bold text-red-600">
              {formatCurrency(remainingBalance)}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* {saleSummary && (
            <div className="py-2 border-b">
              <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
                {saleSummary.transactionId && (
                  <div>
                    <span className="text-gray-500 block text-xs uppercase font-semibold">Transaction ID</span>
                    <p className="font-medium text-base">{saleSummary.transactionId}</p>
                  </div>
                )}
                {saleSummary.customerName && (
                  <div>
                    <span className="text-gray-500 block text-xs uppercase font-semibold">Customer</span>
                    <p className="font-medium text-base">{saleSummary.customerName}</p>
                  </div>
                )}
                <div>
                  <span className="text-gray-500 block text-xs uppercase font-semibold">Total</span>
                  <p className="font-bold text-base text-gray-900">{formatCurrency(saleSummary.totalAmount)}</p>
                </div>
                <div>
                  <span className="text-gray-500 block text-xs uppercase font-semibold">Paid</span>
                  <p className="font-bold text-base text-green-700">{formatCurrency(saleSummary.amountPaid)}</p>
                </div>
              </div>
            </div>
          )} */}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
              <span className="text-red-700 text-sm">{error}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="paymentAmount">Amount (₦) *</Label>
              <Input
                id="paymentAmount"
                type="number"
                value={amount}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "" || parseFloat(val) <= remainingBalance) {
                    setAmount(val);
                  }
                }}
                placeholder="Enter amount"
                min="0"
                max={remainingBalance}
                step="0.01"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="paymentMethod">Method *</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                  <SelectItem value="pos">POS</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentDate">Payment Date</Label>
            <Input
              id="paymentDate"
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentNotes">Notes (Optional)</Label>
            <textarea
              id="paymentNotes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes..."
              rows={2}
              className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-gray-600 ring-offset-background placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>

          <div className="flex justify-end space-x-3 pt-2 border-t">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-brand hover:bg-brand/90 text-white"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Recording...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Record Payment
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RecordPaymentModal;
