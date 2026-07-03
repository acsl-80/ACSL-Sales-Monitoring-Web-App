/**
 * Safe Fetch Wrapper with AbortController, Token Refresh, and Error Handling
 * Prevents infinite loading states and handles tab switching gracefully
 */

import { createClientComponentClient } from "@/lib/supabaseClient";
import tokenManager from "./tokenManager";

class SafeFetchManager {
  constructor() {
    this.supabase = createClientComponentClient();
    this.activeRequests = new Map();

    // TEMPORARILY DISABLED: Listen for visibility changes to handle tab switching
    // This might be interfering with component-level visibility handlers
    /*
    if (typeof window !== "undefined") {
      document.addEventListener(
        "visibilitychange",
        this.handleVisibilityChange.bind(this)
      );
    }
    */
  }

  /**
   * Handle tab/window visibility changes
   */
  handleVisibilityChange() {
    const isHidden = typeof window !== "undefined" ? document.hidden : false;
    console.log(`🔍 [SafeFetch] Tab visibility changed:`, {
      isHidden,
      activeRequests: this.activeRequests.size,
    });

    if (!isHidden) {
      this.cleanupStaleRequests();
    }
  }

  /**
   * Clean up requests that have been running too long
   */
  cleanupStaleRequests() {
    const now = Date.now();
    const STALE_TIMEOUT = 30000; // 30 seconds

    for (const [requestId, request] of this.activeRequests.entries()) {
      if (now - request.startTime > STALE_TIMEOUT) {
        console.warn("🔍 [SafeFetch] Aborting stale request:", requestId);
        request.controller.abort();
        this.activeRequests.delete(requestId);
      }
    }
  }

  /**
   * Get fresh token using tokenManager
   */
  async getToken() {
    try {
      const token = await tokenManager.getValidToken();

      if (!token) {
        throw new Error("No valid token available");
      }

      return token;
    } catch (error) {
      console.error("SafeFetch token error:", error);
      throw error;
    }
  }

  /**
   * Generate unique request ID
   */
  generateRequestId(url, options = {}) {
    const method = options.method || "GET";
    const body = options.body ? JSON.stringify(options.body) : "";
    const hash =
      typeof window !== "undefined" && window.btoa
        ? window.btoa(body).slice(0, 10)
        : body.slice(0, 10);
    return `${method}-${url}-${hash}`;
  }

  /**
   * Safe fetch with abort controller and proper error handling
   */
  async safeFetch(url, options = {}, requestContext = {}) {
    const requestId = this.generateRequestId(url, options);
    const controller =
      typeof window !== "undefined"
        ? new window.AbortController()
        : { abort: () => {}, signal: null };
    const {
      timeout = 30000,
      retryCount = 2,
      componentName = "Unknown",
    } = requestContext;

    // Store active request
    this.activeRequests.set(requestId, {
      controller,
      startTime: Date.now(),
      url,
      componentName,
    });

    try {
      // Get fresh token
      const token = await this.getToken();

      // Prepare headers
      const headers = {
        "Content-Type": "application/json",
        ...options.headers,
      };

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      // Set up timeout
      const timeoutId =
        typeof window !== "undefined"
          ? window.setTimeout(() => {
              console.warn(
                `🔍 [SafeFetch:${componentName}] Request timeout:`,
                requestId
              );
              controller.abort();
            }, timeout)
          : null;

      // Make the request
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (timeoutId && typeof window !== "undefined") {
        window.clearTimeout(timeoutId);
      }

      console.log(`🔍 [SafeFetch:${componentName}] Response received:`, {
        requestId,
        status: response.status,
        ok: response.ok,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.message ||
          `HTTP ${response.status}: ${response.statusText}`;

        // Handle specific error cases
        if (response.status === 401) {
          console.warn(
            `🔍 [SafeFetch:${componentName}] Unauthorized - may need re-login`
          );
          throw new Error("Authentication required. Please log in again.");
        } else if (response.status === 403) {
          throw new Error(
            "Access denied. You do not have permission to access this resource."
          );
        } else if (response.status >= 500) {
          throw new Error("Server error. Please try again later.");
        }

        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log(`🔍 [SafeFetch:${componentName}] Success:`, {
        requestId,
        dataLength: data?.data?.length || 0,
      });

      return data;
    } catch (error) {
      if (error.name === "AbortError") {
        console.log(
          `🔍 [SafeFetch:${componentName}] Request aborted:`,
          requestId
        );
        throw new Error("Request was cancelled");
      }

      console.error(`🔍 [SafeFetch:${componentName}] Request failed:`, {
        requestId,
        error: error.message,
        retryCount,
      });

      // Retry logic for network errors
      if (
        retryCount > 0 &&
        !error.message.includes("Authentication") &&
        !error.message.includes("Access denied")
      ) {
        console.log(
          `🔍 [SafeFetch:${componentName}] Retrying request... (${retryCount} retries left)`
        );
        if (typeof window !== "undefined") {
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
        }

        return this.safeFetch(url, options, {
          ...requestContext,
          retryCount: retryCount - 1,
        });
      }

      throw error;
    } finally {
      // Always clean up
      this.activeRequests.delete(requestId);
      console.log(
        `🔍 [SafeFetch:${componentName}] Cleaned up request:`,
        requestId
      );
    }
  }

  /**
   * Abort all requests for a specific component
   */
  abortComponentRequests(componentName) {
    console.log(
      `🔍 [SafeFetch] Aborting all requests for component: ${componentName}`
    );

    for (const [requestId, request] of this.activeRequests.entries()) {
      if (request.componentName === componentName) {
        request.controller.abort();
        this.activeRequests.delete(requestId);
      }
    }
  }

  /**
   * Clear stuck token refresh promise (emergency method)
   */
  clearTokenRefresh() {
    console.log("🔍 [SafeFetch] Manually clearing token refresh promise");
    this.tokenRefreshPromise = null;
  }

  /**
   * Get active request count for debugging
   */
  getActiveRequestCount() {
    return this.activeRequests.size;
  }

  /**
   * Get active requests for debugging
   */
  getActiveRequests() {
    return Array.from(this.activeRequests.entries()).map(([id, request]) => ({
      id,
      url: request.url,
      componentName: request.componentName,
      duration: Date.now() - request.startTime,
    }));
  }
}

// Export singleton instance
export const safeFetchManager = new SafeFetchManager();

/**
 * Hook for safe component-based fetching
 */
export const useSafeFetch = (componentName) => {
  const fetch = (url, options = {}, requestContext = {}) => {
    return safeFetchManager.safeFetch(url, options, {
      ...requestContext,
      componentName,
    });
  };

  const abortAll = () => {
    safeFetchManager.abortComponentRequests(componentName);
  };

  return { safeFetch: fetch, abortAllRequests: abortAll };
};

export default safeFetchManager;
