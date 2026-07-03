
import { supabaseUrl } from "@/lib/supabaseConfig";
import { useState, useEffect, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  ChevronDown,
  ChevronRight,
  Building2,
  Loader2,
} from "lucide-react";
import { useAuth } from "../contexts/useAuth";

const OrganizationSidebar = ({ onSelectOrganization, selectedOrgIds }) => {
  const { supabase } = useAuth();
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [pagination, setPagination] = useState({
    page: 1,
    page_size: 30,
    total_count: 0,
    total_pages: 0,
  });
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const scrollContainerRef = useRef(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasAutoSelected, setHasAutoSelected] = useState(false);

  // Fetch organizations
  const fetchOrganizations = useCallback(
    async (page = 1, searchTerm = search, append = false) => {
      if (page === 1) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      try {
        const baseUrl = supabaseUrl;
        const functionUrl = `${baseUrl}/functions/v1/get-organizations-grouped`;

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token) {
          throw new Error("No authentication token found");
        }

        const params = new URLSearchParams({
          page: page.toString(),
          page_size: pagination.page_size.toString(),
        });

        if (searchTerm) {
          params.append("search", searchTerm);
        }

        const response = await fetch(`${functionUrl}?${params}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || "Failed to fetch organizations");
        }

        if (append) {
          setOrganizations((prev) => [...prev, ...(result.data || [])]);
        } else {
          setOrganizations(result.data || []);
        }

        setPagination(result.pagination || pagination);
      } catch (err) {
        console.error("Error fetching organizations:", err);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [supabase, search, pagination.page_size]
  );

  // Initial load
  useEffect(() => {
    fetchOrganizations(1, "");
  }, []);

  // Auto-select "All Organizations" on initial load
  useEffect(() => {
    if (!hasAutoSelected && !loading) {
      // Select "All Organizations" by default (empty array means all)
      onSelectOrganization([]);
      setHasAutoSelected(true);
    }
  }, [loading, hasAutoSelected, onSelectOrganization]);

  // Handle search with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchOrganizations(1, search);
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  // Handle scroll for infinite loading
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current || loadingMore || loading) return;

    const { scrollTop, scrollHeight, clientHeight } =
      scrollContainerRef.current;

    // Load more when scrolled to 80% of the content
    if (scrollTop + clientHeight >= scrollHeight * 0.8) {
      if (pagination.page < pagination.total_pages) {
        fetchOrganizations(pagination.page + 1, search, true);
      }
    }
  }, [loadingMore, loading, pagination, search, fetchOrganizations]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", handleScroll);
      return () => scrollContainer.removeEventListener("scroll", handleScroll);
    }
  }, [handleScroll]);

  // Toggle group expansion
  const toggleGroup = (groupName) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupName)) {
      newExpanded.delete(groupName);
    } else {
      newExpanded.add(groupName);
    }
    setExpandedGroups(newExpanded);
  };

  // Check if organization is selected
  const isSelected = (orgIds) => {
    if (!selectedOrgIds || selectedOrgIds.length === 0) return false;
    return orgIds.some((id) => selectedOrgIds.includes(id));
  };

  return (
    <div className="w-72 bg-white border-r border-gray-200 flex flex-col h-screen">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex-shrink-0">
        <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          Organizations
        </h2>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search organizations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Count Badge */}
        {!loading && (
          <div className="mt-2 text-xs text-gray-500">
            {pagination.total_count} organization
            {pagination.total_count !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* Organization List */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto"
        style={{ maxHeight: "calc(100vh - 200px)" }}
      >
        {loading && organizations.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : organizations.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-500">
            No organizations found
          </div>
        ) : (
          <div className="py-2">
            {/* All Organizations Option */}
            <div
              className={`flex items-center gap-2 px-4 py-2 cursor-pointer hover:bg-gray-50 transition-colors ${
                !selectedOrgIds || selectedOrgIds.length === 0
                  ? "bg-blue-50"
                  : ""
              }`}
              onClick={() => onSelectOrganization([])}
            >
              <div className="w-5" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900">
                  All Organizations
                </div>
                <div className="text-xs text-gray-500">View all sales data</div>
              </div>
              {(!selectedOrgIds || selectedOrgIds.length === 0) && (
                <Badge variant="default" className="text-xs">
                  Selected
                </Badge>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-gray-200 my-2" />

            {organizations.map((group) => {
              const isExpanded = expandedGroups.has(group.base_name);
              const isGroupSelected = isSelected(group.organization_ids);
              const hasMultipleBranches = group.branch_count > 1;

              return (
                <div key={group.base_name} className="mb-1">
                  {/* Group Header */}
                  <div
                    className={`flex items-center gap-2 px-4 py-2 cursor-pointer hover:bg-gray-50 transition-colors ${
                      isGroupSelected && !isExpanded ? "bg-blue-50" : ""
                    }`}
                    onClick={() => {
                      if (hasMultipleBranches) {
                        toggleGroup(group.base_name);
                      } else {
                        // Single branch - select directly
                        onSelectOrganization(group.organization_ids);
                      }
                    }}
                  >
                    {hasMultipleBranches && (
                      <button
                        className="p-0.5 hover:bg-gray-200 rounded"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleGroup(group.base_name);
                        }}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-gray-500" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-gray-500" />
                        )}
                      </button>
                    )}

                    {!hasMultipleBranches && <div className="w-5" />}

                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {group.base_name}
                      </div>
                      {hasMultipleBranches && (
                        <div className="text-xs text-gray-500">
                          {group.branch_count} branches
                        </div>
                      )}
                    </div>

                    {isGroupSelected && !isExpanded && (
                      <Badge variant="default" className="text-xs">
                        Selected
                      </Badge>
                    )}
                  </div>

                  {/* Branches */}
                  {isExpanded && hasMultipleBranches && (
                    <div className="ml-6 border-l border-gray-200">
                      {/* "All Branches" option */}
                      <div
                        className={`px-4 py-1.5 text-sm cursor-pointer hover:bg-gray-50 transition-colors ${
                          isGroupSelected &&
                          selectedOrgIds.length ===
                            group.organization_ids.length
                            ? "bg-blue-50 text-blue-700 font-medium"
                            : "text-gray-700"
                        }`}
                        onClick={() =>
                          onSelectOrganization(group.organization_ids)
                        }
                      >
                        <div className="flex items-center justify-between">
                          <span>All Branches</span>
                          {isGroupSelected &&
                            selectedOrgIds.length ===
                              group.organization_ids.length && (
                              <Badge variant="default" className="text-xs">
                                Selected
                              </Badge>
                            )}
                        </div>
                      </div>

                      {/* Individual branches */}
                      {group.branches.map((branch) => (
                        <div
                          key={branch.id}
                          className={`px-4 py-1.5 text-sm cursor-pointer hover:bg-gray-50 transition-colors ${
                            selectedOrgIds?.includes(branch.id)
                              ? "bg-blue-50 text-blue-700 font-medium"
                              : "text-gray-600"
                          }`}
                          onClick={() => onSelectOrganization([branch.id])}
                        >
                          <div className="flex items-center justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="truncate">{branch.branch}</div>
                              {branch.state && (
                                <div className="text-xs text-gray-500">
                                  {branch.state}
                                </div>
                              )}
                            </div>
                            {selectedOrgIds?.includes(branch.id) && (
                              <Badge variant="default" className="text-xs ml-2">
                                Selected
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Loading more indicator */}
            {loadingMore && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                <span className="ml-2 text-sm text-gray-500">
                  Loading more...
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default OrganizationSidebar;
