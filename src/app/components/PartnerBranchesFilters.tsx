import React from "react";
import { Button } from "@/components/ui/button";
import { lgaAndStates } from "@/app/constants";
import {
  Select,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectContent,
} from "@/components/ui/select";
import { Search, X, Download } from "lucide-react";

interface PartnerBranchesFiltersProps {
  searchTerm: string;
  setSearchTerm: (val: string) => void;
  selectedState: string;
  setSelectedState: (val: string) => void;
  selectedCountry: string;
  setSelectedCountry: (val: string) => void;
  handleStateFilter: (val: string) => void;
  handleCountryFilter: (val: string) => void;
  handleExport?: (format: string) => void;
  tableLoading: boolean;
  fetchBranches: () => void;
  clearFilters: () => void;
  onCreateBranch: () => void;
  searchTimeoutRef: any;
  isManualSearchClear: any;
}

const PartnerBranchesFilters: React.FC<PartnerBranchesFiltersProps> = ({
  searchTerm,
  setSearchTerm,
  selectedState,
  setSelectedState,
  selectedCountry,
  setSelectedCountry,
  handleStateFilter,
  handleCountryFilter,
  handleExport,
  tableLoading,
  fetchBranches,
  clearFilters,
  onCreateBranch,
  searchTimeoutRef,
  isManualSearchClear,
}) => {
  const nigerianStates = Object.keys(lgaAndStates).sort();

  const onSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      fetchBranches();
      searchTimeoutRef.current = null;
    }, 300);
  };

  const onStateChange = (val: string) => {
    handleStateFilter(val);
  };

  return (
    <div className="bg-white border-b border-gray-200 p-4 lg:p-6">
      <div className="flex flex-col xl:flex-row gap-4 items-start xl:items-start">
        {/* Search Bar */}
        <div className="relative md:w-1/3 w-full mt-0 md:mt-6">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4 z-10" />
          <input
            type="text"
            placeholder="Search by branch name, state, or LGA..."
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
                fetchBranches();
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

        {/* Action Buttons */}
        <div className="flex items-center gap-3 w-full md:justify-end justify-start">
          {handleExport && (
            <Button
              variant="outline"
              onClick={() => handleExport("csv")}
              className="text-white bg-brand md:mt-7 mt-3"
              disabled={tableLoading}
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          )}

          {(searchTerm || selectedState) && (
            <Button
              variant="outline"
              onClick={clearFilters}
              className="md:mt-7 mt-3"
              disabled={tableLoading}
            >
              <X className="w-4 h-4 mr-2" />
              Clear
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PartnerBranchesFilters;
