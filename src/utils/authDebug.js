/**
 * Authentication Debugging Utilities
 * Run these functions in the browser console to diagnose auth issues
 * SSR-safe implementation for Next.js
 */

// Check if we're in a browser environment
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
      console.log("🔍 Checking localStorage for auth data...");
      
      const keys = Object.keys(localStorage).filter(key => 
        key.includes('supabase') || key.includes('auth') || key.includes('transaction')
      );
      
      console.log("📁 Auth-related localStorage keys:", keys);
      
      keys.forEach(key => {
        try {
          const data = localStorage.getItem(key);
          if (key.includes('supabase.auth.token')) {
            const parsed = JSON.parse(data);
            console.log(`🔑 ${key}:`, {
              hasAccessToken: !!parsed?.access_token,
              hasRefreshToken: !!parsed?.refresh_token,
              expiresAt: parsed?.expires_at ? new Date(parsed.expires_at * 1000).toISOString() : 'No expiry',
              isExpired: parsed?.expires_at ? (parsed.expires_at * 1000) < Date.now() : 'Unknown'
            });
          } else {
            console.log(`📝 ${key}:`, data?.length > 100 ? `${data.substring(0, 100)}...` : data);
          }
        } catch (error) {
          console.log(`❌ ${key}: Could not parse data -`, error.message);
        }
      });
    },

    /**
     * Clear all auth-related localStorage
     */
    clearAuthStorage() {
      console.log("🧹 Clearing auth-related localStorage...");
      
      const keys = Object.keys(localStorage).filter(key => 
        key.includes('supabase') || key.includes('auth') || key.includes('transaction')
      );
      
      keys.forEach(key => {
        localStorage.removeItem(key);
        console.log(`🗑️ Removed: ${key}`);
      });
      
      console.log("✅ Auth storage cleared. Refresh the page to test.");
    },

    /**
     * Test Supabase session manually
     */
    async testSupabaseSession() {
      try {
        console.log("🧪 Testing Supabase session...");
        
        if (!window.supabase) {
          console.error("❌ Supabase client not found on window object");
          return;
        }
        
        const { data, error } = await window.supabase.auth.getSession();
        
        console.log("📊 Session test results:", {
          hasSession: !!data?.session,
          hasUser: !!data?.session?.user,
          userEmail: data?.session?.user?.email,
          error: error?.message || 'No error'
        });
        
        if (data?.session) {
          console.log("✅ Valid session found");
        } else {
          console.log("❌ No valid session");
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

      console.log("👁️ Starting auth state monitoring...");
      
      const { data: { subscription } } = window.supabase.auth.onAuthStateChange((event, session) => {
        console.log(`🔄 Auth state change: ${event}`, {
          hasSession: !!session,
          userEmail: session?.user?.email,
          timestamp: new Date().toISOString()
        });
      });

      // Return cleanup function
      return () => {
        subscription.unsubscribe();
        console.log("🛑 Auth monitoring stopped");
      };
    },

    /**
     * Test token refresh manually
     */
    async testTokenRefresh() {
      try {
        console.log("🔄 Testing token refresh...");
        
        if (!window.supabase) {
          console.error("❌ Supabase client not found");
          return;
        }
        
        const { data, error } = await window.supabase.auth.refreshSession();
        
        console.log("📊 Refresh test results:", {
          hasSession: !!data?.session,
          hasUser: !!data?.session?.user,
          userEmail: data?.session?.user?.email,
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
      console.log("🌐 To analyze network requests:");
      console.log("1. Open DevTools → Network tab");
      console.log("2. Filter by 'auth' or 'token'");
      console.log("3. Look for failed requests (red entries)");
      console.log("4. Check request/response headers");
      
      // Monitor fetch requests
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        const [url] = args;
        if (typeof url === 'string' && (url.includes('auth') || url.includes('token'))) {
          console.log(`🌐 Auth request: ${url}`);
        }
        return originalFetch.apply(window, args);
      };
      
      console.log("🎯 Fetch monitoring enabled for auth requests");
    },

    /**
     * Get comprehensive debugging info
     */
    getDebugInfo() {
      console.log("🔍 Authentication Debug Info:");
      console.log("================================");
      
      // Browser info
      console.log("🌐 Browser:", window.navigator ? window.navigator.userAgent : 'Unknown');
      console.log("📍 URL:", window.location.href);
      console.log("🔄 Page loaded at:", new Date().toISOString());
      
      // Check if localStorage is available
      try {
        localStorage.setItem('test', 'test');
        localStorage.removeItem('test');
        console.log("💾 localStorage: Available");
      } catch (error) {
        console.log("❌ localStorage: Not available or blocked -", error.message);
      }
      
      // Check for common auth keys
      this.checkLocalStorage();
      
      // Check if Supabase is available
      console.log("🔌 Supabase client:", window.supabase ? 'Available' : 'Not found');
      
      console.log("================================");
      console.log("💡 Available commands:");
      console.log("• debugAuth.checkLocalStorage() - Check stored auth data");
      console.log("• debugAuth.clearAuthStorage() - Clear all auth data");
      console.log("• debugAuth.testSupabaseSession() - Test current session");
      console.log("• debugAuth.testTokenRefresh() - Test token refresh");
      console.log("• debugAuth.monitorAuthChanges() - Monitor auth events");
      console.log("• debugAuth.analyzeNetworkRequests() - Monitor network calls");
    },

    /**
     * Quick fix for common issues
     */
    quickFix() {
      console.log("🛠️ Running quick auth fix...");
      
      // Clear potentially corrupted data
      this.clearAuthStorage();
      
      // Check for browser issues
      if (!window.localStorage) {
        console.warn("⚠️ localStorage not available - check browser settings");
      }
      
      if (!window.fetch) {
        console.warn("⚠️ fetch not available - check browser compatibility");
      }
      
      console.log("🔄 Please refresh the page and try logging in again");
    }
  };

  // Attach to window for global access
  window.debugAuth = debugAuth;

  // Auto-run in development
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
    console.log("🔧 Auth debugging tools loaded. Run debugAuth.getDebugInfo() for help.");
  }
}

// Export for module use (empty object on server)
export default debugAuth;
