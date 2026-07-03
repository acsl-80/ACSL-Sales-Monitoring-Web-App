
import { useState } from "react";
import Image from "@/compat/Image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  X,
  Calendar,
  Banknote,
  MapPin,
  User,
  Phone,
  Mail,
  Package,
  FileText,
  Download,
  Edit,
  Trash2,
  Copy,
  ExternalLink,
  CheckCircle,
  Clock,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  generateReceiptPDF,
  generateInvoicePDF,
  generateReceiptHTML,
  downloadFile,
} from "@/lib/pdfUtils";
import { sendReceiptEmail, composeReceiptEmail } from "@/lib/emailService";
import { useToast } from "@/components/ui/toast";

const SalesDetailSidebar = ({ sale, isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState("overview");
  const [fullScreenImage, setFullScreenImage] = useState(null);
  const [loadingStates, setLoadingStates] = useState({
    downloadingReceipt: false,
    emailingReceipt: false,
    generatingInvoice: false,
    exporting: false,
  });
  const { toast } = useToast();

  if (!sale) return null;

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "Invalid Date";
    }
  };

  const formatCurrency = (amount) => {
    if (!amount && amount !== 0) return "₦0.00";
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const getStatusColor = (status) => {
    const colors = {
      active: "bg-green-100 text-green-800 border-green-200",
      pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
      completed: "bg-blue-100 text-blue-800 border-blue-200",
      cancelled: "bg-red-100 text-red-800 border-red-200",
      shipped: "bg-purple-100 text-purple-800 border-purple-200",
    };
    return colors[status?.toLowerCase()] || colors.active;
  };

  const getStatusIcon = (status) => {
    const icons = {
      active: CheckCircle,
      pending: Clock,
      completed: CheckCircle,
      cancelled: AlertCircle,
      shipped: Package,
    };
    const Icon = icons[status?.toLowerCase()] || CheckCircle;
    return <Icon className="h-4 w-4" />;
  };

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "customer", label: "Customer" },
    { id: "transaction", label: "Transaction" },
    { id: "product", label: "Product" },
    { id: "location", label: "Location" },
    { id: "attachments", label: "Attachments" },
  ];

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`, text);
  };

  const handleDownloadReceipt = async () => {
    try {
      setLoadingStates((prev) => ({ ...prev, downloadingReceipt: true }));

      // Try to generate PDF first
      try {
        const doc = await generateReceiptPDF(sale);
        const pdfOutput = doc.output("blob");
        const filename = `receipt-${sale.transaction_id || sale.id}-${
          new Date().toISOString().split("T")[0]
        }.pdf`;
        downloadFile(pdfOutput, filename, "application/pdf");

        // Show success message
        toast.success(
          "Receipt downloaded",
          "The receipt was downloaded successfully."
        );
      } catch (pdfError) {
        toast.info("PDF generation failed", "Falling back to HTML receipt.");

        // Fallback to HTML receipt
        const htmlContent = generateReceiptHTML(sale);
        const filename = `receipt-${sale.transaction_id || sale.id}-${
          new Date().toISOString().split("T")[0]
        }.html`;
        downloadFile(htmlContent, filename, "text/html");

        toast.success(
          "Receipt downloaded as HTML",
          "The receipt was downloaded as an HTML file."
        );
      }
    } catch (error) {
      toast.error(
        "Download failed",
        "Failed to download receipt. Please try again."
      );
    } finally {
      setLoadingStates((prev) => ({ ...prev, downloadingReceipt: false }));
    }
  };

  const handleEmailReceipt = async () => {
    try {
      setLoadingStates((prev) => ({ ...prev, emailingReceipt: true }));

      const email = sale.email || sale.contact_email;
      if (!email) {
        toast.error("No email", "No email address available for this customer");
        return;
      }

      // Try to send email via API first
      try {
        await sendReceiptEmail(sale, email);
        toast.success("Receipt sent", `Receipt sent successfully to ${email}`);
      } catch (emailError) {
        toast.info("Email API failed", "Falling back to mailto link.");

        // Fallback to mailto link
        const { subject, body } = composeReceiptEmail(sale);
        const mailtoLink = `mailto:${email}?subject=${subject}&body=${body}`;
        window.open(mailtoLink, "_blank");

        toast.info(
          "Email client opened",
          `Opening email client to send receipt to ${email}`
        );
      }
    } catch (error) {
      toast.error(
        "Send failed",
        "Failed to send receipt email. Please try again."
      );
    } finally {
      setLoadingStates((prev) => ({ ...prev, emailingReceipt: false }));
    }
  };

  const handleGenerateInvoice = async () => {
    try {
      setLoadingStates((prev) => ({ ...prev, generatingInvoice: true }));

      // Try to generate PDF invoice
      try {
        const doc = await generateInvoicePDF(sale);
        const pdfOutput = doc.output("blob");
        const filename = `invoice-${sale.transaction_id || sale.id}-${
          new Date().toISOString().split("T")[0]
        }.pdf`;
        downloadFile(pdfOutput, filename, "application/pdf");

        toast.success(
          "Invoice downloaded",
          "Invoice generated and downloaded successfully!"
        );
      } catch (pdfError) {
        toast.error(
          "PDF generation failed",
          "PDF generation is not available. Please install the required dependencies or use the export feature instead."
        );
      }
    } catch (error) {
      toast.error(
        "Invoice failed",
        "Failed to generate invoice. Please try again."
      );
    } finally {
      setLoadingStates((prev) => ({ ...prev, generatingInvoice: false }));
    }
  };

  const handleExport = async () => {
    try {
      setLoadingStates((prev) => ({ ...prev, exporting: true }));

      const exportData = {
        ...sale,
        exportDate: new Date().toISOString(),
        exportedBy: "Current User", // You'd get this from your auth context
        metadata: {
          exportVersion: "1.0",
          systemInfo: {
            userAgent: navigator.userAgent,
            timestamp: Date.now(),
          },
        },
      };

      const dataStr = JSON.stringify(exportData, null, 2);
      const filename = `sale-${sale.transaction_id || sale.id}-export-${
        new Date().toISOString().split("T")[0]
      }.json`;
      downloadFile(dataStr, filename, "application/json");

      toast.success("Exported", "Sale data exported successfully!");
    } catch (error) {
      toast.error(
        "Export failed",
        "Failed to export sale data. Please try again."
      );
    } finally {
      setLoadingStates((prev) => ({ ...prev, exporting: false }));
    }
  };

  const handleCopyId = () => {
    const id = sale.transaction_id || sale.id;
    copyToClipboard(id, "Transaction ID");
    toast.success(
      "Transaction ID copied",
      `Transaction ID ${id} copied to clipboard`
    );
  };

  const handleExternal = () => {
    // Store the sale data in localStorage so the detail page can access it
    localStorage.setItem(
      `sale_${sale.transaction_id || sale.id}`,
      JSON.stringify(sale)
    );

    // Open in external page
    const url = `/sales/${sale.transaction_id || sale.id}`;
    window.open(url, "_blank");
  };

  const openFullScreenImage = (imageSrc, title) => {
    setFullScreenImage({ src: imageSrc, title });
  };

  const closeFullScreenImage = () => {
    setFullScreenImage(null);
  };

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed top-0 right-0 h-full bg-white shadow-2xl transform transition-all duration-300 ease-in-out z-50 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        } ${isOpen ? "w-full sm:w-[90vw] md:w-[500px] lg:w-[600px]" : "w-0"}`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg sm:text-xl font-bold text-gray-900 truncate">
                Sale Details
              </h2>
              <p className="text-sm text-gray-600 mt-1 truncate">
                {sale.stove_serial_no || "Atmosfair Product"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="hover:bg-white/50 flex-shrink-0 ml-4"
            >
              <X className="h-5 w-5 text-gray-800" />
            </Button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-200 bg-gray-50 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 min-w-0 px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? "text-blue-600 border-b-2 border-blue-600 bg-white"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {activeTab === "overview" && (
              <div className="space-y-4 sm:space-y-6">
                {/* Status & Actions */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
                      <CardTitle className="text-base sm:text-lg">
                        Status & Actions
                      </CardTitle>
                      <Badge
                        className={getStatusColor(sale.status || "active")}
                      >
                        {getStatusIcon(sale.status || "active")}
                        <span className="ml-1">{sale.status || "Active"}</span>
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs sm:text-sm"
                        onClick={handleExport}
                        disabled={loadingStates.exporting}
                      >
                        {loadingStates.exporting ? (
                          <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2 animate-spin" />
                        ) : (
                          <Download className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                        )}
                        <span className="hidden xs:inline">
                          {loadingStates.exporting ? "Exporting..." : "Export"}
                        </span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs sm:text-sm"
                        onClick={handleCopyId}
                      >
                        <Copy className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                        <span className="hidden xs:inline">Copy ID</span>
                      </Button>
                    </div>
                    <div className="w-full">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs sm:text-sm w-full"
                        onClick={handleExternal}
                      >
                        <ExternalLink className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                        <span className="hidden xs:inline">Open External</span>
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Product Image */}
                <Card>
                  <CardContent className="p-3 sm:p-4">
                    <div
                      className="relative h-32 sm:h-48 w-full bg-gray-100 rounded-lg overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() =>
                        openFullScreenImage(
                          sale.stove_image.url,
                          sale.stove_serial_no || "Atmosfair Product"
                        )
                      }
                    >
                      {sale.stove_image?.url ? (
                        <Image
                          src={sale.stove_image.url}
                          alt={sale.stove_serial_no || "Atmosfair Product"}
                          fill
                          className="object-cover"
                          sizes="(max-width: 500px) 100vw"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center">
                          <Package className="h-8 w-8 sm:h-16 sm:w-16 text-blue-400" />
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Quick Info */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Quick Information</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 gap-4">
                      <div className="flex items-center justify-between py-2 border-b border-gray-100">
                        <div className="flex items-center">
                          <Calendar className="h-4 w-4 mr-3 text-gray-400" />
                          <span className="text-sm text-gray-600">
                            Sale Date
                          </span>
                        </div>
                        <span className="text-sm font-medium">
                          {formatDate(sale.sales_date || sale.created_at)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-2 border-b border-gray-100">
                        <div className="flex items-center">
                          <Banknote className="h-4 w-4 mr-3 text-gray-400" />
                          <span className="text-sm text-gray-600">Amount</span>
                        </div>
                        <span className="text-lg font-bold text-green-600">
                          {formatCurrency(sale.amount || sale.price || 0)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-2 border-b border-gray-100">
                        <div className="flex items-center">
                          <User className="h-4 w-4 mr-3 text-gray-400" />
                          <span className="text-sm text-gray-600">
                            Customer
                          </span>
                        </div>
                        <span className="text-sm font-medium">
                          {sale.end_user_name || sale.contact_person || "N/A"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <div className="flex items-center">
                          <MapPin className="h-4 w-4 mr-3 text-gray-400" />
                          <span className="text-sm text-gray-600">
                            Location
                          </span>
                        </div>
                        <span className="text-sm font-medium">
                          {sale.state_backup || sale.addresses?.state || "N/A"}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === "customer" && (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center">
                      <User className="h-5 w-5 mr-2 text-blue-600" />
                      End-User Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium text-gray-500">
                          Full Name
                        </label>
                        <p className="text-sm text-gray-900 mt-1 font-medium">
                          {sale.end_user_name || sale.contact_person || "N/A"}
                        </p>
                      </div>

                      {(sale.aka || sale.alias) && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">
                            Also Known As
                          </label>
                          <p className="text-sm text-gray-900 mt-1">
                            {sale.aka || sale.alias}
                          </p>
                        </div>
                      )}

                      <div>
                        <label className="text-sm font-medium text-gray-500">
                          Phone Number
                        </label>
                        <div className="flex items-center justify-between mt-1">
                          <p className="text-sm text-gray-900 font-medium">
                            {sale.phone || sale.contact_phone || "N/A"}
                          </p>
                          {(sale.phone || sale.contact_phone) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                copyToClipboard(
                                  sale.phone || sale.contact_phone,
                                  "Phone"
                                )
                              }
                              className="text-blue-600 hover:text-blue-800"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {(sale.other_phone || sale.otherPhone) && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">
                            Other Number
                          </label>
                          <div className="flex items-center justify-between mt-1">
                            <p className="text-sm text-gray-900">
                              {sale.other_phone || sale.otherPhone}
                            </p>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                copyToClipboard(
                                  sale.other_phone || sale.otherPhone,
                                  "Other Phone"
                                )
                              }
                              className="text-blue-600 hover:text-blue-800"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      )}

                      {(sale.retailer_branch || sale.retailerBranch) && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">
                            Retailer / Branch / Agency / CSO
                          </label>
                          <p className="text-sm text-gray-900 mt-1">
                            {sale.retailer_branch || sale.retailerBranch}
                          </p>
                        </div>
                      )}

                      {sale.contact_person &&
                        sale.contact_person !== sale.end_user_name && (
                          <div>
                            <label className="text-sm font-medium text-gray-500">
                              Contact Person
                            </label>
                            <p className="text-sm text-gray-900 mt-1">
                              {sale.contact_person}
                            </p>
                          </div>
                        )}

                      {sale.contact_phone &&
                        sale.contact_phone !== sale.phone && (
                          <div>
                            <label className="text-sm font-medium text-gray-500">
                              Contact Phone
                            </label>
                            <div className="flex items-center justify-between mt-1">
                              <p className="text-sm text-gray-900">
                                {sale.contact_phone}
                              </p>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  copyToClipboard(
                                    sale.contact_phone,
                                    "Contact Phone"
                                  )
                                }
                                className="text-blue-600 hover:text-blue-800"
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        )}

                      <div>
                        <label className="text-sm font-medium text-gray-500">
                          Email
                        </label>
                        <div className="flex items-center justify-between mt-1">
                          <p className="text-sm text-gray-900">
                            {sale.email || sale.contact_email || "N/A"}
                          </p>
                          {(sale.email || sale.contact_email) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                copyToClipboard(
                                  sale.email || sale.contact_email,
                                  "Email"
                                )
                              }
                              className="text-blue-600 hover:text-blue-800"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === "transaction" && (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center">
                      <Banknote className="h-5 w-5 mr-2 text-green-600" />
                      Transaction Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium text-gray-500">
                          Transaction ID
                        </label>
                        <div className="flex items-center justify-between mt-1">
                          <p className="text-sm font-mono text-gray-900 font-medium">
                            {sale.transaction_id || sale.id || "N/A"}
                          </p>
                          {(sale.transaction_id || sale.id) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                copyToClipboard(
                                  sale.transaction_id || sale.id,
                                  "Transaction ID"
                                )
                              }
                              className="text-blue-600 hover:text-blue-800"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-500">
                          Amount
                        </label>
                        <p className="text-2xl font-bold text-green-600 mt-1">
                          {formatCurrency(sale.amount || sale.price || 0)}
                        </p>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-500">
                          Sale Date
                        </label>
                        <p className="text-sm text-gray-900 mt-1 font-medium">
                          {formatDate(sale.sales_date || sale.created_at)}
                        </p>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-500">
                          Created By
                        </label>
                        <p className="text-sm text-gray-900 mt-1">
                          {sale.creator?.full_name ||
                            sale.profiles?.full_name ||
                            sale.agent_name ||
                            "N/A"}
                        </p>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-500">
                          Payment Method
                        </label>
                        <p className="text-sm text-gray-900 mt-1">
                          {sale.payment_method || "Cash"}
                        </p>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-500">
                          Payment Status
                        </label>
                        <div className="mt-1">
                          <Badge
                            className={getStatusColor(
                              sale.payment_status || sale.status || "pending"
                            )}
                          >
                            {getStatusIcon(
                              sale.payment_status || sale.status || "pending"
                            )}
                            <span className="ml-1">
                              {sale.payment_status || sale.status || "Pending"}
                            </span>
                          </Badge>
                        </div>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-500">
                          Created At
                        </label>
                        <p className="text-sm text-gray-900 mt-1">
                          {formatDate(sale.created_at)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Stove Set Details */}
                {(sale.pot_quantity != null || sale.heat_retention_device != null || sale.previous_stove_type) && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center">
                        <Package className="h-5 w-5 mr-2 text-orange-600" />
                        Stove Set &amp; Cooking Habits
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {sale.pot_quantity != null && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">Pots Quantity</label>
                          <p className="text-sm text-gray-900 mt-1">{sale.pot_quantity} pot{sale.pot_quantity !== 1 ? "s" : ""}</p>
                        </div>
                      )}
                      {sale.heat_retention_device != null && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">Heat Retention Device (Wonderbox)</label>
                          <p className="text-sm text-gray-900 mt-1">{sale.heat_retention_device ? "Yes" : "No"}</p>
                        </div>
                      )}
                      {sale.previous_stove_type && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">Previous Stove Type</label>
                          <p className="text-sm text-gray-900 mt-1 capitalize">
                            {sale.previous_stove_type === "wood_stove"
                              ? "Wood Stove (3 stone or similar)"
                              : sale.previous_stove_type === "other"
                              ? `Other — ${sale.previous_stove_other || "not specified"}`
                              : "Charcoal Stove"}
                          </p>
                        </div>
                      )}
                      {sale.meals_per_day && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">Meals Per Day</label>
                          <p className="text-sm text-gray-900 mt-1">{sale.meals_per_day}</p>
                        </div>
                      )}
                      {sale.cooking_fuel_source && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">Cooking Fuel Source</label>
                          <p className="text-sm text-gray-900 mt-1">{sale.cooking_fuel_source}</p>
                        </div>
                      )}
                      {sale.cooking_location && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">Cooking Location</label>
                          <p className="text-sm text-gray-900 mt-1">{sale.cooking_location}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Terms & Conditions */}
                {sale.terms_accepted && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center">
                        <CheckCircle className="h-5 w-5 mr-2 text-green-600" />
                        Terms &amp; Conditions
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {[
                          { key: "poaGoverned", label: "PoA / UNFCCC governed — acknowledged" },
                          { key: "monitoring", label: "Agreed to cooperate for monitoring" },
                          { key: "noResell", label: "Agreed not to resell the stove" },
                          { key: "emissionReductions", label: "Ceded emission reductions to atmosfair gGmbH" },
                          { key: "noExport", label: "Agreed not to take stove outside Nigeria" },
                          { key: "demonstration", label: "Received sufficient demonstration on efficient use" },
                        ].map(({ key, label }) => (
                          <div key={key} className="flex items-center gap-2">
                            {sale.terms_accepted[key] ? (
                              <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
                            )}
                            <span className="text-sm text-gray-700">{label}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Transaction Actions */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Button
                      className="w-full"
                      onClick={handleDownloadReceipt}
                      disabled={loadingStates.downloadingReceipt}
                    >
                      {loadingStates.downloadingReceipt ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4 mr-2" />
                      )}
                      {loadingStates.downloadingReceipt
                        ? "Generating..."
                        : "Download Receipt"}
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={handleEmailReceipt}
                      disabled={loadingStates.emailingReceipt}
                    >
                      {loadingStates.emailingReceipt ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Mail className="h-4 w-4 mr-2" />
                      )}
                      {loadingStates.emailingReceipt
                        ? "Sending..."
                        : "Email Receipt"}
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={handleGenerateInvoice}
                      disabled={loadingStates.generatingInvoice}
                    >
                      {loadingStates.generatingInvoice ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <FileText className="h-4 w-4 mr-2" />
                      )}
                      {loadingStates.generatingInvoice
                        ? "Generating..."
                        : "Generate Invoice"}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === "product" && (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center">
                      <Package className="h-5 w-5 mr-2 text-purple-600" />
                      Stove Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium text-gray-500">
                          Stove Serial Number
                        </label>
                        <div className="flex items-center justify-between mt-1">
                          <p className="text-sm font-mono text-gray-900 font-medium">
                            {sale.stove_serial_no || "N/A"}
                          </p>
                          {sale.stove_serial_no && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                copyToClipboard(
                                  sale.stove_serial_no,
                                  "Serial Number"
                                )
                              }
                              className="text-blue-600 hover:text-blue-800"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-500">
                          Product Type
                        </label>
                        <p className="text-sm text-gray-900 mt-1 font-medium">
                          {sale.product_type ||
                            sale.stove_type ||
                            "Atmosfair Stove"}
                        </p>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-500">
                          Partner
                        </label>
                        <p className="text-sm text-gray-900 mt-1">
                          {sale.partner_name ||
                            sale.organizations?.partner_name ||
                            sale.partner ||
                            "N/A"}
                        </p>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-500">
                          Description
                        </label>
                        <p className="text-sm text-gray-900 mt-1">
                          {sale.description ||
                            sale.notes ||
                            "High-efficiency Atmosfair cooking stove designed for clean cooking and reduced emissions."}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Product Image */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Product Image</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 sm:p-4">
                    <div
                      className="relative h-48 w-full bg-gray-100 rounded-lg overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() =>
                        sale.stove_image?.url &&
                        openFullScreenImage(
                          sale.stove_image.url,
                          `Product Image - ${
                            sale.stove_serial_no || "Atmosfair Product"
                          }`
                        )
                      }
                    >
                      {sale.stove_image?.url ? (
                        <Image
                          src={sale.stove_image.url}
                          alt={sale.stove_serial_no || "Atmosfair Product"}
                          fill
                          className="object-cover"
                          sizes="(max-width: 500px) 100vw"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center">
                          <Package className="h-16 w-16 text-blue-400" />
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === "location" && (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center">
                      <MapPin className="h-5 w-5 mr-2 text-red-600" />
                      Location Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium text-gray-500">
                          Full Address
                        </label>
                        <p className="text-sm text-gray-900 font-medium">
                          {sale.addresses?.full_address ||
                            sale.addresses?.street ||
                            `${sale.lga_backup || sale.addresses?.city || ""} ${
                              sale.state_backup || sale.addresses?.state || ""
                            }`.trim() ||
                            `${sale.lga_backup || ""} ${
                              sale.state_backup || ""
                            }`.trim() ||
                            "N/A"}
                        </p>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-500">
                          City
                        </label>
                        <p className="text-sm text-gray-900 ">
                          {sale.lga_backup || sale.addresses?.city || "N/A"}
                        </p>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-500">
                          State
                        </label>
                        <p className="text-sm text-gray-900 ">
                          {sale.state_backup || sale.addresses?.state || "N/A"}
                        </p>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-500">
                          Country
                        </label>
                        <p className="text-sm text-gray-900 ">
                          {sale.addresses?.country || "Nigeria"}
                        </p>
                      </div>

                      {sale.addresses?.latitude &&
                        sale.addresses?.longitude && (
                          <div>
                            <label className="text-sm font-medium text-gray-500">
                              Coordinates
                            </label>
                            <p className="text-sm text-gray-900 ">
                              Latitude: {sale.addresses?.latitude}
                              <br /> Longitude: {sale.addresses?.longitude}
                            </p>
                          </div>
                        )}
                    </div>
                  </CardContent>
                </Card>

                {/* Map Preview */}
                {sale.addresses?.latitude && sale.addresses?.longitude && (
                  <Card>
                    <CardContent className="p-4">
                      <div className="w-full">
                        {/* Header matching Flutter style */}
                        <div className="w-full text-right mb-2.5">
                          <h4 className="text-xs font-medium text-gray-700 uppercase tracking-wide">
                            MAP PREVIEW
                          </h4>
                        </div>

                        {/* Map container matching Flutter dimensions and styling */}
                        <div className="relative h-48 w-full bg-gray-100 border border-gray-300 overflow-hidden">
                          {/* Static Map Image */}
                          <Image
                            src={`https://maps.googleapis.com/maps/api/staticmap?center=${sale.addresses?.latitude},${sale.addresses?.longitude}&zoom=16&size=600x200&markers=color:red%7C${sale.addresses?.latitude},${sale.addresses?.longitude}&maptype=roadmap&style=element:geometry%7Ccolor:0xf5f5f5&style=element:labels.icon%7Cvisibility:off&style=element:labels.text.fill%7Ccolor:0x616161&style=element:labels.text.stroke%7Ccolor:0xf5f5f5&style=feature:administrative.land_parcel%7Celement:labels.text.fill%7Ccolor:0xbdbdbd&style=feature:poi%7Celement:geometry%7Ccolor:0xeeeeee&style=feature:poi%7Celement:labels.text.fill%7Ccolor:0x757575&style=feature:poi.park%7Celement:geometry%7Ccolor:0xe5e5e5&style=feature:poi.park%7Celement:labels.text.fill%7Ccolor:0x9e9e9e&style=feature:road%7Celement:geometry%7Ccolor:0xffffff&style=feature:road.arterial%7Celement:labels.text.fill%7Ccolor:0x757575&style=feature:road.highway%7Celement:geometry%7Ccolor:0xdadada&style=feature:road.highway%7Celement:labels.text.fill%7Ccolor:0x616161&style=feature:road.local%7Celement:labels.text.fill%7Ccolor:0x9e9e9e&style=feature:transit.line%7Celement:geometry%7Ccolor:0xe5e5e5&style=feature:transit.station%7Celement:geometry%7Ccolor:0xeeeeee&style=feature:water%7Celement:geometry%7Ccolor:0xc9c9c9&style=feature:water%7Celement:labels.text.fill%7Ccolor:0x9e9e9e`}
                            alt={`Map showing location at ${sale.addresses?.latitude}, ${sale.addresses?.longitude}`}
                            fill
                            className="object-cover"
                            sizes="(max-width: 600px) 100vw, 600px"
                            onError={(e) => {
                              // Fallback to simple map without styling if Google Maps API fails
                              e.target.src = `https://maps.googleapis.com/maps/api/staticmap?center=${sale.addresses?.latitude},${sale.addresses?.longitude}&zoom=16&size=600x200&markers=color:red%7C${sale.addresses?.latitude},${sale.addresses?.longitude}&maptype=roadmap`;
                            }}
                          />

                          {/* Overlay with location info and action button */}
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3">
                            <div className="text-white">
                              <p className="text-sm font-medium">
                                Stove Location
                              </p>
                              <p className="text-xs opacity-90">
                                {sale.addresses?.full_address ||
                                  `${
                                    sale.lga_backup ||
                                    sale.addresses?.city ||
                                    ""
                                  } ${
                                    sale.state_backup ||
                                    sale.addresses?.state ||
                                    ""
                                  }`.trim() ||
                                  "Location address"}
                              </p>
                              <Button
                                size="sm"
                                className="mt-2 bg-white/20 hover:bg-white/30 text-white border-white/30"
                                onClick={() => {
                                  const url = `https://www.google.com/maps/search/?api=1&query=${sale.addresses?.latitude},${sale.addresses?.longitude}`;
                                  window.open(url, "_blank");
                                }}
                              >
                                <ExternalLink className="h-3 w-3 mr-1" />
                                Open in Maps
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {activeTab === "attachments" && (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center">
                      <FileText className="h-5 w-5 mr-2 text-orange-600" />
                      Attachments
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      {/* Stove Image */}
                      {sale.stove_image?.url ? (
                        <div>
                          <h4 className="text-sm font-medium text-gray-700 mb-2 uppercase tracking-wide">
                            Stove Image
                          </h4>
                          <div
                            className="relative h-48 w-full bg-gray-100 rounded-lg overflow-hidden border cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() =>
                              openFullScreenImage(
                                sale.stove_image.url,
                                "Stove Image"
                              )
                            }
                          >
                            <Image
                              src={sale.stove_image.url}
                              alt="Stove Image"
                              fill
                              className="object-cover"
                              sizes="(max-width: 500px) 100vw"
                            />
                          </div>
                        </div>
                      ) : null}

                      {/* Agreement Document */}
                      {sale.agreement_image?.url ? (
                        <div>
                          <h4 className="text-sm font-medium text-gray-700 mb-2 uppercase tracking-wide">
                            Agreement Document
                          </h4>
                          <div
                            className="relative h-48 w-full bg-gray-100 rounded-lg overflow-hidden border cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() =>
                              openFullScreenImage(
                                sale.agreement_image.url,
                                "Agreement Document"
                              )
                            }
                          >
                            <Image
                              src={sale.agreement_image.url}
                              alt="Agreement Document"
                              fill
                              className="object-contain"
                              sizes="(max-width: 500px) 100vw"
                            />
                          </div>
                        </div>
                      ) : null}

                      {/* Signature */}
                      {sale.signature ? (
                        <div>
                          <h4 className="text-sm font-medium text-gray-700 mb-2 uppercase tracking-wide">
                            Signature
                          </h4>
                          <div
                            className="relative h-32 w-full bg-gray-100 rounded-lg overflow-hidden border cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => {
                              const signatureSrc = sale.signature.startsWith(
                                "data:"
                              )
                                ? sale.signature
                                : `data:image/png;base64,${sale.signature}`;
                              openFullScreenImage(
                                signatureSrc,
                                "Customer Signature"
                              );
                            }}
                          >
                            {typeof sale.signature === "string" ? (
                              <Image
                                src={
                                  sale.signature.startsWith("data:")
                                    ? sale.signature
                                    : `data:image/png;base64,${sale.signature}`
                                }
                                alt="Customer Signature"
                                fill
                                className="object-contain"
                                sizes="(max-width: 500px) 100vw"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <p className="text-sm text-gray-500">
                                  Signature available
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}

                      {/* No attachments message */}
                      {!sale.stove_image?.url &&
                        !sale.agreement_image?.url &&
                        !sale.signature && (
                          <div className="text-center py-8">
                            <FileText className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                            <p className="text-sm text-gray-500">
                              No attachments available
                            </p>
                          </div>
                        )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Full Screen Image Modal */}
      {fullScreenImage && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="relative w-full h-full max-w-7xl max-h-full flex items-center justify-center">
            {/* Close Button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={closeFullScreenImage}
              className="absolute top-4 right-4 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full"
            >
              <X className="h-6 w-6" />
            </Button>

            {/* Image Title */}
            <div className="absolute top-4 left-4 z-10 bg-black/50 text-white px-4 py-2 rounded-lg">
              <h3 className="text-lg font-medium">{fullScreenImage.title}</h3>
            </div>

            {/* Image Container */}
            <div className="relative w-full h-full flex items-center justify-center">
              <Image
                src={fullScreenImage.src}
                alt={fullScreenImage.title}
                fill
                className="object-contain"
                sizes="100vw"
                priority
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SalesDetailSidebar;
