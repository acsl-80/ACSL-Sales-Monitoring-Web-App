
import React, { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, CreditCard, CheckCircle2, Eye } from "lucide-react";
import { AdminSales } from "@/types/adminSales";
import paymentModelService from "../../../services/paymentModelService";

interface InstallmentPayment {
  id: string;
  amount: number;
  payment_method: string;
  payment_date: string;
  notes?: string;
  recorded_by: string;
  created_at: string;
  recorder?: { id?: string; full_name?: string; email?: string };
}

interface PaymentSummaryData {
  total_amount: number;
  total_paid: number;
  remaining: number;
  progress_percent: number;
  payment_status: string;
  is_installment: boolean;
  payment_count: number;
}

interface PaymentModel {
  id: string;
  name: string;
  duration_months: number;
  fixed_price: number;
  min_down_payment?: number;
}

interface PaymentHistoryModalProps {
  open: boolean;
  onClose: () => void;
  sale: AdminSales | null;
}

const formatCurrency = (amount: number) =>
  `₦${Number(amount ?? 0).toLocaleString("en-NG")}`;

const formatPaymentMethod = (method: string) => {
  if (!method) return "-";
  return method
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

const PaymentHistoryModal: React.FC<PaymentHistoryModalProps> = ({
  open,
  onClose,
  sale,
}) => {
  const [payments, setPayments] = useState<InstallmentPayment[]>([]);
  const [summary, setSummary] = useState<PaymentSummaryData | null>(null);
  const [paymentModel, setPaymentModel] = useState<PaymentModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [noteModal, setNoteModal] = useState<{ open: boolean; note: string }>({
    open: false,
    note: "",
  });

  const isInstallment = sale?.is_installment === true;

  const fetchPayments = useCallback(async () => {
    if (!sale?.id || !isInstallment) return;
    try {
      setLoading(true);
      const result = await paymentModelService.getInstallmentPayments(sale.id);
      // Edge function returns: { success, data: [...payments], summary: {...}, payment_model: {...} }
      setPayments(result.data || []);
      setSummary(result.summary || null);
      setPaymentModel(result.payment_model || null);
    } catch (err) {
      console.error("Error fetching payment history:", err);
    } finally {
      setLoading(false);
    }
  }, [sale?.id, isInstallment]);

  useEffect(() => {
    if (open && isInstallment) {
      fetchPayments();
    }
    if (!open) {
      setPayments([]);
      setSummary(null);
      setPaymentModel(null);
    }
  }, [open, isInstallment, fetchPayments]);

  if (!sale) return null;

  const saleAmount = sale.amount || 0;
  const totalPaid = summary?.total_paid ?? sale.total_paid ?? 0;
  const amountOwed = isInstallment ? Math.max(saleAmount - totalPaid, 0) : 0;
  const totalPaidDisplay = isInstallment ? totalPaid : saleAmount;

  return (
    <>
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">
            Payment History — {sale.transaction_id || "N/A"}
          </DialogTitle>
        </DialogHeader>

        {/* Order Summary (3-column, like ERP) */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Customer</span>
              <p className="font-medium truncate">
                {sale.end_user_name || "N/A"}
              </p>
            </div>
            <div>
              <span className="text-gray-500">Total Amount</span>
              <p className="font-bold">{formatCurrency(saleAmount)}</p>
            </div>
            <div>
              <span className="text-gray-500">Outstanding Balance</span>
              <p className="font-bold text-red-600">
                {formatCurrency(amountOwed)}
              </p>
            </div>
          </div>
        </div>

        {/* Payment Model Info */}
        {isInstallment && (paymentModel || sale.payment_model) && (
          <div className="flex items-center gap-2 text-sm text-gray-600 px-1">
            <CreditCard className="h-4 w-4 flex-shrink-0" />
            <span>
              {paymentModel?.name || sale.payment_model?.name} —{" "}
              {paymentModel?.duration_months ||
                sale.payment_model?.duration_months}{" "}
              monthly installments
            </span>
            <span className="mx-1 text-gray-300">|</span>
            <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
            <span>
              {summary?.payment_count ?? payments.length} of{" "}
              {paymentModel?.duration_months ||
                sale.payment_model?.duration_months ||
                "—"}{" "}
              payments
            </span>
          </div>
        )}

        {/* Non-installment sales */}
        {!isInstallment && (
          <div className="text-center py-8 text-gray-500">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-500" />
            <p className="font-medium text-lg">Full Payment</p>
            <p className="text-sm">Paid in full at time of sale</p>
          </div>
        )}

        {/* Payments Table (ERP-style) */}
        {isInstallment && (
          <div>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                <span className="ml-2 text-sm text-gray-500">
                  Loading payments...
                </span>
              </div>
            ) : payments.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm border border-gray-200 rounded-lg">
                No payments recorded yet.
              </div>
            ) : (
              <>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow
                        className="hover:bg-brand"
                        style={{ backgroundColor: "#063664" }}
                      >
                        <TableHead className="text-white font-semibold">
                          Amount
                        </TableHead>
                        <TableHead className="text-white font-semibold">
                          Method
                        </TableHead>
                        <TableHead className="text-white font-semibold">
                          Recorded By
                        </TableHead>
                        <TableHead className="text-white font-semibold">
                          Date
                        </TableHead>
                        <TableHead className="text-white font-semibold">
                          Notes
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map((payment, idx) => (
                        <TableRow
                          key={payment.id}
                          className={
                            idx % 2 === 0 ? "bg-white" : "bg-blue-50/50"
                          }
                        >
                          <TableCell className="font-semibold text-green-700">
                            {formatCurrency(payment.amount)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="text-xs capitalize"
                            >
                              {formatPaymentMethod(payment.payment_method)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {payment.recorder?.full_name || "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {new Date(
                              payment.payment_date
                            ).toLocaleDateString("en-GB", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                            })}
                          </TableCell>
                          <TableCell>
                            {payment.notes ? (
                              <button
                                onClick={() =>
                                  setNoteModal({
                                    open: true,
                                    note: payment.notes!,
                                  })
                                }
                                className="flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs"
                              >
                                <Eye className="h-4 w-4" />
                                View
                              </button>
                            ) : (
                              <span className="text-gray-400 text-xs">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Total Paid line */}
                <div className="flex justify-end pt-2 pr-2">
                  <span className="text-sm font-bold text-green-700">
                    Total Paid: {formatCurrency(totalPaidDisplay)}
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>

    <Dialog
      open={noteModal.open}
      onOpenChange={() => setNoteModal({ open: false, note: "" })}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Payment Note</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-700 whitespace-pre-wrap">
          {noteModal.note}
        </p>
      </DialogContent>
    </Dialog>
    </>
  );
};

export default PaymentHistoryModal;
