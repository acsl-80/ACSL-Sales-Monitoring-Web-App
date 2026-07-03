import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Plus, Download } from "lucide-react";
import BranchFormModal from "../admin/components/branches/BranchFormModal";
import BranchDetailModal from "../admin/components/branches/BranchDetailModal";
import BranchDeleteConfirmationModal from "../admin/components/branches/BranchDeleteConfirmationModal";
import superAdminBranchesService from "../services/superAdminBranchesService";
import type { Branch } from "@/types/branches";
import { useToast, ToastContainer } from "@/components/ui/toast";
import PartnerBranchesFilters from "./PartnerBranchesFilters";
import PartnerBranchesStats from "./PartnerBranchesStats";
import PartnerBranchesTable from "./PartnerBranchesTable";

interface PartnerBranchesViewProps {
  organization: any;
  onBack: () => void;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

const PartnerBranchesView: React.FC<PartnerBranchesViewProps> = ({
  organization,
  onBack,
}) => {
  const { toast, toasts, removeToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);

  const [branchesData, setBranchesData] = useState<Branch[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrev: false,
  });
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingBranch, setDeletingBranch] = useState<Branch | null>(null);

  // Filter states
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedState, setSelectedState] = useState<string>("");
  const [selectedCountry, setSelectedCountry] = useState<string>("");

  // Search debouncing
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isManualSearchClear = useRef<boolean>(false);

  useEffect(() => {
    fetchBranchesData();
  }, [organization.id]);

  // Handle search term changes with debouncing
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (isManualSearchClear.current) {
      isManualSearchClear.current = false;
      return;
    }

    searchTimeoutRef.current = setTimeout(() => {
      fetchBranchesData();
      searchTimeoutRef.current = null;
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
    };
  }, [searchTerm]);

  const fetchBranchesData = async (
    additionalFilters: Record<string, any> = {}
  ) => {
    try {
      setTableLoading(true);
      setError(null);

      // Use additionalFilters to override state values if provided
      const currentSearch = additionalFilters.hasOwnProperty("search")
        ? additionalFilters.search
        : searchTerm;
      const currentState = additionalFilters.hasOwnProperty("state")
        ? additionalFilters.state
        : selectedState;
      const currentCountry = additionalFilters.hasOwnProperty("country")
        ? additionalFilters.country
        : selectedCountry;

      // Include all filters: page, limit, search, country, state
      const filters = {
        page: additionalFilters.page || pagination.page,
        limit: additionalFilters.limit || pagination.limit,
        ...(currentSearch && currentSearch !== "" && { search: currentSearch }),
        ...(currentCountry &&
          currentCountry !== "" && { country: currentCountry }),
        ...(currentState && currentState !== "" && { state: currentState }),
      };

      const response = await superAdminBranchesService.getPartnerBranches(
        organization.id,
        filters
      );

      if (response.success) {
        setBranchesData(response.data || []);
        if (response.pagination) {
          setPagination(response.pagination);
        }
      } else {
        setError(response.error || "Failed to fetch branches data");
      }
    } catch (err) {
      console.error("Error fetching branches:", err);
      setError("An unexpected error occurred while fetching branches data");
    } finally {
      setLoading(false);
      setTableLoading(false);
    }
  };

  const handlePageChange = (page: number) => {
    setPagination((prev) => ({ ...prev, page }));
    fetchBranchesData({ page });
  };

  const handlePageSizeChange = (pageSize: number) => {
    const newPagination = { page: 1, limit: pageSize };
    setPagination((prev) => ({ ...prev, ...newPagination }));
    fetchBranchesData(newPagination);
  };

  const clearFilters = () => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }

    isManualSearchClear.current = true;
    setSearchTerm("");
    setSelectedState("");
    setSelectedCountry("");

    const newPagination = { page: 1 };
    setPagination((prev) => ({ ...prev, ...newPagination }));

    // Explicitly pass empty values to override current state
    fetchBranchesData({
      page: 1,
      search: "",
      state: "",
      country: "",
    });
  };

  // Filter handlers
  const handleStateFilter = (val: string) => {
    const newState = val === "all" ? "" : val;
    setSelectedState(newState);

    const filters: Record<string, any> = { page: 1 };
    if (newState !== "") {
      filters.state = newState;
    }

    fetchBranchesData(filters);
  };

  const handleCountryFilter = (val: string) => {
    const newCountry = val === "all" ? "" : val;
    setSelectedCountry(newCountry);
    // Clear state if changing away from Nigeria
    if (newCountry !== "Nigeria") {
      setSelectedState("");
    }

    const filters: Record<string, any> = { page: 1 };
    if (newCountry !== "") {
      filters.country = newCountry;
    }
    if (newCountry === "Nigeria" && selectedState !== "") {
      filters.state = selectedState;
    }

    fetchBranchesData(filters);
  };

  const handleExport = async (format = "csv") => {
    try {
      setTableLoading(true);
      const response = await superAdminBranchesService.exportPartnerBranches(
        organization.id,
        { search: searchTerm, state: selectedState, country: selectedCountry },
        format
      );

      if (response.success) {
        toast({
          title: "Success",
          description: "Export completed successfully",
          variant: "success",
        });
      } else {
        toast({
          title: "Error",
          description: response.error || "Export failed",
          variant: "error",
        });
      }
    } catch (err) {
      console.error("Export error:", err);
      setError("An error occurred while exporting data");
    } finally {
      setTableLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return "N/A";
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (error) {
      return "Invalid Date";
    }
  };

  const viewBranchDetails = (branch: Branch) => {
    setSelectedBranch(branch);
    setShowDetailModal(true);
  };

  const editBranch = (branch: Branch) => {
    setEditingBranch(branch);
    setShowEditModal(true);
  };

  const deleteBranch = (branch: Branch) => {
    setDeletingBranch(branch);
    setShowDeleteModal(true);
  };

  const handleCreateBranchSuccess = (branchData: Branch) => {
    fetchBranchesData();
    setShowCreateModal(false);
    toast({
      title: "Success",
      description: "Branch created successfully",
      variant: "success",
    });
  };

  const handleEditBranchSuccess = (branchData: Branch) => {
    fetchBranchesData();
    setShowEditModal(false);
    setEditingBranch(null);
    toast({
      title: "Success",
      description: "Branch updated successfully",
      variant: "success",
    });
  };

  const handleDeleteBranchConfirm = async () => {
    if (!deletingBranch) return;

    try {
      const response = await superAdminBranchesService.deletePartnerBranch(
        deletingBranch.id
      );
      if (response.success) {
        fetchBranchesData();
        setShowDeleteModal(false);
        setDeletingBranch(null);
        toast({
          title: "Success",
          description: "Branch deleted successfully",
          variant: "success",
        });
      } else {
        setError(response.error || "Failed to delete branch");
      }
    } catch (err) {
      console.error("Error deleting branch:", err);
      setError("An unexpected error occurred while deleting branch");
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading branches data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-4 lg:p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={onBack}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Partners
            </Button>
            <div className="h-6 w-px bg-gray-300" />
            <div>
              <h1 className="text-xl font-semibold text-gray-900">
                {organization.partner_name} - Branches
              </h1>
              <p className="text-sm text-gray-600">
                Manage branches for {organization.partner_name}
              </p>
            </div>
          </div>
          <Button
            onClick={() => setShowCreateModal(true)}
            className="bg-brand hover:bg-brand-700 text-white"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Branch
          </Button>
        </div>
      </div>

      {/* Filters Section */}
      <PartnerBranchesFilters
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        selectedState={selectedState}
        setSelectedState={setSelectedState}
        selectedCountry={selectedCountry}
        setSelectedCountry={setSelectedCountry}
        handleStateFilter={handleStateFilter}
        handleCountryFilter={handleCountryFilter}
        handleExport={handleExport}
        tableLoading={tableLoading}
        fetchBranches={fetchBranchesData}
        clearFilters={clearFilters}
        onCreateBranch={() => setShowCreateModal(true)}
        searchTimeoutRef={searchTimeoutRef}
        isManualSearchClear={isManualSearchClear}
      />

      {/* Stats */}
      <PartnerBranchesStats
        branchesData={branchesData}
        pagination={pagination}
        organization={organization}
      />

      {/* Table Section */}
      <div className="flex-1 overflow-auto p-4 lg:p-6">
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center justify-between">
              <p className="text-red-600">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setError(null);
                  fetchBranchesData();
                }}
              >
                Retry
              </Button>
            </div>
          </div>
        )}

        <PartnerBranchesTable
          branchesData={branchesData}
          formatDate={formatDate}
          viewBranchDetails={viewBranchDetails}
          editBranch={editBranch}
          deleteBranch={deleteBranch}
          loading={tableLoading}
          pagination={pagination}
          handlePageChange={handlePageChange}
          handlePageSizeChange={handlePageSizeChange}
        />
      </div>

      {/* Modals */}
      <BranchDetailModal
        open={showDetailModal}
        branch={selectedBranch}
        onClose={() => {
          setShowDetailModal(false);
          setSelectedBranch(null);
        }}
      />

      <BranchFormModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onSuccess={handleCreateBranchSuccess}
        mode="create"
        organizationId={organization.id}
        organizationName={organization.partner_name}
        isSuperAdmin={true}
      />

      {editingBranch && (
        <BranchFormModal
          open={showEditModal}
          onOpenChange={setShowEditModal}
          onSuccess={handleEditBranchSuccess}
          mode="edit"
          branchData={editingBranch}
          isSuperAdmin={true}
        />
      )}

      <BranchDeleteConfirmationModal
        open={showDeleteModal}
        branch={deletingBranch}
        onConfirm={handleDeleteBranchConfirm}
        onCancel={() => {
          setShowDeleteModal(false);
          setDeletingBranch(null);
        }}
      />

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
};

export default PartnerBranchesView;
