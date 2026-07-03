
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useAuth } from "../contexts/useAuth";
import { useToast } from "@/components/ui/toast";
import organizationsAPIService from "../services/organizationsAPIService";
import { safeFetchManager } from "../../utils/safeFetch";

export const useOrganizations = (initialFilters = {}) => {
  const { isAuthenticated, user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [tableLoading, setTableLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });

  // Component lifecycle management
  const isMountedRef = useRef(true);
  const componentName = "Organizations";
  const isLoadingRef = useRef(false);
  const hasInitializedRef = useRef(false);
  const lastNavigationRef = useRef(Date.now());

  // Reset initialization when auth changes or component remounts
  useEffect(() => {
    isMountedRef.current = true;
    lastNavigationRef.current = Date.now();

    console.log(`🔍 [${componentName}] Component mounted/remounted`, {
      isAuthenticated,
      timestamp: new Date().toISOString(),
    });

    return () => {
      isMountedRef.current = false;
      console.log(
        `🔍 [${componentName}] Component unmounting - aborting requests`
      );
      safeFetchManager.abortComponentRequests(componentName);
    };
  }, [isAuthenticated]);

  // Handle visibility changes (tab switching)
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isVisible = typeof window !== "undefined" ? !document.hidden : true;
      if (isVisible && isMountedRef.current) {
        console.log(
          `🔍 [${componentName}] Tab became visible - checking state`
        );

        // If we were loading when tab was hidden, reset state
        if (isLoadingRef.current) {
          console.warn(
            `🔍 [${componentName}] Was loading when tab hidden - resetting state`
          );
          isLoadingRef.current = false;
          setLoading(false);
          setTableLoading(false);
        }
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
      return () =>
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange
        );
    }
  }, []);

  const defaultFilters = useMemo(
    () => ({
      limit: 10,
      offset: 0,
      sortBy: "created_at",
      sortOrder: "desc",
      ...initialFilters,
    }),
    [initialFilters]
  );

  const [filters, setFilters] = useState(defaultFilters);
  const filtersRef = useRef(filters);
  const defaultFiltersRef = useRef(defaultFilters);

  useEffect(() => {
    defaultFiltersRef.current = defaultFilters;
  }, [defaultFilters]);

  useEffect(() => {
    if (JSON.stringify(filtersRef.current) !== JSON.stringify(filters)) {
      filtersRef.current = filters;
    }
  }, [filters]);

  // Safe state update helper
  const safeSetState = useCallback((updater) => {
    if (isMountedRef.current) {
      if (typeof updater === "function") {
        return updater();
      } else {
        return updater;
      }
    }
    console.log(
      `🔍 [${componentName}] Skipped state update - component unmounted`
    );
  }, []);

  // Main fetch function with enhanced error handling and lifecycle management
  const fetchOrganizationsStable = useCallback(
    async (newFilters = {}, isInitial = false) => {
      console.log(`🔍 [${componentName}] fetchOrganizationsStable called:`, {
        newFilters,
        isInitial,
        isAuthenticated,
        isLoading: isLoadingRef.current,
        isMounted: isMountedRef.current,
      });

      if (!isAuthenticated) {
        console.log(
          `🔍 [${componentName}] Not authenticated - setting error state`
        );
        safeSetState(() => {
          setError("Please login to access organizations data.");
          setLoading(false);
          setTableLoading(false);
        });
        return;
      }

      if (!isMountedRef.current) {
        console.log(
          `🔍 [${componentName}] Component unmounted - aborting fetch`
        );
        return;
      }

      if (isLoadingRef.current) {
        // Abort the in-flight request so the latest filters win
        safeFetchManager.abortComponentRequests(componentName);
        isLoadingRef.current = false;
      }

      isLoadingRef.current = true;

      try {
        console.log(`🔍 [${componentName}] Starting fetch...`);

        safeSetState(() => {
          if (isInitial) {
            setLoading(true);
          } else {
            setTableLoading(true);
          }
          setError(null);
        });

        const currentFilters = filtersRef.current;
        const mergedFilters = { ...currentFilters, ...newFilters };
        const apiFilters = {
          ...mergedFilters,
          offset: ((mergedFilters.page || 1) - 1) * (mergedFilters.limit || 10),
        };
        delete apiFilters.page;

        console.log(
          `🔍 [${componentName}] Calling API with filters:`,
          apiFilters
        );

        const response = await organizationsAPIService.getAllOrganizations(
          apiFilters,
          componentName
        );

        if (!isMountedRef.current) {
          console.log(
            `🔍 [${componentName}] Component unmounted during fetch - ignoring response`
          );
          return;
        }

        console.log(`🔍 [${componentName}] API response received:`, {
          success: response?.success,
          dataLength: response?.data?.length || 0,
        });

        if (response.success) {
          safeSetState(() => {
            setData(response.data || []);
            const apiPagination = response.pagination || {};
            setPagination({
              page:
                Math.floor(
                  (apiPagination.offset || 0) / (apiPagination.limit || 10)
                ) + 1,
              limit: apiPagination.limit || 10,
              total: apiPagination.total || 0,
              totalPages: Math.ceil(
                (apiPagination.total || 0) / (apiPagination.limit || 10)
              ),
            });
            filtersRef.current = mergedFilters;
            setFilters((prevFilters) => {
              if (
                JSON.stringify(prevFilters) !== JSON.stringify(mergedFilters)
              ) {
                return mergedFilters;
              }
              return prevFilters;
            });
          });

          if (response.data?.length > 0) {
            toast.success(
              "Loaded",
              `${response.data.length} organizations loaded successfully`
            );
          }
        } else {
          throw new Error(
            response.error || "Failed to fetch organizations data"
          );
        }
      } catch (err) {
        console.error(`🔍 [${componentName}] Fetch error:`, err.message);

        if (!isMountedRef.current) {
          console.log(
            `🔍 [${componentName}] Component unmounted during error handling - ignoring`
          );
          return;
        }

        toast.error("Error", err.message || "Error fetching organizations");

        safeSetState(() => {
          if (
            err.message.includes("401") ||
            err.message.includes("Unauthorized") ||
            err.message.includes("Missing authorization header") ||
            err.message.includes("Authentication required")
          ) {
            setError(
              "Authentication required. Please login to access organizations data."
            );
          } else if (
            err.message.includes("403") ||
            err.message.includes("Access denied") ||
            err.message.includes("super admin")
          ) {
            setError(
              "Access denied. You need super admin privileges to view this data."
            );
          } else if (err.message.includes("404")) {
            setError(
              "Organizations data endpoint not found. Please check your configuration."
            );
          } else if (err.message.includes("500")) {
            setError("Server error. Please try again later.");
          } else if (
            err.message.includes("cancelled") ||
            err.message.includes("aborted")
          ) {
            console.log(
              `🔍 [${componentName}] Request was cancelled - not setting error`
            );
            // Don't set error for cancelled requests
            return;
          } else {
            setError(`Failed to load organizations data: ${err.message}`);
          }
          setData([]);
          setPagination({ page: 1, limit: 10, total: 0, totalPages: 0 });
        });
      } finally {
        console.log(
          `🔍 [${componentName}] Fetch completed - resetting loading states`
        );

        isLoadingRef.current = false;

        if (isMountedRef.current) {
          safeSetState(() => {
            setLoading(false);
            setTableLoading(false);
          });
        }
      }
    },
    [isAuthenticated, toast, safeSetState]
  );

  const fetchOrganizations = fetchOrganizationsStable;

  const createOrganization = useCallback(
    async (organizationData) => {
      setLoading(true);
      setError(null);
      try {
        const response = await organizationsAPIService.createOrganization(
          organizationData
        );
        if (response.success) {
          await fetchOrganizationsStable({}, false);
          return response;
        } else {
          throw new Error(response.error || "Failed to create organization");
        }
      } catch (err) {
        toast.error(
          "Create Error",
          err.message || "Failed to create organization"
        );
        setError(`Failed to create organization: ${err.message}`);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [fetchOrganizationsStable, toast]
  );

  const updateOrganization = useCallback(
    async (id, organizationData) => {
      setLoading(true);
      setError(null);
      try {
        const response = await organizationsAPIService.updateOrganization(
          id,
          organizationData
        );
        if (response.success) {
          await fetchOrganizationsStable({}, false);
          return response;
        } else {
          throw new Error(response.error || "Failed to update organization");
        }
      } catch (err) {
        toast.error(
          "Update Error",
          err.message || "Failed to update organization"
        );
        setError(`Failed to update organization: ${err.message}`);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [fetchOrganizationsStable, toast]
  );

  const deleteOrganization = useCallback(
    async (id) => {
      setLoading(true);
      setError(null);
      try {
        const response = await organizationsAPIService.deleteOrganization(id);
        if (response.success) {
          await fetchOrganizationsStable({}, false);
          return response;
        } else {
          throw new Error(response.error || "Failed to delete organization");
        }
      } catch (err) {
        toast.error(
          "Delete Error",
          err.message || "Failed to delete organization"
        );
        setError(`Failed to delete organization: ${err.message}`);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [fetchOrganizationsStable, toast]
  );

  const exportOrganizations = useCallback(
    async (exportFilters = {}, format = "csv") => {
      setLoading(true);
      try {
        const currentFilters = filtersRef.current;
        const response = await organizationsAPIService.exportOrganizations(
          { ...currentFilters, ...exportFilters },
          format
        );
        if (response.success) {
          toast.success("Exported", `Data exported as ${format.toUpperCase()}`);
        } else {
          throw new Error(response.error || "Export failed");
        }
      } catch (err) {
        toast.error(
          "Export Error",
          err.message || "Error exporting organizations"
        );
        setError(`Export failed: ${err.message}`);
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  const applyFilters = useCallback(
    (newFilters) => {
      fetchOrganizationsStable(newFilters, false);
    },
    [fetchOrganizationsStable]
  );

  const resetFilters = useCallback(() => {
    const currentDefaultFilters = defaultFiltersRef.current;
    setFilters(currentDefaultFilters);
    filtersRef.current = currentDefaultFilters;
    fetchOrganizationsStable(currentDefaultFilters, false);
  }, [fetchOrganizationsStable]);

  // Emergency reset method (callable from console)
  const emergencyReset = useCallback(() => {
    console.log(`🔍 [${componentName}] EMERGENCY RESET TRIGGERED`);

    // Clear all stuck states
    safeFetchManager.clearTokenRefresh();
    safeFetchManager.abortComponentRequests(componentName);
    isLoadingRef.current = false;
    hasInitializedRef.current = false;

    // Reset component state
    setLoading(false);
    setTableLoading(false);
    setError(null);

    // Trigger fresh initialization
    const currentDefaultFilters = defaultFiltersRef.current;
    fetchOrganizationsStable(currentDefaultFilters, true);
  }, [fetchOrganizationsStable]);

  // Expose emergency reset globally for debugging
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.emergencyResetOrganizations = emergencyReset;
      return () => {
        delete window.emergencyResetOrganizations;
      };
    }
  }, [emergencyReset]);

  const searchOrganizations = useCallback(
    async (searchTerm) => {
      const searchFilters = {
        search: searchTerm,
        page: 1,
      };
      await fetchOrganizationsStable(searchFilters, false);
    },
    [fetchOrganizationsStable]
  );

  // Enhanced initialization effect with proper cleanup and navigation handling
  useEffect(() => {
    console.log(`🔍 [${componentName}] Init effect triggered:`, {
      isAuthenticated,
      hasInitialized: hasInitializedRef.current,
      isMounted: isMountedRef.current,
      lastNavigation: lastNavigationRef.current,
    });

    // Reset initialization flag if auth changes or we navigate back
    if (!isAuthenticated) {
      hasInitializedRef.current = false;
      console.log(
        `🔍 [${componentName}] Auth lost - reset initialization flag`
      );
      return;
    }

    // Check if we should reinitialize (navigation back to component)
    const now = Date.now();
    const timeSinceLastNav = now - lastNavigationRef.current;
    const shouldReinitialize = timeSinceLastNav < 1000; // If less than 1 second, likely a navigation

    if (!hasInitializedRef.current || shouldReinitialize) {
      hasInitializedRef.current = true;
      lastNavigationRef.current = now;

      console.log(`🔍 [${componentName}] Starting initialization...`, {
        shouldReinitialize,
      });

      const loadInitialData = async () => {
        try {
          if (!isMountedRef.current) {
            console.log(
              `🔍 [${componentName}] Component unmounted during init - aborting`
            );
            return;
          }

          console.log(`🔍 [${componentName}] Loading initial data...`);
          setLoading(true);
          setError(null);

          const currentDefaultFilters = defaultFiltersRef.current;

          const response = await organizationsAPIService.getAllOrganizations(
            currentDefaultFilters,
            componentName
          );

          if (!isMountedRef.current) {
            console.log(
              `🔍 [${componentName}] Component unmounted during initial load - ignoring response`
            );
            return;
          }

          if (response.success) {
            console.log(
              `🔍 [${componentName}] Initial data loaded successfully`
            );

            setData(response.data || []);
            const apiPagination = response.pagination || {};
            setPagination({
              page:
                Math.floor(
                  (apiPagination.offset || 0) / (apiPagination.limit || 10)
                ) + 1,
              limit: apiPagination.limit || 10,
              total: apiPagination.total || 0,
              totalPages: Math.ceil(
                (apiPagination.total || 0) / (apiPagination.limit || 10)
              ),
            });
            setFilters(currentDefaultFilters);
            filtersRef.current = currentDefaultFilters;
          } else {
            throw new Error(
              response.error || "Failed to fetch initial organizations data"
            );
          }
        } catch (err) {
          console.error(
            `🔍 [${componentName}] Initial load failed:`,
            err.message
          );

          if (!isMountedRef.current) {
            console.log(
              `🔍 [${componentName}] Component unmounted during error handling - ignoring`
            );
            return;
          }

          if (
            !err.message.includes("cancelled") &&
            !err.message.includes("aborted")
          ) {
            toast.error(
              "Load Error",
              err.message || "Error loading initial organizations data"
            );
            setError(`Failed to load initial data: ${err.message}`);
          }

          setData([]);
          setPagination({ page: 1, limit: 10, total: 0, totalPages: 0 });
        } finally {
          if (isMountedRef.current) {
            setLoading(false);
          }
        }
      };

      loadInitialData();
    }
  }, [user?.id, toast]); // Only re-initialize when user actually changes

  // Reset initialization when user changes (not just auth state)
  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      hasInitializedRef.current = false;
      console.log(
        `🔍 [${componentName}] User changed or logged out - reset initialization`
      );
    }
  }, [user?.id, isAuthenticated]);

  return {
    data,
    loading,
    tableLoading,
    error,
    pagination,
    filters,
    fetchOrganizations,
    createOrganization,
    updateOrganization,
    deleteOrganization,
    exportOrganizations,
    applyFilters,
    resetFilters,

    searchOrganizations,
    service: organizationsAPIService,
  };
};

export default useOrganizations;
