import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

/**
 * ActiveFiltersBar component displays currently active filters as badges and a clear button.
 */
const ActiveFiltersBar = ({
  activeQuickFilters,
  selectedLGA,
  searchTerm,
  tableLoading,
  clearQuickFilters,
  handleStateFilter,
  handleLGAFilter,
  handlePartnerFilter,
  setCustomDateRange,
  handleQuickDateFilter,
  applyFilters,
  setSearchTerm,
  searchTimeoutRef,
  isManualSearchClear,
}) =>
  (activeQuickFilters.dateRange ||
    activeQuickFilters.state ||
    selectedLGA ||
    activeQuickFilters.partner ||
    searchTerm) && (
    <div className="flex flex-wrap gap-2 items-center md:mt-5 mt-0">
      <span className="text-xs font-medium text-gray-600">Active filters:</span>
      {searchTerm && (
        <Badge
          variant="secondary"
          className="bg-brand-100 text-brand-800 border-brand-200"
        >
          Search: &ldquo;{searchTerm}&rdquo;
          <button
            onClick={() => {
              if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
                searchTimeoutRef.current = null;
              }
              isManualSearchClear.current = true;
              setSearchTerm("");
              applyFilters({ search: "", page: 1 });
            }}
            className="ml-1 hover:text-brand-900"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}
      {activeQuickFilters.dateRange && (
        <Badge
          variant="secondary"
          className="bg-brand-100 text-brand-800 border-brand-200 h-8"
        >
          Date: {activeQuickFilters.dateRange}
          <button
            onClick={() => {
              setCustomDateRange({ startDate: null, endDate: null });
              handleQuickDateFilter("all");
            }}
            className="ml-1 hover:text-brand-900"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}
      {activeQuickFilters.state && (
        <Badge
          variant="secondary"
          className="bg-brand-100 text-brand-800 border-brand-200 h-8"
        >
          State: {activeQuickFilters.state}
          <button
            onClick={() => handleStateFilter("all")}
            className="ml-1 hover:text-brand-900"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}
      {selectedLGA && (
        <Badge
          variant="secondary"
          className="bg-brand-100 text-brand-800 border-brand-200 h-8"
        >
          LGA: {selectedLGA}
          <button
            onClick={() => handleLGAFilter("all")}
            className="ml-1 hover:text-brand-900"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}
      {activeQuickFilters.partner && (
        <Badge
          variant="secondary"
          className="bg-brand-100 text-brand-800 border-brand-200 h-8"
        >
          Partner: {activeQuickFilters.partner}
          <button
            onClick={() => handlePartnerFilter("all")}
            className="ml-1 hover:text-brand-900"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}
      {/* Clear Filters Button */}
      <div className="space-y-1 flex flex-col justify-end">
        <button
          type="button"
          onClick={clearQuickFilters}
          className="text-xs h-8 whitespace-nowrap text-gray-700 border border-gray-300 rounded px-2 py-1 bg-white hover:bg-gray-100"
          disabled={tableLoading}
        >
          <X className="h-3 w-3 mr-1 inline" />
          Clear All
        </button>
      </div>
    </div>
  );

export default ActiveFiltersBar;
