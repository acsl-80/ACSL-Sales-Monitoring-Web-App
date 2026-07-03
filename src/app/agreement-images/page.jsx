
import { useState, useEffect } from "react";
import DashboardLayout from "../components/DashboardLayout";
import ProtectedRoute from "../components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  FileImage,
  Loader2,
  Image as ImageIcon,
  Calendar,
  User,
  Building2,
  Package,
  Eye,
  Download,
  AlertCircle,
  X,
} from "lucide-react";
import agreementImagesService from "../services/agreementImagesService";

const AgreementImagesPage = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [currentImage, setCurrentImage] = useState(null);
  const [imageDetails, setImageDetails] = useState(null);
  const [showFullDetails, setShowFullDetails] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Handle search input change with debounced suggestions
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchTerm.length >= 2) {
        getSuggestions(searchTerm);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  const getSuggestions = async (term) => {
    try {
      const response = await agreementImagesService.searchSerialNumbers(term);
      if (response.success) {
        setSuggestions(response.data);
        setShowSuggestions(response.data.length > 0);
      }
    } catch (error) {
      console.error("Error getting suggestions:", error);
    }
  };

  const handleSearch = async (serialNumber = null) => {
    const searchSerial = serialNumber || searchTerm.trim();

    if (!searchSerial) {
      setError("Please enter a serial number to search");
      return;
    }

    setSearching(true);
    setError("");
    setCurrentImage(null);
    setImageDetails(null);
    setShowFullDetails(false);
    setShowSuggestions(false);

    try {
      // First get the image binary
      const imageResponse =
        await agreementImagesService.getAgreementImageBinary(searchSerial);

      if (!imageResponse.success) {
        setError(imageResponse.error);
        return;
      }

      setCurrentImage(imageResponse.data);

      // If we have an image, also get the details
      const detailsResponse =
        await agreementImagesService.getAgreementImageDetails(searchSerial);
      if (detailsResponse.success) {
        setImageDetails(detailsResponse.data);
      }
    } catch (error) {
      setError(error.message || "An unexpected error occurred");
    } finally {
      setSearching(false);
    }
  };

  const handleDownloadImage = () => {
    if (!currentImage) return;

    const link = document.createElement("a");
    link.href = currentImage.imageUrl;
    link.download = `agreement_${currentImage.serialNumber || "image"}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleViewFullDetails = () => {
    setShowFullDetails(true);
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case "completed":
        return "bg-green-100 text-green-800 border-green-200";
      case "pending":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "incomplete":
        return "bg-red-100 text-red-800 border-red-200";
      case "assigned":
        return "bg-blue-100 text-blue-800 border-blue-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  // Cleanup image URLs on unmount
  useEffect(() => {
    return () => {
      if (currentImage?.imageUrl) {
        agreementImagesService.cleanupImageUrl(currentImage.imageUrl);
      }
    };
  }, [currentImage]);

  return (
    <ProtectedRoute requireSuperAdmin={true}>
      <DashboardLayout
        currentRoute="agreement-images"
        title="Agreement Images"
        description="Search and view user agreement images by serial number"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Search Section */}
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileImage className="h-5 w-5 text-blue-600" />
                Search Agreement Images
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <div className="flex gap-4">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Enter stove serial number (e.g., 101052766)"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      onKeyPress={(e) => e.key === "Enter" && handleSearch()}
                      className="pl-10"
                      disabled={searching}
                    />

                    {/* Suggestions Dropdown */}
                    {/* {showSuggestions && suggestions.length > 0 && (
                      <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-md shadow-lg z-10 mt-1">
                        {suggestions.map((suggestion, index) => (
                          <button
                            key={index}
                            className="w-full text-left px-4 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                            onClick={() => {
                              setSearchTerm(suggestion);
                              //   setShowSuggestions(false);
                              handleSearch(suggestion);
                            }}
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    )} */}
                  </div>
                  <Button
                    onClick={() => handleSearch()}
                    disabled={searching || !searchTerm.trim()}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {searching ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Searching...
                      </>
                    ) : (
                      <>
                        <Search className="h-4 w-4 mr-2" />
                        Search
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Error Display */}
          {error && (
            <Card className="mb-8 border-l-4 border-l-red-500 bg-red-50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-red-800">
                  <AlertCircle className="h-5 w-5" />
                  <span className="font-medium">Error:</span>
                  <span>{error}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Results Section */}
          {currentImage && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Image Display */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ImageIcon className="h-5 w-5 text-green-600" />
                      Agreement Image
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDownloadImage}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Download
                      </Button>
                      {/* {imageDetails && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleViewFullDetails}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View Details
                        </Button>
                      )} */}
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="relative aspect-[4/3] bg-gray-100 rounded-lg overflow-hidden">
                    <img
                      src={currentImage.imageUrl}
                      alt={`Agreement for ${currentImage.serialNumber}`}
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        e.target.style.display = "none";
                        e.target.nextSibling.style.display = "flex";
                      }}
                    />
                    <div
                      className="absolute inset-0 flex items-center justify-center bg-gray-100"
                      style={{ display: "none" }}
                    >
                      <div className="text-center text-gray-500">
                        <ImageIcon className="h-12 w-12 mx-auto mb-2" />
                        <p>Image failed to load</p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 text-sm text-gray-600">
                    <p>
                      <strong>Serial Number:</strong>{" "}
                      {currentImage.serialNumber}
                    </p>
                    <p>
                      <strong>Content Type:</strong> {currentImage.contentType}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Quick Info */}
              {imageDetails && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Package className="h-5 w-5 text-blue-600" />
                      Sale Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between py-3 border-b border-gray-100">
                      <div className="flex items-center">
                        <Calendar className="h-4 w-4 mr-3 text-gray-400" />
                        <span className="text-sm font-medium text-gray-700">
                          Sale Date
                        </span>
                      </div>
                      <span className="text-sm text-gray-900">
                        {formatDate(imageDetails.sale.sales_date)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between py-3 border-b border-gray-100">
                      <div className="flex items-center">
                        <User className="h-4 w-4 mr-3 text-gray-400" />
                        <span className="text-sm font-medium text-gray-700">
                          End User
                        </span>
                      </div>
                      <span className="text-sm text-gray-900">
                        {imageDetails.sale.end_user_name || "N/A"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between py-3 border-b border-gray-100">
                      <div className="flex items-center">
                        <User className="h-4 w-4 mr-3 text-gray-400" />
                        <span className="text-sm font-medium text-gray-700">
                          Contact Person
                        </span>
                      </div>
                      <span className="text-sm text-gray-900">
                        {imageDetails.sale.contact_person || "N/A"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between py-3 border-b border-gray-100">
                      <div className="flex items-center">
                        <Building2 className="h-4 w-4 mr-3 text-gray-400" />
                        <span className="text-sm font-medium text-gray-700">
                          Partner
                        </span>
                      </div>
                      <span className="text-sm text-gray-900">
                        {imageDetails.sale.partner_name || "N/A"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between py-3">
                      <span className="text-sm font-medium text-gray-700">
                        Status
                      </span>
                      <Badge
                        className={getStatusColor(imageDetails.sale.status)}
                      >
                        {imageDetails.sale.status || "N/A"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Full Details Modal */}
          {showFullDetails && imageDetails && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50">
              <div className="fixed inset-4 bg-white rounded-lg shadow-xl overflow-auto">
                <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-gray-900">
                    Complete Sale Details
                  </h2>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowFullDetails(false)}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>

                <div className="p-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Sale Details */}
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">
                        Sale Information
                      </h3>
                      <div className="space-y-3">
                        <div>
                          <label className="text-sm font-medium text-gray-500">
                            Sale ID
                          </label>
                          <p className="text-sm text-gray-900">
                            {imageDetails.sale.id}
                          </p>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-500">
                            Serial Number
                          </label>
                          <p className="text-sm text-gray-900">
                            {imageDetails.sale.stove_serial_no}
                          </p>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-500">
                            Sale Date
                          </label>
                          <p className="text-sm text-gray-900">
                            {formatDate(imageDetails.sale.sales_date)}
                          </p>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-500">
                            Contact Person
                          </label>
                          <p className="text-sm text-gray-900">
                            {imageDetails.sale.contact_person || "N/A"}
                          </p>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-500">
                            End User Name
                          </label>
                          <p className="text-sm text-gray-900">
                            {imageDetails.sale.end_user_name || "N/A"}
                          </p>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-500">
                            Partner Name
                          </label>
                          <p className="text-sm text-gray-900">
                            {imageDetails.sale.partner_name || "N/A"}
                          </p>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-500">
                            Status
                          </label>
                          <Badge
                            className={getStatusColor(imageDetails.sale.status)}
                          >
                            {imageDetails.sale.status || "N/A"}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    {/* Image Details */}
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">
                        Image Information
                      </h3>
                      <div className="space-y-3">
                        <div>
                          <label className="text-sm font-medium text-gray-500">
                            Image ID
                          </label>
                          <p className="text-sm text-gray-900">
                            {imageDetails.image.id}
                          </p>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-500">
                            Public ID
                          </label>
                          <p className="text-sm text-gray-900">
                            {imageDetails.image.public_id}
                          </p>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-500">
                            Content Type
                          </label>
                          <p className="text-sm text-gray-900">
                            {imageDetails.image.type}
                          </p>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-500">
                            Upload Date
                          </label>
                          <p className="text-sm text-gray-900">
                            {formatDate(imageDetails.image.created_at)}
                          </p>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-500">
                            Original URL
                          </label>
                          <p className="text-sm text-gray-900 break-all">
                            {imageDetails.image.url}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!currentImage && !error && !searching && (
            <Card className="text-center py-12">
              <CardContent>
                <FileImage className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  No Image Loaded
                </h3>
                <p className="text-gray-600 mb-4">
                  Enter a stove serial number above to search for its agreement
                  image
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
};

export default AgreementImagesPage;
