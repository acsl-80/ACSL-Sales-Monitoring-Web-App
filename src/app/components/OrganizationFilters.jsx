
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

const OrganizationFilters = ({
  searchTerm,
  activeFilters,
  onClearSearch,
  onClearFilter,
  onClearAll,
}) => {
  const hasActiveFilters =
    searchTerm ||
    activeFilters.status ||
    activeFilters.state ||
    activeFilters.city;

  if (!hasActiveFilters) return null;

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <span className="text-xs font-medium text-gray-600">Active filters:</span>

      {searchTerm && (
        <Badge
          variant="secondary"
          className="bg-brand-100 text-brand-800 border-brand-200"
        >
          Search: &ldquo;{searchTerm}&rdquo;
          <button onClick={onClearSearch} className="ml-1 hover:text-brand-900">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}

      {activeFilters.status && (
        <Badge
          variant="secondary"
          className="bg-brand-100 text-brand-800 border-brand-200"
        >
          Status: {activeFilters.status}
          <button
            onClick={() => onClearFilter("status")}
            className="ml-1 hover:text-brand-900"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}

      {activeFilters.state && (
        <Badge
          variant="secondary"
          className="bg-brand-100 text-brand-800 border-brand-200"
        >
          State: {activeFilters.state}
          <button
            onClick={() => onClearFilter("state")}
            className="ml-1 hover:text-brand-900"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}

      {activeFilters.city && (
        <Badge
          variant="secondary"
          className="bg-brand-100 text-brand-800 border-brand-200"
        >
          City: {activeFilters.city}
          <button
            onClick={() => onClearFilter("city")}
            className="ml-1 hover:text-brand-900"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}

      {/* Clear All Button */}
      <div className="space-y-1 flex flex-col justify-end">
        <button
          onClick={onClearAll}
          className="text-xs bg-white border border-gray-300 hover:bg-gray-50 px-2 py-1 rounded-md text-gray-700 whitespace-nowrap flex items-center gap-1"
        >
          <X className="h-3 w-3" />
          Clear All
        </button>
      </div>
    </div>
  );
};

export default OrganizationFilters;
