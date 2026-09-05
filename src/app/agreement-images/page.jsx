import { useState, useEffect, useRef } from "react";
import DashboardLayout from "../components/DashboardLayout";
import ProtectedRoute from "../components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Search,
  FileImage,
  Loader2,
  Image as ImageIcon,
  Download,
  AlertCircle,
  X,
  Printer,
  ZoomIn,
  FileText,
  User,
  Phone,
  MapPin,
  Building2,
  Package,
  Calendar,
  Hash,
  CreditCard,
  ScrollText,
} from "lucide-react";
import agreementImagesService from "../services/agreementImagesService";
import { getSupabase } from "@/lib/supabaseClient";
import {
  buildAgreementBlobUrl,
  downloadAgreementPDF,
} from "../admin/components/sales/agreement/AgreementPDFGenerator";
import PdfImagePreview from "./PdfImagePreview";
import { formatDate as formatDateShared } from "@/app/utils/formatDate";
import { formatCurrency as formatCurrencyShared } from "@/app/utils/formatCurrency";
import { fieldLabel } from "@/lib/saleDictionary";


const BRAND = "#4a5d0f";
const BRAND_SOFT = "#eef3c4";

const formatDate = (v) => formatDateShared(v, { empty: "—", style: "long" });

const formatMoney = (v) => formatCurrencyShared(v, { empty: "—" });

const pick = (obj, keys) => {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "")
      return obj[k];
  }
  return null;
};

const StatusBadge = ({ status }) => {
  const s = (status || "").toLowerCase();
  const map = {
    completed: "bg-green-100 text-green-800 border-green-200",
    active: "bg-green-100 text-green-800 border-green-200",
    pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
    incomplete: "bg-red-100 text-red-800 border-red-200",
    assigned: "bg-blue-100 text-blue-800 border-blue-200",
    cancelled: "bg-gray-200 text-gray-700 border-gray-300",
  };
  return (
    <Badge
      className={`${map[s] || "bg-gray-100 text-gray-800 border-gray-200"} border capitalize`}
    >
      {status || "—"}
    </Badge>
  );
};

const Field = ({ icon: Icon, label, value, mono = false }) => (
  <div className="flex items-start gap-3 py-2.5">
    {Icon && (
      <div
        className="mt-0.5 h-8 w-8 shrink-0 rounded-md flex items-center justify-center"
        style={{ background: BRAND_SOFT, color: BRAND }}
      >
        <Icon className="h-4 w-4" />
      </div>
    )}
    <div className="min-w-0 flex-1">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">
        {label}
      </div>
      <div
        className={`text-sm text-gray-900 break-words ${
          mono ? "font-mono" : "font-medium"
        }`}
      >
        {value ?? "—"}
      </div>
    </div>
  </div>
);

const SectionTitle = ({ children }) => (
  <div className="flex items-center gap-2 mb-2">
    <div className="h-4 w-1 rounded" style={{ background: BRAND }} />
    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
      {children}
    </h3>
  </div>
);

