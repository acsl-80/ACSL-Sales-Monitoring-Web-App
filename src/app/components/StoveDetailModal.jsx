
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Building2,
  MapPin,
  Calendar,
  User,
  Phone,
  Package,
  Receipt,
  Loader2,
  Eye,
} from "lucide-react";
import { useAuth } from "../contexts/useAuth";

const StoveDetailModal = ({ open, onClose, stove }) => {
  const { supabase } = useAuth();
  const [saleDetails, setSaleDetails] = useState(null);
  const [loadingSale, setLoadingSale] = useState(false);
  const [showFullSale, setShowFullSale] = useState(false);

  if (!stove) return null;

  // Fetch full sale details when modal opens and stove is sold
  useEffect(() => {
    if (open && stove.status === "sold" && stove.sale_id && !saleDetails) {
      fetchSaleDetails();
    }
  }, [open, stove]);

  const fetchSaleDetails = async () => {
    setLoadingSale(true);
    try {
      const baseUrl = import.meta.env.VITE_SUPABASE_URL;
      const functionUrl = `${baseUrl}/functions/v1/get-sale?id=${stove.sale_id}`;

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("No authentication token found");
      }

      const response = await fetch(functionUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Failed to fetch sale details");
      }

      setSaleDetails(result.data || null);
    } catch (err) {
      console.error("Error fetching sale details:", err);
    } finally {
      setLoadingSale(false);
    }
  };

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
    } catch (error) {
      return "Invalid Date";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6 text-brand" />
            Stove ID Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Stove ID and Status */}
          <div className="bg-gradient-to-r from-brand/10 to-brand/5 p-4 rounded-lg border border-brand/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Stove ID</p>
                <p className="text-2xl font-bold text-gray-900">
                  {stove.stove_id}
                </p>
              </div>
              <Badge
                className={
                  stove.status === "sold"
                    ? "bg-blue-100 text-blue-800 border-blue-200"
                    : "bg-green-100 text-green-800 border-green-200"
                }
              >
                {stove.status.charAt(0).toUpperCase() + stove.status.slice(1)}
              </Badge>
            </div>
          </div>

          {/* Organization Information */}
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-brand" />
              Organization Information
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-xs text-gray-600 mb-1">Partner Name</p>
                <p className="font-medium text-gray-900">
                  {stove.organization_name}
                </p>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-xs text-gray-600 mb-1">Branch</p>
                <p className="font-medium text-gray-900">{stove.branch}</p>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-xs text-gray-600 mb-1 flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  State
                </p>
                <p className="font-medium text-gray-900">{stove.location}</p>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-xs text-gray-600 mb-1 flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  Address
                </p>
                <p className="font-medium text-gray-900">
                  {stove.address || "N/A"}
                </p>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-xs text-gray-600 mb-1 flex items-center gap-1">
                  <User className="h-3 w-3" />
                  Contact Name
                </p>
                <p className="font-medium text-gray-900">
                  {stove.contact_name}
                </p>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-xs text-gray-600 mb-1 flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  Contact Phone
                </p>
                <p className="font-medium text-gray-900">
                  {stove.contact_phone}
                </p>
              </div>
            </div>
          </div>

          {/* Sale Information (if sold) */}
          {stove.status === "sold" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <Receipt className="h-5 w-5 text-brand" />
                  Sale Information
                </h3>
                {stove.sale_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowFullSale(!showFullSale)}
                    disabled={loadingSale}
                  >
                    {loadingSale ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <Eye className="h-4 w-4 mr-2" />
                        {showFullSale ? "Hide" : "View"} Full Details
                      </>
                    )}
                  </Button>
                )}
              </div>

              {!showFullSale ? (
                // Summary view
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                    <p className="text-xs text-blue-600 mb-1">Customer Name</p>
                    <p className="font-medium text-gray-900">
                      {stove.sold_to || "N/A"}
                    </p>
                  </div>

                  <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                    <p className="text-xs text-blue-600 mb-1">Sale Date</p>
                    <p className="font-medium text-gray-900">
                      {formatDate(stove.sale_date)}
                    </p>
                  </div>
                </div>
              ) : (
                // Full sale details view
                <div className="bg-blue-50 p-4 rounded-lg border-2 border-blue-200 space-y-4">
                  {loadingSale ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                    </div>
                  ) : saleDetails ? (
                    <>
                      {/* Customer Information */}
                      <div>
                        <h4 className="font-semibold text-blue-900 mb-3">
                          Customer Information
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="bg-white p-3 rounded">
                            <p className="text-xs text-blue-600 mb-1">
                              Customer Name
                            </p>
                            <p className="font-medium text-gray-900">
                              {saleDetails.end_user_name || "N/A"}
                            </p>
                          </div>
                          <div className="bg-white p-3 rounded">
                            <p className="text-xs text-blue-600 mb-1">
                              Phone Number
                            </p>
                            <p className="font-medium text-gray-900">
                              {saleDetails.end_user_phone_number || "N/A"}
                            </p>
                          </div>
                          <div className="bg-white p-3 rounded md:col-span-2">
                            <p className="text-xs text-blue-600 mb-1">
                              Address
                            </p>
                            <p className="font-medium text-gray-900">
                              {saleDetails.end_user_address || "N/A"}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Sale Details */}
                      <div>
                        <h4 className="font-semibold text-blue-900 mb-3">
                          Sale Details
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="bg-white p-3 rounded">
                            <p className="text-xs text-blue-600 mb-1">
                              Sale Date
                            </p>
                            <p className="font-medium text-gray-900">
                              {formatDate(
                                saleDetails.sales_date || saleDetails.created_at
                              )}
                            </p>
                          </div>
                          <div className="bg-white p-3 rounded">
                            <p className="text-xs text-blue-600 mb-1">
                              Payment Method
                            </p>
                            <p className="font-medium text-gray-900">
                              {saleDetails.payment_method || "N/A"}
                            </p>
                          </div>
                          <div className="bg-white p-3 rounded">
                            <p className="text-xs text-blue-600 mb-1">
                              Amount Paid
                            </p>
                            <p className="font-medium text-gray-900">
                              {saleDetails.amount_paid
                                ? `₦${parseFloat(
                                    saleDetails.amount_paid
                                  ).toLocaleString()}`
                                : "N/A"}
                            </p>
                          </div>
                          <div className="bg-white p-3 rounded">
                            <p className="text-xs text-blue-600 mb-1">
                              Receipt Number
                            </p>
                            <p className="font-medium text-gray-900">
                              {saleDetails.receipt_serial_number || "N/A"}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Agent Information */}
                      {saleDetails.agent_name && (
                        <div>
                          <h4 className="font-semibold text-blue-900 mb-3">
                            Agent Information
                          </h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="bg-white p-3 rounded">
                              <p className="text-xs text-blue-600 mb-1">
                                Agent Name
                              </p>
                              <p className="font-medium text-gray-900">
                                {saleDetails.agent_name}
                              </p>
                            </div>
                            <div className="bg-white p-3 rounded">
                              <p className="text-xs text-blue-600 mb-1">
                                Agent Phone
                              </p>
                              <p className="font-medium text-gray-900">
                                {saleDetails.agent_phone || "N/A"}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Additional Information */}
                      {saleDetails.notes && (
                        <div>
                          <h4 className="font-semibold text-blue-900 mb-3">
                            Additional Notes
                          </h4>
                          <div className="bg-white p-3 rounded">
                            <p className="text-sm text-gray-700">
                              {saleDetails.notes}
                            </p>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-gray-600">
                        Sale details not available
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Metadata */}
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900">Metadata</h3>

            <div className="grid grid-cols-1 gap-4">
              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-xs text-gray-600 mb-1">Created At</p>
                <p className="font-medium text-gray-900">
                  {formatDate(stove.created_at)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default StoveDetailModal;
