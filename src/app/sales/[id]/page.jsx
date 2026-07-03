
import { useState, useEffect } from "react";
import { useParams, useRouter } from "@/compat/navigation";
import Image from "@/compat/Image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowLeft,
  Calendar,
  Banknote,
  MapPin,
  User,
  Phone,
  Mail,
  Package,
  FileText,
  Download,
  Copy,
  ExternalLink,
  CheckCircle,
  Clock,
  AlertCircle,
  Loader2,
  X,
} from "lucide-react";

export default function SaleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [sale, setSale] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [fullScreenImage, setFullScreenImage] = useState(null);

  useEffect(() => {
    // In a real app, you'd fetch the sale data from your API
    // For now, we'll simulate it or try to get it from localStorage/context
    const fetchSaleData = async () => {
      try {
        setLoading(true);

        // Simulate API call delay
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Try to get from localStorage (if it was stored there)
        const storedSale = localStorage.getItem(`sale_${params.id}`);
        if (storedSale) {
          setSale(JSON.parse(storedSale));
        } else {
          // Mock data for demonstration
          setSale({
            id: params.id,
            transaction_id: params.id,
            stove_serial_no: "101023411",
            sales_date: "2025-07-16",
            contact_person: "Elebu john wa",
            contact_phone: "09065654332",
            end_user_name: "Ekpoma John",
            aka: "EKE",
            state_backup: "Bayelsa",
            lga_backup: "Ekeremor",
            phone: "09078901221",
            other_phone: "09067656533",
            partner_name: "Updated Partner",
            amount: 32000,
            status: "completed",
            created_at: "2025-07-18T16:21:12.61742",
            address: {
              city: "Bayelsa",
              state: "Bayelsa",
              country: "Nigeria",
              latitude: 4.7719071,
              longitude: 6.0698526,
              full_address: "Bayelsa, Nigeria",
            },
            stove_image: {
              url: "https://oeiwnpngbnkhcismhpgs.supabase.co/storage/v1/object/public/images/stoveImage/0db81e35-8c35-4d32-b1fa-acbc13d3260a.jpg",
            },
            agreement_image: {
              url: "https://oeiwnpngbnkhcismhpgs.supabase.co/storage/v1/object/public/images/agreementImage/d28c426c-e84d-40af-9f6d-2fb0557774cc.jpg",
            },
          });
        }
      } catch (err) {
        setError("Failed to load sale details");
        console.error("Error loading sale:", err);
      } finally {
        setLoading(false);
      }
    };

    if (params.id) {
      fetchSaleData();
    }
  }, [params.id]);

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

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    console.log(`${label} copied to clipboard: ${text}`);
  };

  const openFullScreenImage = (imageSrc, title) => {
    setFullScreenImage({ src: imageSrc, title });
  };

  const closeFullScreenImage = () => {
    setFullScreenImage(null);
  };

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "customer", label: "Customer" },
    { id: "transaction", label: "Transaction" },
    { id: "product", label: "Product" },
    { id: "location", label: "Location" },
    { id: "attachments", label: "Attachments" },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
          <h2 className="text-lg font-medium text-gray-900 mb-2">
            Loading Sale Details
          </h2>
          <p className="text-gray-600">
            Please wait while we fetch the information...
          </p>
        </div>
      </div>
    );
  }

  if (error || !sale) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="h-8 w-8 text-red-600" />
          </div>
          <h2 className="text-lg font-medium text-gray-900 mb-2">
            Sale Not Found
          </h2>
          <p className="text-gray-600 mb-4">
            {error || `No sale found with ID: ${params.id}`}
          </p>
          <Button onClick={() => router.back()} variant="outline">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.back()}
                className="mr-4"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <div>
                <h1 className="text-xl font-bold text-gray-900">
                  Sale Details
                </h1>
                <p className="text-sm text-gray-600">
                  {sale.stove_serial_no || "Atmosfair Product"}
                </p>
              </div>
            </div>
            <Badge className={getStatusColor(sale.status || "active")}>
              {getStatusIcon(sale.status || "active")}
              <span className="ml-1">{sale.status || "Active"}</span>
            </Badge>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tabs */}
        <div className="bg-white rounded-lg shadow mb-8">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6" aria-label="Tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === tab.id
                      ? "border-blue-500 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {activeTab === "overview" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left Column */}
                <div className="space-y-6">
                  {/* Quick Info */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Quick Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between py-3 border-b border-gray-100">
                        <div className="flex items-center">
                          <Calendar className="h-5 w-5 mr-3 text-gray-400" />
                          <span className="text-sm font-medium text-gray-700">
                            Sale Date
                          </span>
                        </div>
                        <span className="text-sm text-gray-900">
                          {formatDate(sale.sales_date || sale.created_at)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-3 border-b border-gray-100">
                        <div className="flex items-center">
                          <Banknote className="h-5 w-5 mr-3 text-gray-400" />
                          <span className="text-sm font-medium text-gray-700">
                            Amount
                          </span>
                        </div>
                        <span className="text-lg font-bold text-green-600">
                          {formatCurrency(sale.amount || sale.price || 0)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-3 border-b border-gray-100">
                        <div className="flex items-center">
                          <User className="h-5 w-5 mr-3 text-gray-400" />
                          <span className="text-sm font-medium text-gray-700">
                            Customer
                          </span>
                        </div>
                        <span className="text-sm text-gray-900">
                          {sale.end_user_name || sale.contact_person || "N/A"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-3">
                        <div className="flex items-center">
                          <MapPin className="h-5 w-5 mr-3 text-gray-400" />
                          <span className="text-sm font-medium text-gray-700">
                            Location
                          </span>
                        </div>
                        <span className="text-sm text-gray-900">
                          {sale.address?.state || sale.state_backup || "N/A"}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Right Column */}
                <div className="space-y-6">
                  {/* Product Image */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Product Image</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div
                        className="relative h-64 w-full bg-gray-100 rounded-lg overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() =>
                          sale.stove_image?.url &&
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
                            sizes="(max-width: 768px) 100vw, 50vw"
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
              </div>
            )}

            {/* Other tabs would go here with similar content structure */}
            {activeTab !== "overview" && (
              <div className="text-center py-12">
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  {tabs.find((tab) => tab.id === activeTab)?.label} Details
                </h3>
                <p className="text-gray-600">
                  This section contains detailed {activeTab} information.
                </p>
                <p className="text-sm text-gray-500 mt-2">
                  Full implementation would show the same content as in the
                  sidebar component.
                </p>
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
    </div>
  );
}