const AgreementImagesPage = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [currentImage, setCurrentImage] = useState(null);
  const [imageDetails, setImageDetails] = useState(null);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(false);
  const [fallbackPdfUrl, setFallbackPdfUrl] = useState(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const latestSerialRef = useRef("");
  const pdfUrlRef = useRef(null);

  const resetResults = () => {
    setCurrentImage(null);
    setImageDetails(null);
    setError("");
    if (pdfUrlRef.current) {
      try {
        URL.revokeObjectURL(pdfUrlRef.current);
      } catch {}
      pdfUrlRef.current = null;
    }
    setFallbackPdfUrl(null);
  };

  const runSearch = async (searchSerial) => {
    latestSerialRef.current = searchSerial;
    setSearching(true);
    setError("");
    setCurrentImage(null);
    setImageDetails(null);
    if (pdfUrlRef.current) {
      try {
        URL.revokeObjectURL(pdfUrlRef.current);
      } catch {}
      pdfUrlRef.current = null;
    }
    setFallbackPdfUrl(null);

    try {
      // Query Supabase directly for sale details (avoids stale edge function 404s).
      let details = null;
      try {
        const supabase = getSupabase();
        const { data: saleRow } = await supabase
          .from("sales")
          .select("*, uploads:agreement_image_id (id, public_id, url, type, created_at)")
          .eq("stove_serial_no", searchSerial)
          .limit(1)
          .maybeSingle();

        if (latestSerialRef.current !== searchSerial) return;

        if (saleRow) {
          const { uploads, ...saleRest } = saleRow;
          details = { sale: saleRest, image: uploads || null, source: "sales" };
        } else {
          const { data: cancelledRow } = await supabase
            .from("cancelled_purchases")
            .select("*")
            .eq("stove_serial_no", searchSerial)
            .limit(1)
            .maybeSingle();
          if (latestSerialRef.current !== searchSerial) return;
          if (cancelledRow) {
            details = {
              sale: cancelledRow,
              image: null,
              source: "cancelled_purchases",
            };
          }
        }
      } catch (fallbackErr) {
        console.error("Direct sales lookup failed:", fallbackErr);
      }

      if (!details) {
        setError(`No sale found for serial number: ${searchSerial}`);
        return;
      }


      setImageDetails(details);

      let imageResponse = { success: false, data: null };
      if (details?.image?.id || details?.sale?.agreement_image_id) {
        imageResponse = await agreementImagesService.getAgreementImageBinary(
          searchSerial
        );
        if (latestSerialRef.current !== searchSerial) return;
      }

      if (imageResponse.success) {
        setCurrentImage(imageResponse.data);
      } else {
        setGeneratingPdf(true);
        try {
          const sale = details.sale || {};
          const pdfUrl = await buildAgreementBlobUrl(sale);
          if (latestSerialRef.current !== searchSerial) {
            try {
              URL.revokeObjectURL(pdfUrl);
            } catch {}
            return;
          }
          pdfUrlRef.current = pdfUrl;
          setFallbackPdfUrl(pdfUrl);
        } catch (pdfErr) {
          console.error("PDF generation failed:", pdfErr);
          if (latestSerialRef.current === searchSerial) {
            setError(
              "No signed agreement image is on file for this stove, and the fallback agreement PDF could not be generated."
            );
          }
        } finally {
          if (latestSerialRef.current === searchSerial) {
            setGeneratingPdf(false);
          }
        }
      }
    } catch (e) {
      if (latestSerialRef.current === searchSerial) {
        setError(e.message || "An unexpected error occurred");
      }
    } finally {
      if (latestSerialRef.current === searchSerial) {
        setSearching(false);
      }
    }
  };

  // Live search as you type (debounced)
  useEffect(() => {
    const trimmed = searchTerm.trim();
    if (!trimmed) {
      latestSerialRef.current = "";
      resetResults();
      setSearching(false);
      setGeneratingPdf(false);
      return;
    }
    if (trimmed.length < 4) {
      latestSerialRef.current = trimmed;
      resetResults();
      setSearching(false);
      setGeneratingPdf(false);
      return;
    }
    const t = setTimeout(() => {
      runSearch(trimmed);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  const handleDownload = () => {
    if (currentImage) {
      const link = document.createElement("a");
      link.href = currentImage.imageUrl;
      link.download = `agreement_${currentImage.serialNumber || "image"}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }
    if (imageDetails?.sale) {
      downloadAgreementPDF(imageDetails.sale).catch((err) =>
        console.error("Download failed:", err)
      );
    }
  };

  const handlePrint = () => window.print();

  useEffect(() => {
    return () => {
      if (currentImage?.imageUrl)
        agreementImagesService.cleanupImageUrl(currentImage.imageUrl);
    };
  }, [currentImage]);

  useEffect(() => {
    return () => {
      if (fallbackPdfUrl) {
        try {
          URL.revokeObjectURL(fallbackPdfUrl);
        } catch {}
      }
    };
  }, [fallbackPdfUrl]);

  const hasAnyResult = Boolean(currentImage || fallbackPdfUrl);


  const sale = imageDetails?.sale || {};
  const image = imageDetails?.image || {};

  const endUserName = pick(sale, ["end_user_name", "customer_name", "name"]);
  const phone = pick(sale, ["phone", "contact_phone", "end_user_phone"]);
  const contactPerson = sale.contact_person;
  const state = pick(sale, ["state_backup", "state", "state_name"]);
  const lga = pick(sale, ["lga_backup", "lga", "lga_name"]);
  const address = pick(sale, ["address", "full_address", "street_address"]);
  const partner = pick(sale, [
    "partner_name",
    "organization_name",
    "organizations_name",
  ]);
  const salesModel = pick(sale, [
    "sales_model_name",
    "sales_model",
    "payment_model_name",
    "payment_model",
    "model_name",
  ]);
  const totalAmount = pick(sale, [
    "total_amount",
    "price",
    "stove_price",
    "amount",
  ]);
  const deposit = pick(sale, [
    "deposit_amount",
    "down_payment",
    "initial_payment",
  ]);
  const balance = pick(sale, ["balance", "outstanding_balance"]);
  const txId = pick(sale, ["transaction_id", "sale_id"]);

  return (
    <ProtectedRoute requireSuperAdmin={true}>
      <DashboardLayout
        currentRoute="agreement-images"
        title="Agreement Images"
        description="Search transactions and view the signed agreement form."
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 print:p-0">
          {/* Header + Search */}
          <div
            className="relative overflow-hidden rounded-xl mb-6 print:hidden"
            style={{
              background: `linear-gradient(135deg, ${BRAND} 0%, #6b8113 100%)`,
            }}
          >
            <div className="absolute inset-0 opacity-10 pointer-events-none">
              <ScrollText className="absolute -right-6 -top-6 h-48 w-48 text-white" />
            </div>
            <div className="relative px-6 py-6 sm:px-8 sm:py-8 text-white">
              <div className="flex items-center gap-2 text-white/80 text-xs uppercase tracking-widest mb-1">
                <FileText className="h-4 w-4" />
                User Agreement Lookup
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold mb-1">
                Agreement Images
              </h1>
              <p className="text-white/85 text-sm mb-5 max-w-2xl">
                Enter a stove serial number to retrieve the signed agreement
                form and the associated transaction details.
              </p>
              <div className="max-w-2xl">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Start typing stove serial number (e.g., 101052766)"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 pr-10 h-11 bg-white text-gray-900"
                  />
                  {(searching || generatingPdf) && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-gray-500" />
                  )}
                </div>
              </div>
            </div>
          </div>

          {error && (
            <Card className="mb-6 border-l-4 border-l-red-500 bg-red-50 print:hidden">
              <CardContent className="p-4 flex items-center gap-2 text-red-800">
                <AlertCircle className="h-5 w-5" />
                <span className="font-medium">Error:</span>
                <span>{error}</span>
              </CardContent>
            </Card>
          )}

          {searching && (
            <div className="flex items-center justify-center py-24 text-gray-500">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Loading agreement…
            </div>
          )}

          {/* Empty state */}
          {!hasAnyResult && !error && !searching && !generatingPdf && (
            <Card className="text-center py-16 border-dashed">
              <CardContent>
                <div
                  className="mx-auto mb-4 h-20 w-20 rounded-full flex items-center justify-center"
                  style={{ background: BRAND_SOFT, color: BRAND }}
                >
                  <FileImage className="h-10 w-10" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">
                  No agreement loaded
                </h3>
                <p className="text-gray-600 max-w-md mx-auto">
                  Enter a stove serial number above to view the signed
                  agreement form and transaction details for that sale.
                </p>
              </CardContent>
            </Card>
          )}

          {generatingPdf && !hasAnyResult && (
            <div className="flex items-center justify-center py-24 text-gray-500">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Generating agreement document…
            </div>
          )}

          {/* Result */}
          {hasAnyResult && (

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 print:grid-cols-1">
              {/* Agreement Form (left) */}
              <div className="lg:col-span-3">
                <Card className="overflow-hidden shadow-sm">
                  <div
                    className="px-6 py-4 border-b flex items-center justify-between"
                    style={{ background: BRAND_SOFT }}
                  >
                    <div>
                      <div className="text-[11px] uppercase tracking-widest text-[#4a5d0f]/80 font-semibold">
                        Transaction Agreement
                      </div>
                      <div className="text-lg font-bold text-gray-900">
                        {txId ? `Ref: ${txId}` : "Sale Details"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 print:hidden">
                      <StatusBadge status={sale.status} />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handlePrint}
                        className="border-[#4a5d0f] text-[#4a5d0f] hover:bg-white"
                      >
                        <Printer className="h-4 w-4 mr-1" />
                        Print
                      </Button>
                    </div>
                  </div>

                  <CardContent className="p-6 space-y-6">
                    {/* End user */}
                    <div>
                      <SectionTitle>End User</SectionTitle>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                        <Field icon={User} label={fieldLabel("end_user_name")} value={endUserName} />
                        <Field icon={Phone} label={fieldLabel("phone")} value={phone} />
                        <Field
                          icon={User}
                          label={fieldLabel("contact_person")}
                          value={contactPerson}
                        />
                        <Field
                          icon={MapPin}
                          label="Location"
                          value={
                            [lga, state].filter(Boolean).join(", ") || null
                          }
                        />
                        {address && (
                          <div className="sm:col-span-2">
                            <Field
                              icon={MapPin}
                              label={fieldLabel("full_address")}
                              value={address}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    <Separator />

                    {/* Product */}
                    <div>
                      <SectionTitle>Product</SectionTitle>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                        <Field
                          icon={Hash}
                          label={fieldLabel("stove_serial_no")}
                          value={sale.stove_serial_no}
                          mono
                        />
                        <Field
                          icon={Calendar}
                          label={fieldLabel("sales_date")}
                          value={formatDate(sale.sales_date)}
                        />
                        <Field
                          icon={Building2}
                          label={fieldLabel("partner_name")}
                          value={partner}
                        />
                        <Field
                          icon={Package}
                          label={fieldLabel("payment_model_id")}
                          value={salesModel}
                        />
                      </div>
                    </div>

                    {(totalAmount || deposit || balance) && (
                      <>
                        <Separator />
                        <div>
                          <SectionTitle>Payment</SectionTitle>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6">
                            <Field
                              icon={CreditCard}
                              label={fieldLabel("amount")}
                              value={formatMoney(totalAmount)}
                            />
                            <Field
                              icon={CreditCard}
                              label="Deposit"
                              value={formatMoney(deposit)}
                            />
                            <Field
                              icon={CreditCard}
                              label="Balance"
                              value={formatMoney(balance)}
                            />
                          </div>
                        </div>
                      </>
                    )}

                    <Separator />

                    <div className="text-[11px] text-gray-500 flex items-center justify-between">
                      <span>Agreement uploaded: {formatDate(image.created_at)}</span>
                      {image.public_id && (
                        <span className="font-mono">{image.public_id}</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Agreement Image / Generated PDF (right) */}
              <div className="lg:col-span-2">
                <Card className="overflow-hidden shadow-sm sticky top-4">
                  <div
                    className="px-4 py-3 border-b flex items-center justify-between"
                    style={{ background: BRAND_SOFT }}
                  >
                    <div className="flex items-center gap-2 text-[#4a5d0f] font-semibold text-sm">
                      {currentImage ? (
                        <>
                          <ImageIcon className="h-4 w-4" />
                          Signed Agreement
                        </>
                      ) : (
                        <>
                          <FileText className="h-4 w-4" />
                          User Agreement (Generated)
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1 print:hidden">
                      {currentImage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setZoom(true)}
                          className="text-[#4a5d0f] hover:bg-white"
                        >
                          <ZoomIn className="h-4 w-4 mr-1" />
                          Zoom
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleDownload}
                        className="text-[#4a5d0f] hover:bg-white"
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Download
                      </Button>
                    </div>
                  </div>
                  {currentImage ? (
                    <div
                      className="relative bg-[repeating-linear-gradient(45deg,#f8f8f8,#f8f8f8_10px,#f1f1f1_10px,#f1f1f1_20px)] cursor-zoom-in"
                      onClick={() => setZoom(true)}
                    >
                      <img
                        src={currentImage.imageUrl}
                        alt={`Agreement for ${currentImage.serialNumber}`}
                        className="w-full h-auto max-h-[75vh] object-contain mx-auto"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    </div>
                  ) : (
                    <div className="relative bg-gray-100">
                      <div className="px-4 py-2 text-[11px] text-amber-800 bg-amber-50 border-b border-amber-200 flex items-start gap-2">
                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>
                          No signed agreement image is on file for this sale.
                          Showing the generated User Agreement document from the
                          transaction record.
                        </span>
                      </div>
                      {fallbackPdfUrl ? (
                        <PdfImagePreview url={fallbackPdfUrl} />
                      ) : (
                        <div className="flex items-center justify-center h-[40vh] text-gray-500">
                          <Loader2 className="h-5 w-5 animate-spin mr-2" />
                          Preparing document…
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              </div>

            </div>
          )}

          {/* Zoom modal */}
          {zoom && currentImage && (
            <div
              className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4"
              onClick={() => setZoom(false)}
            >
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-4 right-4 text-white hover:bg-white/10"
                onClick={() => setZoom(false)}
              >
                <X className="h-6 w-6" />
              </Button>
              <img
                src={currentImage.imageUrl}
                alt="Agreement full view"
                className="max-w-full max-h-full object-contain"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
};

export default AgreementImagesPage;
