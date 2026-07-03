import React, { useRef } from "react";
import { Button } from "@/components/ui/button";
import { lgaAndStates } from "@/app/constants";
import {
  Select,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectContent,
} from "@/components/ui/select";
// import { DateRangePicker } from "@/components/ui/date-range-picker";
import ActiveFiltersBar from "@/app/sales/components/ActiveFiltersBar";
import { Download, X, Search, Plus } from "lucide-react";
import DateRangePicker from "@/app/components/ui/date-range-picker";

// Props: fetchSales is the function to call on any filter/search change
interface SalesFiltersProps {
  searchTerm: string;
  customDateRange: { startDate: string | null; endDate: string | null };
  setCustomDateRange: (range: {
    startDate: string | null;
    endDate: string | null;
  }) => void;
  selectedState: string;
  setSelectedState: (val: string) => void;
  selectedLGA: string;
  setSelectedLGA: (val: string) => void;
  handleExport: (format: string) => void;
  tableLoading: boolean;
  fetchSales: () => void;
  activeQuickFilters: any;
  clearQuickFilters: () => void;
  handleStateFilter: (val: string) => void;
  handleLGAFilter: (val: string) => void;
  handleQuickDateFilter: (val: string) => void;
  setSearchTerm: (val: string) => void;
  searchTimeoutRef: any;
  isManualSearchClear: any;
  onCreateSale: () => void;
}

const SalesFilters: React.FC<SalesFiltersProps> = ({
  searchTerm,
  setSearchTerm,
  customDateRange,
  setCustomDateRange,
  selectedState,
  setSelectedState,
  selectedLGA,
  setSelectedLGA,
  handleExport,
  tableLoading,
  fetchSales,
  activeQuickFilters,
  clearQuickFilters,
  handleStateFilter,
  handleLGAFilter,
  handleQuickDateFilter,
  searchTimeoutRef,
  isManualSearchClear,
  onCreateSale,
}) => {
  const dateChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleDateRangeChange = (
    range: {
      startDate: string | null;
      endDate: string | null;
    },
    isFinalChange = false
  ) => {
    setCustomDateRange(range);

    // Clear existing timeout
    if (dateChangeTimeoutRef.current) {
      clearTimeout(dateChangeTimeoutRef.current);
    }

    // Only fetch when isFinalChange is true (complete date selected or cleared)
    if (isFinalChange) {
      dateChangeTimeoutRef.current = setTimeout(() => {
        fetchSales();
        dateChangeTimeoutRef.current = null;
      }, 100);
    }
  };
  const nigerianStates = Object.keys(lgaAndStates).sort();
  // Find the state directly since we're now using proper case
  const stateKey = selectedState;
  const lgas =
    stateKey && (lgaAndStates as Record<string, string[]>)[stateKey]
      ? (lgaAndStates as Record<string, string[]>)[stateKey]
      : [];

  // Handlers mimic page.js: auto-fetch on change
  const onSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      fetchSales();
      searchTimeoutRef.current = null;
    }, 300);
  };

  const onStateChange = (val: string) => {
    // Don't set state here - let handleStateFilter do it to avoid race conditions

    // Check if we need to clear LGA for the new state
    const newStateLgas =
      val !== "all" && (lgaAndStates as Record<string, string[]>)[val]
        ? (lgaAndStates as Record<string, string[]>)[val]
        : [];

    // Only clear LGA if it's not valid for the new state
    if (selectedLGA && !newStateLgas.includes(selectedLGA)) {
      setSelectedLGA("");
      handleLGAFilter("all"); // Clear LGA
    }

    // Pass the state name with proper casing
    handleStateFilter(val);
  };

  const onLGAChange = (val: string) => {
    // Don't set state here - let handleLGAFilter do it to avoid race conditions
    handleLGAFilter(val);
  };

  const onDateChange = (field: "startDate" | "endDate", value: string) => {
    setCustomDateRange({ ...customDateRange, [field]: value });
    fetchSales();
  };

  return (
    <div className="bg-white border-b border-gray-200 p-4 lg:p-6">
      <div className="flex flex-col xl:flex-row gap-4 items-start xl:items-start">
        {/* Search Bar */}
        <div className="flex-1 relative min-w-0 mt-0 md:mt-6">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4 z-10" />
          <input
            type="text"
            placeholder="Search by customer name, phone, serial number..."
            value={searchTerm}
            onChange={onSearchChange}
            className="w-full pl-10 pr-4 !py-2.5 text-sm border border-gray-300 rounded-lg text-gray-600 focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          />
          {searchTerm && (
            <button
              onClick={() => {
                if (searchTimeoutRef.current) {
                  clearTimeout(searchTimeoutRef.current);
                  searchTimeoutRef.current = null;
                }
                isManualSearchClear.current = true;
                setSearchTerm("");
                fetchSales();
              }}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 z-10"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* State Filter */}
        <div className="space-y-1 w-full sm:w-auto">
          <label className="text-sm font-medium text-gray-700">State</label>
          <Select
            value={selectedState || "all"}
            onValueChange={onStateChange}
            disabled={tableLoading}
          >
            <SelectTrigger className="w-full sm:w-40 !py-2.5">
              <SelectValue placeholder="All states">
                {selectedState || "All states"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              {nigerianStates.map((state) => (
                <SelectItem key={state} value={state} className="text-gray-700">
                  {state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* LGA Filter */}
        <div className="space-y-1 w-full sm:w-auto">
          <label className="text-sm font-medium text-gray-700">LGA</label>
          <Select
            value={selectedLGA || "all"}
            onValueChange={onLGAChange}
            disabled={tableLoading || !selectedState}
          >
            <SelectTrigger className="w-full sm:w-40 !py-2.5">
              <SelectValue
                placeholder={selectedState ? "All LGAs" : "Select state first"}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All LGAs</SelectItem>
              {stateKey &&
                (lgaAndStates as Record<string, string[]>)[stateKey] &&
                (lgaAndStates as Record<string, string[]>)[stateKey].map(
                  (lga: string) => (
                    <SelectItem key={lga} value={lga}>
                      {lga}
                    </SelectItem>
                  )
                )}
            </SelectContent>
          </Select>
        </div>

        {/* Date Range - single accessible picker */}
        <div className="rounded-lg pt-2 space-y-3 w-full xl:w-auto xl:min-w-[320px]">
          <DateRangePicker
            value={customDateRange}
            onChange={handleDateRangeChange}
            maxDate={new Date().toISOString().split("T")[0]}
            disabled={tableLoading}
          />
        </div>
        <Button
          onClick={onCreateSale}
          className="bg-brand hover:bg-brand-700 text-white md:mt-7 mt-3"
        >
          <Plus className="h-4 w-4 mr-2" />
          Create Sale
        </Button>
        {/* Export Button */}
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => handleExport("csv")}
            className="text-white bg-brand md:mt-7 mt-3"
            disabled={tableLoading}
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Active Filters Bar */}
      <ActiveFiltersBar
        activeQuickFilters={activeQuickFilters}
        selectedLGA={selectedLGA}
        searchTerm={searchTerm}
        tableLoading={tableLoading}
        clearQuickFilters={clearQuickFilters}
        handleStateFilter={handleStateFilter}
        handleLGAFilter={handleLGAFilter}
        handlePartnerFilter={() => {}}
        setCustomDateRange={setCustomDateRange}
        handleQuickDateFilter={handleQuickDateFilter}
        applyFilters={fetchSales}
        setSearchTerm={setSearchTerm}
        searchTimeoutRef={searchTimeoutRef}
        isManualSearchClear={isManualSearchClear}
      />
    </div>
  );
};

export default SalesFilters;
