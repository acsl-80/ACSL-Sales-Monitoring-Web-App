import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreditCard, Clock, Plus, Loader2, Layers, CheckCircle2, XCircle, FileText, Download } from "lucide-react";
import { AdminSales } from "@/types/adminSales";
import type { SuperAdminSale } from "@/types/superAdminSales";
import paymentModelService from "../../../services/paymentModelService";
import adminSalesService from "../../../services/adminSalesService";
import RecordPaymentModal from "./RecordPaymentModal";
import { buildAgreementBlobUrl, downloadAgreementPDF } from "./agreement/AgreementPDFGenerator";

interface InstallmentPayment {
  id: string;
  amount: number;
  payment_method: string;
  payment_date: string;
  notes?: string;
  recorded_by: string;
  created_at: string;
  recorder?: { full_name?: string };
}

interface AdminSalesDetailModalProps {
  open: boolean;
  onClose: () => void;
  viewFrom: "admin" | "superAdmin";
  sale?: AdminSales | SuperAdminSale | null | undefined;
  onSaleUpdated?: () => void;
}

const DetailItem = ({
  label,
  value,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) => (
  <div className="space-y-0">
    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
      {label}
    </p>
    <p className={`text-xs font-medium ${highlight ? "text-blue-600" : ""}`}>
      {value ?? <span className="text-gray-400">N/A</span>}
    </p>
  </div>
);

const SectionCard = ({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={`bg-muted/30 rounded-lg p-3 border border-border/50 ${className}`}>
    <h3 className="text-[10px] font-semibold text-primary uppercase tracking-wider border-b border-primary/20 pb-0.5 mb-2">
      {title}
    </h3>
    {children}
  </div>
);

const AdminSalesDetailModal: React.FC<AdminSalesDetailModalProps> = ({
  open,
  onClose,
  sale,
  viewFrom,
  onSaleUpdated,
}) => {
  // Full sale data fetched on open — enriches list data with address, images, creator
  const [fullSale, setFullSale] = useState<any>(null);
  const [fullSaleLoading, setFullSaleLoading] = useState(false);

  useEffect(() => {
    if (open && sale?.id) {
      setFullSaleLoading(true);
      (adminSalesService as any).getSale(sale.id).then((result: any) => {
        if (result.success && result.data) setFullSale(result.data);
      }).catch(() => {}).finally(() => setFullSaleLoading(false));
    } else if (!open) {
      setFullSale(null);
    }
  }, [open, sale?.id]);

  // Merge: full sale data takes priority, list sale as fallback
  const activeSale: any = fullSale || sale;

  const [installmentPayments, setInstallmentPayments] = useState<InstallmentPayment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [agreementPdfUrl, setAgreementPdfUrl] = useState<string | null>(null);
  const [agreementLoading, setAgreementLoading] = useState(false);
  const [paymentSummary, setPaymentSummary] = useState<{
    total_paid: number;
    remaining_balance: number;
    payment_count: number;
    fixed_price: number;
    progress_percent: number;
  } | null>(null);

  const isInstallment = activeSale?.is_installment === true;

  const fetchInstallmentPayments = useCallback(async () => {
    if (!activeSale?.id || !isInstallment) return;
    try {
      setPaymentsLoading(true);
      const result = await paymentModelService.getInstallmentPayments(activeSale.id);
      setInstallmentPayments(result.data || []);
      setPaymentSummary(result.summary || null);
    } catch (err) {
      console.error("Error fetching installment payments:", err);
    } finally {
      setPaymentsLoading(false);
    }
  }, [sale?.id, isInstallment]);

  useEffect(() => {
    if (open && isInstallment) fetchInstallmentPayments();
  }, [open, isInstallment, fetchInstallmentPayments]);

  const formatCurrency = (amount?: number | null) => {
    if (amount === undefined || amount === null) return "N/A";
    return `₦${Number(amount).toLocaleString("en-NG")}`;
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
    });
  };

  const handlePaymentRecorded = () => {
    setShowRecordPayment(false);
    fetchInstallmentPayments();
    onSaleUpdated?.();
  };

  // Generate the agreement PDF from the sale data and open it in the viewer
  const handleViewAgreement = async () => {
    if (!activeSale) return;
    try {
      setAgreementLoading(true);
      const url = await buildAgreementBlobUrl(activeSale);
      setAgreementPdfUrl(url);
    } catch (err) {
      console.error("Error generating agreement PDF:", err);
    } finally {
      setAgreementLoading(false);
    }
  };

  const handleDownloadAgreement = async () => {
    if (!activeSale) return;
    try {
      await downloadAgreementPDF(activeSale);
    } catch (err) {
      console.error("Error downloading agreement PDF:", err);
    }
  };

  // Revoke the blob URL when the viewer closes to avoid leaks
  const closeAgreementViewer = () => {
    if (agreementPdfUrl) URL.revokeObjectURL(agreementPdfUrl);
    setAgreementPdfUrl(null);
  };

  if (!sale) return null;

  const totalPaid = paymentSummary?.total_paid ?? (activeSale?.total_paid || 0);
  const saleAmount = activeSale?.amount || 0;
  const remainingBalance = paymentSummary?.remaining_balance ?? saleAmount - totalPaid;
  const progressPercent =
    paymentSummary?.progress_percent ??
    (saleAmount > 0 ? (totalPaid / saleAmount) * 100 : 0);
  const isFullyPaid = activeSale?.payment_status === "fully_paid";

  // Images — get-sale returns stove_image/agreement_image directly; list data uses stove_image_id
  const stoveImageUrl =
    activeSale?.stove_image?.url ||
    (viewFrom === "superAdmin"
      ? (sale as SuperAdminSale).stove_image?.url
      : (sale as AdminSales).stove_image_id?.url);

  // Agreement image is optional — only present if one was uploaded at sale creation
  const agreementImageUrl =
    activeSale?.agreement_image?.url ||
    (viewFrom === "superAdmin"
      ? (sale as SuperAdminSale).agreement_image?.url
      : (sale as AdminSales).agreement_image_id?.url);

  // Address — get-sale returns address; list data may have addresses (superAdmin) or address (admin)
  const address =
    activeSale?.address ||
    (viewFrom === "superAdmin"
      ? (sale as SuperAdminSale).addresses
      : (sale as AdminSales).address);

  // Creator — the name of the person who actually made the sale, regardless of role.
  const creatorName =
    activeSale?.creator?.full_name ||
    activeSale?.creator?.email ||
    (activeSale as AdminSales)?.agent_name ||
    null;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-6xl w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
          {/* Header */}
          <DialogHeader className="px-5 py-3 bg-gradient-to-r from-blue-50/80 to-sky-50/80 border-b shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-base font-bold text-foreground">
                  Sale Details
                </DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Transaction:{" "}
                  <span className="font-semibold text-primary">
                    {activeSale?.transaction_id || "N/A"}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* {activeSale && getStatusBadge(activeSale)} */}
                {isInstallment && !isFullyPaid && viewFrom !== "superAdmin" && (
                  <Button
                    size="sm"
                    className="bg-brand hover:bg-brand/90 text-white gap-1.5"
                    onClick={() => setShowRecordPayment(true)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Record Payment
                  </Button>
                )}
              </div>
            </div>
          </DialogHeader>

          {/* Scrollable content */}
          <div className="space-y-3 overflow-y-auto flex-1">
            {/* Loading overlay while fetching full details */}
            {fullSaleLoading && (
              <div className="flex items-center gap-2 text-xs text-gray-500 py-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading full details...
              </div>
            )}

            {/* Row 1: Sale Info + Customer Details */}
            <div className="grid grid-cols-2 gap-3">
              <SectionCard title="Sale Information">
                <div className="grid grid-cols-2 gap-2">
                  <DetailItem label="Sales Date" value={formatDate(activeSale?.sales_date)} />
                  <DetailItem label="Created" value={formatDate(activeSale?.created_at)} />
                  <DetailItem label="Stove Serial No" value={activeSale?.stove_serial_no} />
                  <DetailItem label="Partner Name" value={activeSale?.partner_name} />
                  <DetailItem label="Agent" value={creatorName} />
                  <DetailItem
                    label="Payment Type"
                    value={
                      isInstallment ? (
                        <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-[10px] px-1.5 py-0">
                          Installment
                        </Badge>
                      ) : (
                        <Badge className="bg-green-100 text-green-800 border-green-200 text-[10px] px-1.5 py-0">
                          Full Payment
                        </Badge>
                      )
                    }
                  />
                </div>
              </SectionCard>

              <SectionCard title="Customer Details">
                <div className="grid grid-cols-2 gap-2">
                  <DetailItem label="Customer Name" value={activeSale?.end_user_name} />
                  <DetailItem label="AKA" value={activeSale?.aka} />
                  <DetailItem label="Phone" value={activeSale?.phone} />
                  <DetailItem label="Other Phone" value={activeSale?.other_phone} />
                  <DetailItem label="Contact Person" value={activeSale?.contact_person} />
                  <DetailItem label="Contact Phone" value={activeSale?.contact_phone} />
                  {activeSale?.retailer_branch && (
                    <div className="col-span-2">
                      <DetailItem label="Retailer / Branch / Agency / CSO" value={activeSale.retailer_branch} />
                    </div>
                  )}
                </div>
              </SectionCard>
            </div>

            {/* Row 2: Location + Images */}
            <div className="grid grid-cols-2 gap-3">
              <SectionCard title="Location">
                <div className="grid grid-cols-2 gap-2">
                  <DetailItem label="State" value={sale.state_backup} />
                  <DetailItem label="LGA" value={sale.lga_backup} />
                  <DetailItem label="City" value={address?.city} />
                  <DetailItem label="Country" value={address?.country} />
                  <div className="col-span-2">
                    <DetailItem
                      label="Address"
                      value={address?.full_address || address?.street}
                    />
                  </div>
                  <DetailItem
                    label="Latitude"
                    value={
                      address?.latitude != null ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px] px-1.5 py-0 font-mono">
                          {address.latitude}
                        </Badge>
                      ) : undefined
                    }
                  />
                  <DetailItem
                    label="Longitude"
                    value={
                      address?.longitude != null ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px] px-1.5 py-0 font-mono">
                          {address.longitude}
                        </Badge>
                      ) : undefined
                    }
                  />
                </div>
              </SectionCard>

              <SectionCard title="Images & Documents">
                <div className="grid grid-cols-1 gap-2">
                  <DetailItem
                    label="Stove Image"
                    value={
                      stoveImageUrl ? (
                        <Button
                          size="sm"
                          className="bg-brand hover:bg-brand/90 text-white h-6 text-[10px] px-2.5"
                          onClick={() => setLightboxUrl(stoveImageUrl)}
                        >
                          View Image
                        </Button>
                      ) : undefined
                    }
                  />
                  <DetailItem
                    label="Agreement"
                    value={
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          size="sm"
                          className="bg-brand hover:bg-brand/90 text-white h-6 text-[10px] px-2.5"
                          onClick={handleViewAgreement}
                          disabled={agreementLoading || fullSaleLoading}
                        >
                          {agreementLoading ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <FileText className="h-3 w-3 mr-1" />
                          )}
                          View Agreement Document
                        </Button>
                        {agreementImageUrl && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] px-2.5"
                            onClick={() => setLightboxUrl(agreementImageUrl)}
                          >
                            View Agreement Image
                          </Button>
                        )}
                      </div>
                    }
                  />
                  <DetailItem
                    label="Signature"
                    value={
                      activeSale?.signature ? (
                        <img
                          src={`data:image/png;base64,${activeSale.signature}`}
                          alt="Signature"
                          className="h-8 w-24 object-contain border border-gray-200 rounded bg-white cursor-pointer hover:opacity-80"
                          onClick={() => setLightboxUrl(`data:image/png;base64,${activeSale.signature}`)}
                        />
                      ) : undefined
                    }
                  />
                </div>
              </SectionCard>
            </div>

            {/* Row 3: Financial Details — full width */}
            <div className="bg-gradient-to-r from-blue-50/50 to-green-50/50 rounded-lg p-3 border border-primary/10">
              <h3 className="text-[10px] font-semibold text-primary uppercase tracking-wider border-b border-primary/20 pb-0.5 mb-2">
                Financial Details
              </h3>
              <div className="grid grid-cols-4 gap-3">
                <DetailItem label="Total Amount" value={formatCurrency(saleAmount)} highlight />
                <DetailItem
                  label="Amount Paid"
                  value={
                    <span className="text-green-600 font-semibold">
                      {formatCurrency(isInstallment ? totalPaid : saleAmount)}
                    </span>
                  }
                />
                <DetailItem
                  label="Amount Owed"
                  value={
                    <span className={remainingBalance > 0 ? "text-red-600 font-semibold" : "text-green-600"}>
                      {formatCurrency(isInstallment ? remainingBalance : 0)}
                    </span>
                  }
                />
                <DetailItem
                  label="Payment Status"
                  value={activeSale && getStatusBadge(activeSale)}
                />
                {isInstallment && activeSale?.payment_model && (
                  <>
                    <DetailItem label="Payment Model" value={activeSale.payment_model.name} />
                    <DetailItem label="Duration" value={`${activeSale.payment_model.duration_months} months`} />
                    <DetailItem label="Installment Price" value={formatCurrency(activeSale.payment_model.fixed_price)} />
                    <DetailItem label="Progress" value={`${progressPercent.toFixed(0)}% complete`} />
                  </>
                )}
              </div>

              {/* Progress bar for installments */}
              {isInstallment && (
                <div className="mt-3 space-y-1">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{formatCurrency(totalPaid)} paid</span>
                    <span>{formatCurrency(remainingBalance)} remaining</span>
                  </div>
                  <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isFullyPaid ? "bg-green-500" : "bg-brand"}`}
                      style={{ width: `${Math.min(progressPercent, 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Stove Set & Cooking Habits */}
            {activeSale && (activeSale.pot_quantity != null || activeSale.heat_retention_device != null || activeSale.previous_stove_type) && (
              <div className="grid grid-cols-2 gap-3">
                <SectionCard title="Stove Set">
                  <div className="grid grid-cols-2 gap-2">
                    <DetailItem
                      label="Pots Quantity"
                      value={activeSale.pot_quantity != null ? `${activeSale.pot_quantity} pot${activeSale.pot_quantity !== 1 ? "s" : ""}` : undefined}
                    />
                    <DetailItem
                      label="Wonderbox (Heat Retention)"
                      value={activeSale.heat_retention_device != null ? (activeSale.heat_retention_device ? "Yes" : "No") : undefined}
                    />
                  </div>
                </SectionCard>

                <SectionCard title="Cooking Habits">
                  <div className="grid grid-cols-1 gap-2">
                    <DetailItem
                      label="Previous Stove"
                      value={
                        activeSale.previous_stove_type === "wood_stove"
                          ? "Wood Stove (3 stone)"
                          : activeSale.previous_stove_type === "charcoal"
                          ? "Charcoal Stove"
                          : activeSale.previous_stove_type === "other"
                          ? `Other — ${activeSale.previous_stove_other || "not specified"}`
                          : activeSale.previous_stove_type
                      }
                    />
                    <DetailItem label="Meals Per Day" value={activeSale.meals_per_day} />
                    <DetailItem label="Fuel Source" value={activeSale.cooking_fuel_source} />
                    <DetailItem label="Cooking Location" value={activeSale.cooking_location} />
                  </div>
                </SectionCard>
              </div>
            )}

            {/* Terms & Conditions */}
            {activeSale?.terms_accepted && (
              <SectionCard title="Terms & Conditions">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {([
                    { key: "poaGoverned", label: "PoA / UNFCCC governed" },
                    { key: "monitoring", label: "Agreed to monitoring" },
                    { key: "noResell", label: "Agreed not to resell" },
                    { key: "emissionReductions", label: "Ceded emission reductions" },
                    { key: "noExport", label: "Agreed not to export" },
                    { key: "demonstration", label: "Received demonstration" },
                  ] as const).map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-1.5">
                      {activeSale.terms_accepted?.[key] ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
                      )}
                      <span className="text-xs text-gray-700">{label}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            {/* Installment Payments History */}
            {isInstallment && (
              <SectionCard title="Payment History">
                {paymentsLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-brand" />
                    <span className="ml-2 text-xs text-gray-600">Loading payments...</span>
                  </div>
                ) : installmentPayments.length === 0 ? (
                  <div className="text-center py-4 text-xs text-gray-500">
                    No payments recorded yet.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {installmentPayments.map((payment, idx) => (
                      <div
                        key={payment.id}
                        className={`flex items-center justify-between px-2.5 py-2 rounded-lg border text-xs ${
                          idx % 2 === 0 ? "bg-white" : "bg-gray-50"
                        }`}
                      >
                        <div>
                          <span className="font-semibold text-gray-900">
                            {formatCurrency(payment.amount)}
                          </span>
                          <span className="ml-2 text-gray-500">
                            {new Date(payment.payment_date).toLocaleDateString("en-GB")}
                          </span>
                          {payment.recorder?.full_name && (
                            <span className="ml-2 text-gray-400">· {payment.recorder.full_name}</span>
                          )}
                          {payment.notes && (
                            <span className="ml-2 text-gray-400 italic">· {payment.notes}</span>
                          )}
                        </div>
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {payment.payment_method}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Image Lightbox */}
      <Dialog open={!!lightboxUrl} onOpenChange={(v) => !v && setLightboxUrl(null)}>
        <DialogContent className="max-w-3xl w-[90vw] p-0 overflow-hidden">
          <DialogHeader className="px-4 py-3 border-b">
            <DialogTitle className="text-sm font-semibold">Document Preview</DialogTitle>
          </DialogHeader>
          {lightboxUrl && (
            <div className="flex items-center justify-center bg-gray-50 p-4">
              <img
                src={lightboxUrl}
                alt="Document preview"
                className="max-w-full max-h-[75vh] object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Agreement PDF Viewer */}
      <Dialog open={!!agreementPdfUrl} onOpenChange={(v) => !v && closeAgreementViewer()}>
        <DialogContent className="max-w-5xl w-[95vw] p-0 overflow-hidden flex flex-col max-h-[90vh]">
          <DialogHeader className="px-4 py-3 border-b flex flex-row items-center justify-between shrink-0">
            <DialogTitle className="text-sm font-semibold">Agreement Document</DialogTitle>
            <Button
              size="sm"
              className="bg-brand hover:bg-brand/90 text-white h-7 text-xs"
              onClick={handleDownloadAgreement}
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download PDF
            </Button>
          </DialogHeader>
          {agreementPdfUrl && (
            <iframe
              src={agreementPdfUrl}
              title="Agreement Document"
              className="w-full flex-1 min-h-[70vh] bg-gray-50"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Record Payment Modal */}
      {showRecordPayment && activeSale?.id && (
        <RecordPaymentModal
          saleId={activeSale.id}
          remainingBalance={remainingBalance}
          onClose={() => setShowRecordPayment(false)}
          onSuccess={handlePaymentRecorded}
          saleSummary={{
            transactionId: activeSale.transaction_id,
            customerName: activeSale.end_user_name,
            totalAmount: saleAmount,
            amountPaid: totalPaid,
            amountOwed: remainingBalance,
          }}
        />
      )}
    </>
  );
};

function getStatusBadge(sale: AdminSales | SuperAdminSale) {
  const isInstallment = sale.is_installment;
  const totalPaid = sale.total_paid ?? 0;
  const owed = isInstallment ? (sale.amount || 0) - totalPaid : 0;
  if (!isInstallment || owed <= 0)
    return <Badge className="bg-green-100 text-green-800 border-green-200 text-[10px]">Paid</Badge>;
  if (totalPaid > 0 && owed > 0)
    return <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">Partial</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-red-200 text-[10px]">Unpaid</Badge>;
}

export default AdminSalesDetailModal;
