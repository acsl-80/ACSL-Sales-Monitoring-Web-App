/**
 * Authentication Debugging Utilities
 * Run these functions in the browser console to diagnose auth issues
 * SSR-safe implementation for Next.js
 */

// Check if we're in a browser environment
import { debug } from "@/app/utils/log";
const isBrowser = typeof window !== 'undefined';

// Initialize debug object
let debugAuth = {};

// Only create debug functions in browser environment
if (isBrowser) {
  debugAuth = {
    /**
     * Check localStorage for Supabase auth data
     */
    checkLocalStorage() {
      debug("🔍 Checking localStorage for auth data...");
      
      const keys = Object.keys(localStorage).filter(key => 
        key.includes('supabase') || key.includes('auth') || key.includes('transaction')
      );
      
      debug("📁 Auth-related localStorage keys:", keys);
      
      keys.forEach(key => {
        try {
          const data = localStorage.getItem(key);
          if (key.includes('supabase.auth.token')) {
            const parsed = JSON.parse(data);
            debug(`🔑 ${key}:`, {
              hasAccessToken: !!parsed?.access_token,
              hasRefreshToken: !!parsed?.refresh_token,
              expiresAt: parsed?.expires_at ? new Date(parsed.expires_at * 1000).toISOString() : 'No expiry',
              isExpired: parsed?.expires_at ? (parsed.expires_at * 1000) < Date.now() : 'Unknown'
            });
          } else {
            debug(`📝 ${key}:`, data ? `${data.length} characters, not shown` : "empty");
          }
        } catch (error) {
          debug(`❌ ${key}: Could not parse data -`, error.message);
        }
      });
    },

    /**
     * Clear all auth-related localStorage
     */
    clearAuthStorage() {
      debug("🧹 Clearing auth-related localStorage...");
      
      const keys = Object.keys(localStorage).filter(key => 
        key.includes('supabase') || key.includes('auth') || key.includes('transaction')
      );
      
      keys.forEach(key => {
        localStorage.removeItem(key);
        debug(`🗑️ Removed: ${key}`);
      });
      
      debug("✅ Auth storage cleared. Refresh the page to test.");
    },

    /**
     * Test Supabase session manually
     */
    async testSupabaseSession() {
      try {
        debug("🧪 Testing Supabase session...");
        
        if (!window.supabase) {
          console.error("❌ Supabase client not found on window object");
          return;
        }
        
        const { data, error } = await window.supabase.auth.getSession();
        
        debug("📊 Session test results:", {
          hasSession: !!data?.session,
          hasUser: !!data?.session?.user,
          hasUser: Boolean(data?.session?.user),
          error: error?.message || 'No error'
        });
        
        if (data?.session) {
          debug("✅ Valid session found");
        } else {
          debug("❌ No valid session");
        }
        
      } catch (error) {
        console.error("💥 Error testing session:", error);
      }
    },

    /**
     * Monitor auth state changes
     */
    monitorAuthChanges() {
      if (!window.supabase) {
        console.error("❌ Supabase client not found");
        return;
      }

      debug("👁️ Starting auth state monitoring...");
      
      const { data: { subscription } } = window.supabase.auth.onAuthStateChange((event, session) => {
        debug(`🔄 Auth state change: ${event}`, {
          hasSession: !!session,
          hasUser: Boolean(session?.user),
          timestamp: new Date().toISOString()
        });
      });

      // Return cleanup function
      return () => {
        subscription.unsubscribe();
        debug("🛑 Auth monitoring stopped");
      };
    },

    /**
     * Test token refresh manually
     */
    async testTokenRefresh() {
      try {
        debug("🔄 Testing token refresh...");
        
        if (!window.supabase) {
          console.error("❌ Supabase client not found");
          return;
        }
        
        const { data, error } = await window.supabase.auth.refreshSession();
        
        debug("📊 Refresh test results:", {
          hasSession: !!data?.session,
          hasUser: !!data?.session?.user,
          hasUser: Boolean(data?.session?.user),
          error: error?.message || 'No error'
        });
        
      } catch (error) {
        console.error("💥 Error testing refresh:", error);
      }
    },

    /**
     * Analyze network requests
     */
    analyzeNetworkRequests() {
      debug("🌐 To analyze network requests:");
      debug("1. Open DevTools → Network tab");
      debug("2. Filter by 'auth' or 'token'");
      debug("3. Look for failed requests (red entries)");
      debug("4. Check request/response headers");
      
      // Monitor fetch requests
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        const [url] = args;
        if (typeof url === 'string' && (url.includes('auth') || url.includes('token'))) {
          debug(`🌐 Auth request: ${url}`);
        }
        return originalFetch.apply(window, args);
      };
      
      debug("🎯 Fetch monitoring enabled for auth requests");
    },

    /**
     * Get comprehensive debugging info
     */
    getDebugInfo() {
      debug("🔍 Authentication Debug Info:");
      debug("================================");
      
      // Browser info
      debug("🌐 Browser:", window.navigator ? window.navigator.userAgent : 'Unknown');
      debug("📍 Path:", window.location.pathname);
      debug("🔄 Page loaded at:", new Date().toISOString());
      
      // Check if localStorage is available
      try {
        localStorage.setItem('test', 'test');
        localStorage.removeItem('test');
        debug("💾 localStorage: Available");
      } catch (error) {
        debug("❌ localStorage: Not available or blocked -", error.message);
      }
      
      // Check for common auth keys
      this.checkLocalStorage();
      
      // Check if Supabase is available
      debug("🔌 Supabase client:", window.supabase ? 'Available' : 'Not found');
      
      debug("================================");
      debug("💡 Available commands:");
      debug("• debugAuth.checkLocalStorage() - Check stored auth data");
      debug("• debugAuth.clearAuthStorage() - Clear all auth data");
      debug("• debugAuth.testSupabaseSession() - Test current session");
      debug("• debugAuth.testTokenRefresh() - Test token refresh");
      debug("• debugAuth.monitorAuthChanges() - Monitor auth events");
      debug("• debugAuth.analyzeNetworkRequests() - Monitor network calls");
    },

    /**
     * Quick fix for common issues
     */
    quickFix() {
      debug("🛠️ Running quick auth fix...");
      
      // Clear potentially corrupted data
      this.clearAuthStorage();
      
      // Check for browser issues
      if (!window.localStorage) {
        console.warn("⚠️ localStorage not available - check browser settings");
      }
      
      if (!window.fetch) {
        console.warn("⚠️ fetch not available - check browser compatibility");
      }
      
      debug("🔄 Please refresh the page and try logging in again");
    }
  };

  // Attach to window for global access
  window.debugAuth = debugAuth;

  // Auto-run in development
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
    debug("🔧 Auth debugging tools loaded. Run debugAuth.getDebugInfo() for help.");
  }
}

// Export for module use (empty object on server)
export default debugAuth;
