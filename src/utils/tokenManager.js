/**
 * Centralized Token Management Service
 * Handles token storage, expiry tracking, and smart refresh logic
 */

import { createClientComponentClient } from "@/lib/supabaseClient";

/**
 * @typedef {Object} TokenData
 * @property {string} access_token
 * @property {string} refresh_token
 * @property {number} expires_at
 * @property {number} created_at
 * @property {any} user
 */

class TokenManager {
  constructor() {
    this.supabase = createClientComponentClient();
    this.tokenData = null;
    this.refreshPromise = null;
    this.REFRESH_THRESHOLD = 5 * 60 * 1000; // 5 minutes in milliseconds
    this.TOKEN_STORAGE_KEY = "transaction_app_token";
    this.loadTokenFromStorage();
  }

  /**
   * Load token from localStorage on initialization
   */
  loadTokenFromStorage() {
    try {
      if (typeof window !== "undefined") {
        const stored = localStorage.getItem(this.TOKEN_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          // Validate stored token structure
          if (parsed.access_token && parsed.expires_at && parsed.created_at) {
            this.tokenData = parsed;
          }
        }
      }
    } catch (error) {
      console.error("Error loading token from storage:", error);
      this.clearStoredToken();
    }
  }

  /**
   * Save token to localStorage
   */
  saveTokenToStorage(tokenData) {
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(this.TOKEN_STORAGE_KEY, JSON.stringify(tokenData));
        console.log("🔐 [TokenManager] Token saved to storage");
      }
    } catch (error) {
      console.error("🔐 [TokenManager] Error saving token to storage:", error);
    }
  }

  /**
   * Clear stored token
   */
  clearStoredToken() {
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem(this.TOKEN_STORAGE_KEY);
      }
      this.tokenData = null;
      console.log("🔐 [TokenManager] Token cleared from storage");
    } catch (error) {
      console.error("🔐 [TokenManager] Error clearing token:", error);
    }
  }

  /**
   * Store login response data
   */
  setLoginData(sessionData) {
    const tokenData = {
      access_token: sessionData.access_token,
      refresh_token: sessionData.refresh_token,
      expires_at: sessionData.expires_at,
      created_at: Date.now(),
      user: sessionData.user,
    };

    this.tokenData = tokenData;
    this.saveTokenToStorage(tokenData);
  }

  /**
   * Check if token needs refresh (within 5 minutes of expiry)
   */
  needsRefresh() {
    if (!this.tokenData) {
      return true;
    }

    const now = Date.now();
    const expiryTime = this.tokenData.expires_at * 1000; // Convert to milliseconds
    const timeUntilExpiry = expiryTime - now;

    return timeUntilExpiry < this.REFRESH_THRESHOLD;
  }

  /**
   * Get valid access token, refreshing if necessary
   */
  async getValidToken() {
    // If we have a valid token, return it immediately
    if (this.tokenData && !this.needsRefresh()) {
      return this.tokenData.access_token;
    }

    // If refresh is already in progress, wait for it
    if (this.refreshPromise) {
      return await this.refreshPromise;
    }

    // Start new refresh
    this.refreshPromise = this.performRefresh();

    try {
      const token = await this.refreshPromise;
      return token;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Perform the actual token refresh
   */
  async performRefresh() {
    try {
      console.log("🔐 [TokenManager] Calling Supabase refresh...");

      // Add timeout to prevent hanging
      const refreshPromise = this.supabase.auth.refreshSession();
      const timeoutPromise = new Promise((_, reject) => {
        const timeoutId =
          typeof window !== "undefined"
            ? window.setTimeout(
                () => reject(new Error("Token refresh timeout")),
                10000
              )
            : null;
        if (!timeoutId)
          reject(new Error("Token refresh timeout - no timer available"));
      });

      const { data, error } = await Promise.race([
        refreshPromise,
        timeoutPromise,
      ]);

      if (error) {
        console.error("🔐 [TokenManager] Refresh error:", error);
        throw error;
      }

      if (!data.session?.access_token) {
        console.error("🔐 [TokenManager] No access token in refresh response");
        throw new Error("No access token received from refresh");
      }

      console.log("🔐 [TokenManager] Refresh successful");

      // Update stored token data
      const newTokenData = {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
        created_at: Date.now(),
        user: data.session.user,
      };

      this.tokenData = newTokenData;
      this.saveTokenToStorage(newTokenData);

      return data.session.access_token;
    } catch (error) {
      console.error("🔐 [TokenManager] Refresh failed:", error);

      // If refresh fails, try to get current session as fallback
      try {
        console.log(
          "🔐 [TokenManager] Attempting fallback to current session..."
        );
        const { data: sessionData, error: sessionError } =
          await this.supabase.auth.getSession();

        if (sessionData.session?.access_token && !sessionError) {
          console.log("🔐 [TokenManager] Fallback successful");
          this.setLoginData(sessionData.session);
          return sessionData.session.access_token;
        }
      } catch (fallbackError) {
        console.error("🔐 [TokenManager] Fallback failed:", fallbackError);
      }

      // If everything fails, clear token and throw
      this.clearStoredToken();
      throw new Error("Token refresh failed and no valid session available");
    }
  }

  /**
   * Clear all token data (for logout)
   */
  clearToken() {
    console.log("🔐 [TokenManager] Clearing all token data");
    this.clearStoredToken();
    this.refreshPromise = null;
  }

  /**
   * Get current token info for debugging
   */
  getTokenInfo() {
    if (!this.tokenData) {
      return { hasToken: false };
    }

    const now = Date.now();
    const expiryTime = this.tokenData.expires_at * 1000;
    const timeUntilExpiry = expiryTime - now;

    return {
      hasToken: true,
      expiresAt: new Date(expiryTime).toISOString(),
      createdAt: new Date(this.tokenData.created_at).toISOString(),
      timeUntilExpiry: Math.round(timeUntilExpiry / 1000 / 60) + " minutes",
      needsRefresh: this.needsRefresh(),
      userId: this.tokenData.user?.id,
    };
  }
}

// Export singleton instance
export const tokenManager = new TokenManager();

// Make available globally for debugging
if (typeof window !== "undefined") {
  window.tokenManager = tokenManager;
}

export default tokenManager;
