
import { useState, useEffect, useMemo, useCallback } from "react";
import DashboardLayout from "../components/DashboardLayout";
import ProtectedRoute from "../components/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  MapPin,
  Search,
  Filter,
  Download,
  Maximize2,
  Minimize2,
  Users,
  TrendingUp,
  Activity,
  RefreshCw,
  BarChart3,
  Globe,
  Eye,
  EyeOff,
  Calendar,
  Banknote,
  Target,
  Map as MapIcon,
  Layers,
  Settings,
  Info,
  AlertCircle,
  Loader2,
} from "lucide-react";
import MapPage from "./MapPage";
import PageHeader from "../components/PageHeader";
import salesAdvancedService from "../services/salesAdvancedAPIService";

export default function HeatmapPage() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mapData, setMapData] = useState([]);
  const [originalData, setOriginalData] = useState([]);
  const [selectedState, setSelectedState] = useState("all");
  const [selectedTimeRange, setSelectedTimeRange] = useState("all");
  const [selectedCustomerType, setSelectedCustomerType] = useState("all");
  const [showSidebar, setShowSidebar] = useState(true);
  const [mapType, setMapType] = useState("heatmap");
  const [heatmapIntensity, setHeatmapIntensity] = useState("medium");
  const [error, setError] = useState(null);
  const [apiStats, setApiStats] = useState({
    totalSales: 0,
    totalAmount: 0,
    uniqueStates: 0,
    avgAmount: 0,
  });

  // Fetch real sales data from API
  const fetchSalesData = useCallback(async (filters = {}) => {
    try {
      setLoading(true);
      setError(null);

      console.log("Fetching sales data with filters:", filters);

      // Prepare API filters
      const apiFilters = {
        limit: 5000, // Get more data for comprehensive map
        includeAddress: true,
        includeCreator: true,
        includeImages: false, // Don't need images for heatmap
        // Request the raw DB format (format2). The API defaults to "format1"
        // (a flat shape) which drops the nested `addresses` object and the
        // coordinate/amount fields this page maps over, causing every record
        // to be filtered out as "no valid coordinates".
        responseFormat: "format2",
        sortBy: "created_at",
        sortOrder: "desc",
        ...filters,
      };

      const response = await salesAdvancedService.getSalesData(apiFilters);

      if (response.success && response.data) {
        console.log("API Response:", response);

        // Process the real sales data for map visualization
        const processedData = response.data
          .filter((sale) => {
            // Only include sales with valid coordinates
            const hasCoords =
              (sale.addresses?.latitude && sale.addresses?.longitude) ||
              (sale.address?.latitude && sale.address?.longitude);
            const validCoords =
              hasCoords &&
              !isNaN(
                parseFloat(sale.addresses?.latitude || sale.address?.latitude)
              ) &&
              !isNaN(
                parseFloat(sale.addresses?.longitude || sale.address?.longitude)
              );

            if (!validCoords && hasCoords) {
              console.warn(
                "Invalid coordinates for sale:",
                sale.id,
                sale.addresses || sale.address
              );
            }

            return validCoords;
          })
          .map((sale) => ({
            id: sale.id || sale.transaction_id,
            lat: parseFloat(sale.addresses?.latitude || sale.address?.latitude),
            lng: parseFloat(
              sale.addresses?.longitude || sale.address?.longitude
            ),
            state:
              sale.state_backup ||
              sale.addresses?.state ||
              sale.address?.state ||
              "Unknown",
            city:
              sale.lga_backup ||
              sale.addresses?.city ||
              sale.address?.city ||
              "Unknown",
            sales: 1, // Each sale counts as 1
            amount: parseFloat(sale.amount || sale.price || 0),
            date: sale.sales_date || sale.created_at,
            customerName:
              sale.end_user_name || sale.contact_person || "Unknown",
            customerType: sale.customer_type || "Standard",
            region: sale.region || "Unknown",
            productCategory:
              sale.product_type || sale.stove_type || "Clean Cookstoves",
            salesRep:
              sale.creator?.full_name ||
              sale.profiles?.full_name ||
              sale.agent_name ||
              "Unknown",
            serialNumber: sale.stove_serial_no,
            phone: sale.phone || sale.contact_phone,
            email: sale.email || sale.contact_email,
            partner:
              sale.partner_name ||
              sale.organizations?.partner_name ||
              sale.partner,
            fullAddress:
              sale.addresses?.full_address ||
              sale.address?.full_address ||
              `${
                sale.lga_backup ||
                sale.addresses?.city ||
                sale.address?.city ||
                ""
              } ${
                sale.state_backup ||
                sale.addresses?.state ||
                sale.address?.state ||
                ""
              }`.trim(),
          }));

        console.log(
          `Processed ${processedData.length} sales records with valid coordinates out of ${response.data.length} total records`
        );

        // Calculate statistics
        const stats = {
          totalSales: processedData.length,
          totalAmount: processedData.reduce(
            (sum, item) => sum + item.amount,
            0
          ),
          uniqueStates: [...new Set(processedData.map((item) => item.state))]
            .length,
          avgAmount: 0,
        };
        stats.avgAmount =
          stats.totalSales > 0 ? stats.totalAmount / stats.totalSales : 0;

        setOriginalData(processedData);
        setMapData(processedData);
        setApiStats(stats);

        if (processedData.length === 0) {
          setError(
            "No sales records with valid coordinates found. Please check if location data is being properly captured."
          );
        }
      } else {
        throw new Error(response.message || "Failed to fetch sales data");
      }
    } catch (error) {
      console.error("Error fetching sales data:", error);
      setError(`Failed to load sales data: ${error.message}`);
      setMapData([]);
      setOriginalData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load data on component mount
  useEffect(() => {
    fetchSalesData();
  }, [fetchSalesData]);

  // Handle data refresh
  const handleRefresh = () => {
    fetchSalesData();
  };

  // Enhanced filtering logic based on real data
  const filteredData = useMemo(() => {
    return mapData.filter((item) => {
      const matchesSearch =
        item.state.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.productCategory.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.city.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesState =
        selectedState === "all" || item.state === selectedState;
      const matchesCustomerType =
        selectedCustomerType === "all" ||
        item.customerType === selectedCustomerType;

      let matchesTimeRange = true;
      if (selectedTimeRange !== "all") {
        const itemDate = new Date(item.date);
        const now = new Date();
        const daysAgo = Math.floor((now - itemDate) / (1000 * 60 * 60 * 24));

        switch (selectedTimeRange) {
          case "7d":
            matchesTimeRange = daysAgo <= 7;
            break;
          case "30d":
            matchesTimeRange = daysAgo <= 30;
            break;
          case "90d":
            matchesTimeRange = daysAgo <= 90;
            break;
          default:
            matchesTimeRange = true;
        }
      }

      return (
        matchesSearch && matchesState && matchesCustomerType && matchesTimeRange
      );
    });
  }, [
    mapData,
    searchTerm,
    selectedState,
    selectedCustomerType,
    selectedTimeRange,
  ]);
  // Enhanced statistics based on real data
  const stats = useMemo(() => {
    const data = filteredData;
    const states = [...new Set(data.map((item) => item.state))];
    const regions = [...new Set(data.map((item) => item.region))];

    return {
      totalLocations: data.length,
      totalSales: data.reduce((sum, item) => sum + item.sales, 0),
      totalAmount: data.reduce((sum, item) => sum + item.amount, 0),
      states: states.length,
      regions: regions.length,
      avgSaleValue:
        data.length > 0
          ? data.reduce((sum, item) => sum + item.amount, 0) / data.length
          : 0,
      topState:
        states.length > 0
          ? states.reduce((a, b) =>
              data.filter((item) => item.state === a).length >
              data.filter((item) => item.state === b).length
                ? a
                : b
            )
          : "N/A",
    };
  }, [filteredData]);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const exportData = () => {
    const csvContent = [
      [
        "ID",
        "State",
        "City",
        "Latitude",
        "Longitude",
        "Sales",
        "Amount",
        "Customer Name",
        "Customer Type",
        "Product Category",
        "Date",
        "Sales Rep",
      ].join(","),
      ...filteredData.map((item) =>
        [
          item.id,
          item.state,
          item.city,
          item.lat,
          item.lng,
          item.sales,
          item.amount,
          item.customerName,
          item.customerType,
          item.productCategory,
          item.date,
          item.salesRep,
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-heatmap-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const uniqueStates = [...new Set(mapData.map((item) => item.state))].sort();
  const uniqueCustomerTypes = [
    ...new Set(mapData.map((item) => item.customerType)),
  ].sort();

  return (
    <ProtectedRoute requireSuperAdmin={true}>
      <DashboardLayout currentRoute="map" title="Sales Heatmap Analytics">
        <div className="p-6 space-y-6">
          <PageHeader
            icon={MapIcon}
            title="Sales Heatmap Analytics"
            description="Geographic visualization of sales distribution across Nigeria"
            right={
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  variant="outline"
                  onClick={exportData}
                  disabled={loading}
                  className="bg-brand-50 border-brand-200 text-brand-700 hover:bg-brand-100"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
                <Button
                  variant="outline"
                  onClick={handleRefresh}
                  disabled={loading}
                  className="bg-brand-50 border-brand-200 text-brand-700 hover:bg-brand-100"
                >
                  <RefreshCw
                    className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
                  />
                  Refresh
                </Button>
              </div>
            }
          />
        </div>
        <div className="p-3 lg:p-6 pt-0 space-y-4 lg:space-y-6 bg-gray-50">
          {/* Filters Bar */}
          <Card>
            <CardContent className="p-3 lg:p-4">
              <div className="flex flex-col lg:flex-row lg:items-end gap-3">
                <div className="flex-1 min-w-0">
                  <Label className="text-xs font-medium text-gray-700">
                    Search
                  </Label>
                  <div className="relative mt-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Search locations, IDs, products..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 text-sm"
                    />
                  </div>
                </div>

                <div className="w-full lg:w-44">
                  <Label className="text-xs font-medium text-gray-700">
                    State
                  </Label>
                  <Select value={selectedState} onValueChange={setSelectedState}>
                    <SelectTrigger className="mt-1 w-full text-gray-600 h-9">
                      <SelectValue placeholder="All States" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All States</SelectItem>
                      {uniqueStates.map((state) => (
                        <SelectItem key={state} value={state}>
                          {state}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="w-full lg:w-40">
                  <Label className="text-xs font-medium text-gray-700">
                    Time Range
                  </Label>
                  <Select
                    value={selectedTimeRange}
                    onValueChange={setSelectedTimeRange}
                  >
                    <SelectTrigger className="mt-1 w-full text-gray-600 h-9">
                      <SelectValue placeholder="All Time" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Time</SelectItem>
                      <SelectItem value="7d">Last 7 Days</SelectItem>
                      <SelectItem value="30d">Last 30 Days</SelectItem>
                      <SelectItem value="90d">Last 90 Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="w-full lg:w-44">
                  <Label className="text-xs font-medium text-gray-700">
                    Customer Type
                  </Label>
                  <Select
                    value={selectedCustomerType}
                    onValueChange={setSelectedCustomerType}
                  >
                    <SelectTrigger className="mt-1 w-full text-gray-600 h-9">
                      <SelectValue placeholder="All Types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      {uniqueCustomerTypes.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="w-full lg:w-44">
                  <Label className="text-xs font-medium text-gray-700">
                    Map Visualization
                  </Label>
                  <Select value={mapType} onValueChange={setMapType}>
                    <SelectTrigger className="mt-1 w-full text-gray-600 h-9">
                      <SelectValue placeholder="Heatmap" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="heatmap">Heatmap</SelectItem>
                      <SelectItem value="markers">Individual Markers</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Statistics Cards */}
          <div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 lg:gap-4">
              {[
                {
                  gradient: "from-[#194977] to-[#2563EB]",
                  Icon: MapPin,
                  value: stats.totalLocations.toLocaleString(),
                  label: "Total Locations",
                },
                {
                  gradient: "from-[#047857] to-[#10B981]",
                  Icon: TrendingUp,
                  value: stats.totalSales.toLocaleString(),
                  label: "Total Sales",
                },
                {
                  gradient: "from-[#7C3AED] to-[#A78BFA]",
                  Icon: Banknote,
                  value: formatCurrency(stats.totalAmount),
                  label: "Total Revenue",
                },
                {
                  gradient: "from-[#B45309] to-[#F59E0B]",
                  Icon: Globe,
                  value: stats.states.toLocaleString(),
                  label: "States Covered",
                },
                {
                  gradient: "from-[#BE123C] to-[#F43F5E]",
                  Icon: Target,
                  value: formatCurrency(stats.avgSaleValue),
                  label: "Avg Sale Value",
                },
                {
                  gradient: "from-[#4338CA] to-[#818CF8]",
                  Icon: Activity,
                  value: stats.topState,
                  label: "Top State",
                },
              ].map(({ gradient, Icon, value, label }) => (
                <div
                  key={label}
                  className={`relative overflow-hidden rounded-lg border-transparent px-4 py-4 shadow-md transition-all bg-gradient-to-br ${gradient}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1 pr-3">
                      <p className="text-lg lg:text-2xl font-bold text-white tracking-tight leading-tight truncate">
                        {value}
                      </p>
                      <p className="text-xs lg:text-sm font-semibold text-white/90 mt-1">
                        {label}
                      </p>
                    </div>
                    <div className="rounded-lg p-2 bg-white/20 text-white shadow-sm w-fit shrink-0">
                      <Icon className="h-4 w-4" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="p-3 lg:p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-start">
                <AlertCircle className="h-5 w-5 text-red-600 mr-2 flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium text-red-800">
                    Error Loading Data
                  </h3>
                  <p className="text-sm text-red-700 mt-1 break-words">
                    {error}
                  </p>
                </div>
                <Button
                  onClick={handleRefresh}
                  variant="outline"
                  size="sm"
                  className="ml-auto border-red-300 text-red-700 hover:bg-red-100"
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Retry
                </Button>
              </div>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="p-4 lg:p-6 bg-brand-50 border border-brand-200 rounded-lg">
              <div className="flex items-center justify-center">
                <Loader2 className="h-6 w-6 text-brand-700 mr-3 animate-spin flex-shrink-0" />
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-brand-900">
                    Loading Sales Data
                  </h3>
                  <p className="text-sm text-brand-700 mt-1">
                    Fetching real-time sales data from the server...
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Data Summary */}
          {!loading && !error && mapData.length > 0 && (
            <div className="p-3 lg:p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-start">
                <Activity className="h-5 w-5 text-green-600 mr-2 flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium text-green-800">
                    Real Sales Data Loaded
                  </h3>
                  <p className="text-xs lg:text-sm text-green-700 mt-1 break-words">
                    Showing {apiStats.totalSales} sales from{" "}
                    {apiStats.uniqueStates} states • Total Value:{" "}
                    {formatCurrency(apiStats.totalAmount)}• Average:{" "}
                    {formatCurrency(apiStats.avgAmount)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Map Container */}
          <div
            className={`relative overflow-hidden border border-gray-200 bg-white ${
              isFullscreen
                ? "fixed inset-0 z-50 rounded-none"
                : "rounded-lg h-[520px] lg:h-[70vh]"
            }`}
          >
            {loading && (
              <div className="absolute inset-0 bg-white/90 flex items-center justify-center z-20">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-brand-700 mx-auto"></div>
                  <p className="mt-4 text-gray-600 font-medium">
                    Loading heatmap data...
                  </p>
                  <p className="text-sm text-gray-500">
                    Analyzing {mapData.length || "..."} sales locations
                  </p>
                </div>
              </div>
            )}

            <MapPage
              apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
              locations={filteredData}
              isFullscreen={isFullscreen}
              mapType={mapType}
              intensity={heatmapIntensity}
            />

            {/* Fullscreen Toggle Button */}
            <div className="absolute top-2 lg:top-4 right-2 lg:right-4 z-20">
              <Button
                onClick={() => setIsFullscreen(!isFullscreen)}
                variant="outline"
                size="sm"
                className="bg-white shadow-lg text-gray-500 text-xs lg:text-sm"
              >
                {isFullscreen ? (
                  <>
                    <Minimize2 className="h-3 w-3 lg:h-4 lg:w-4 mr-1 lg:mr-2" />
                    <span className="hidden sm:inline">Exit Fullscreen</span>
                    <span className="sm:hidden">Exit</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="h-3 w-3 lg:h-4 lg:w-4 mr-1 lg:mr-2" />
                    <span className="hidden sm:inline">Fullscreen</span>
                  </>
                )}
              </Button>
            </div>

            {/* Map Info Overlay */}
            <div className="absolute bottom-2 lg:bottom-4 left-2 lg:left-4 z-10">
              <Card className="bg-white/95 backdrop-blur-sm shadow-lg border-0">
                <CardContent className="p-2 lg:p-3">
                  <div className="flex items-center space-x-1 lg:space-x-2 text-xs lg:text-sm">
                    <Info className="h-3 w-3 lg:h-4 lg:w-4 text-brand-700 flex-shrink-0" />
                    <span className="text-gray-700 truncate">
                      {filteredData.length} locations
                    </span>
                    {filteredData.length !== mapData.length && (
                      <Badge variant="secondary" className="text-xs">
                        Filtered
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
