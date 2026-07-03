
import React from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface FinancialReportsFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  paymentStatusFilter: string;
  onPaymentStatusChange: (value: string) => void;
  startDate: string;
  onStartDateChange: (value: string) => void;
  endDate: string;
  onEndDateChange: (value: string) => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
  // Optional filters for specific roles
  selectedState?: string;
  onStateChange?: (value: string) => void;
  selectedLGA?: string;
  onLGAChange?: (value: string) => void;
  orgFilter?: string;
  onOrgChange?: (value: string) => void;
  assignedOrgs?: { id: string; partner_name: string }[];
  approvalFilter?: string;
  onApprovalChange?: (value: string) => void;
  stateList?: string[];
  lgaList?: string[];
}

const FinancialReportsFilters: React.FC<FinancialReportsFiltersProps> = ({
  searchTerm,
  onSearchChange,
  paymentStatusFilter,
  onPaymentStatusChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  onClearFilters,
  hasActiveFilters,
  selectedState,
  onStateChange,
  selectedLGA,
  onLGAChange,
  orgFilter,
  onOrgChange,
  assignedOrgs = [],
  approvalFilter,
  onApprovalChange,
  stateList = [],
  lgaList = [],
}) => {
  return (
    <div className="bg-[#fafafa] p-4 rounded-lg ">
      <div className="flex flex-wrap items-center gap-4">
        {/* Search */}
        <div className="relative md:w-[400px] w-full">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            type="text"
            placeholder="Search by customer, transaction ID, phone..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 bg-white"
          />
        </div>

        {/* Payment Status */}
        <div className="flex-1 min-w-[150px] max-w-[200px]">
          <Select
            value={paymentStatusFilter}
            onValueChange={onPaymentStatusChange}
          >
            <SelectTrigger className="bg-white">
              <SelectValue placeholder="Payment Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
              <SelectItem value="unpaid">Unpaid</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* State Filter */}
        {onStateChange && (
          <div className="flex-1 min-w-[150px] max-w-[180px]">
            <Select value={selectedState} onValueChange={onStateChange}>
              <SelectTrigger className="bg-white text-sm h-10">
                <SelectValue placeholder="All States" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All States</SelectItem>
                {stateList.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* LGA Filter */}
        {onLGAChange && selectedState !== "all" && lgaList.length > 0 && (
          <div className="flex-1 min-w-[150px] max-w-[180px]">
            <Select value={selectedLGA} onValueChange={onLGAChange}>
              <SelectTrigger className="bg-white text-sm h-10">
                <SelectValue placeholder="All LGAs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All LGAs</SelectItem>
                {lgaList.map((lga) => (
                  <SelectItem key={lga} value={lga}>{lga}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Org/Partner Filter */}
        {onOrgChange && (
          <div className="flex-1 min-w-[150px] max-w-[180px]">
            <Select value={orgFilter} onValueChange={onOrgChange}>
              <SelectTrigger className="bg-white text-sm h-10">
                <SelectValue placeholder="All Partners" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Partners</SelectItem>
                {assignedOrgs.map((org) => (
                  <SelectItem key={org.id} value={org.id}>{org.partner_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Approval Filter */}
        {onApprovalChange && (
          <div className="flex-1 min-w-[150px] max-w-[180px]">
            <Select value={approvalFilter} onValueChange={onApprovalChange}>
              <SelectTrigger className="bg-white text-sm h-10">
                <SelectValue placeholder="All Approvals" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Approvals</SelectItem>
                <SelectItem value="pending">Pending Approval</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Date Range */}
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="bg-white w-[150px] h-10 text-sm"
            placeholder="Start Date"
          />
          <span className="text-gray-400 text-sm">to</span>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            className="bg-white w-[150px] h-10 text-sm"
            placeholder="End Date"
          />
        </div>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <Button
            variant="outline"
            size="sm"
            onClick={onClearFilters}
            className="flex items-center gap-1 h-10 px-3"
          >
            <X className="h-3 w-3" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
};

export default FinancialReportsFilters;
