
import { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { createClientComponentClient } from "@/lib/supabaseClient";
import { supabaseFunctionsUrl, isSupabaseConfigured } from "@/lib/supabaseConfig";
import profileService from "../services/profileService";
import tokenManager from "../../utils/tokenManager";
import { getCachedUser, getCachedRole, setCachedRole } from "@/lib/authCache";
import { AuthContext } from "./useAuth";

// useLayoutEffect on the server logs a noisy warning; alias to useEffect there.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const isEmailIdentifier = (value) => /\S+@\S+\.\S+/.test(String(value || "").trim());

const getKnownAuthStorageKeys = () => {
  if (typeof window === "undefined") return [];
  return Object.keys(localStorage).filter(
    (key) =>
      key.startsWith("sb-") ||
      key === "user_profile" ||
      key === "transaction_app_token" ||
      key === "lovable.auth.cachedRole"
  );
};



export const AuthProvider = ({ children }) => {
  // Start with null on BOTH server and client so initial render matches
  // (no hydration mismatch). Immediately swap to cached values in a layout
  // effect — runs before the browser paints, so the spinner never appears
  // when there's a valid cached session.
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [storedProfileRole, setStoredProfileRole] = useState(null);
  const supabase = createClientComponentClient();

  useIsoLayoutEffect(() => {
    const cachedUser = getCachedUser();
    if (cachedUser) {
      setUser(cachedUser);
      setLoading(false);
    }
    const cachedRole = getCachedRole();
    if (cachedRole) setStoredProfileRole(cachedRole);
  }, []);

  // Persist role to localStorage so it's available synchronously on next load
  useEffect(() => {
    setCachedRole(storedProfileRole);
  }, [storedProfileRole]);



  // Track the last user to detect actual user changes vs session refresh
  const lastUserRef = useRef(null);

  // Expose supabase client and load debug utilities
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.supabase = supabase;

      // Dynamically import debug utilities (client-side only)
      import("../../utils/authDebug")
        .then(() => {
          console.log(
            "🔧 Enhanced auth debugging loaded. Run debugAuth.getDebugInfo() for help."
          );
        })
        .catch(() => {
          // Fallback simple debug if import fails
          window.debugAuth = {
            clearAuthStorage: () => {
              const keys = Object.keys(localStorage).filter(
                (key) =>
                  key.includes("supabase") ||
                  key.includes("auth") ||
                  key.includes("transaction")
              );
              keys.forEach((key) => localStorage.removeItem(key));
              console.log("✅ Auth storage cleared");
            },
          };
        });
    }
  }, [supabase]);

  // Debug function to check localStorage state
  const checkLocalStorageAuth = () => {
    if (typeof window !== "undefined") {
      const keys = Object.keys(localStorage).filter(
        (key) => key.includes("supabase") || key.includes("auth")
      );
      console.log("🔐 [AuthContext] LocalStorage auth keys:", keys);

      // Check for the specific Supabase auth token
      const authKey = keys.find((key) => key.includes("supabase.auth.token"));
      if (authKey) {
        try {
          const authData = JSON.parse(localStorage.getItem(authKey));
          const isExpired = authData?.expires_at
            ? authData.expires_at * 1000 < Date.now()
            : false;

          console.log("🔐 [AuthContext] Auth token in localStorage:", {
            hasAccessToken: !!authData?.access_token,
            hasRefreshToken: !!authData?.refresh_token,
            expiresAt: authData?.expires_at
              ? new Date(authData.expires_at * 1000).toISOString()
              : "No expiry",
            isExpired,
          });

          // Auto-cleanup corrupted or expired tokens
          if (
            !authData?.access_token ||
            !authData?.refresh_token ||
            isExpired
          ) {
            console.warn(
              "🔐 [AuthContext] Removing corrupted/expired auth token"
            );
            localStorage.removeItem(authKey);
            return true; // Indicates cleanup happened
          }
        } catch (e) {
          console.log(
            "🔐 [AuthContext] Could not parse auth token from localStorage - removing it"
          );
          localStorage.removeItem(authKey);
          return true; // Indicates cleanup happened
        }
      } else {
        console.log(
          "🔐 [AuthContext] No Supabase auth token found in localStorage"
        );
      }
    }
    return false; // No cleanup needed
  };

  const isAuthenticated = !!user;
  // Prefer the profiles table role once loaded. Auth metadata can be stale after
  // admin-created users are promoted from a fallback role (for example ACSL
  // Agent -> Agent), so the database profile is the source of truth.
  const userRole =
    storedProfileRole || user?.app_metadata?.role || user?.user_metadata?.role || null;

  const isSuperAdmin =
    userRole === "super_admin";
  // ACSL Agent (formerly super_admin_agent) — accept both old and new role values for backward compat
  const isAcslAgent =
    userRole === "acsl_agent" ||
    userRole === "super_admin_agent";
  const isSuperAdminAgent = isAcslAgent; // backward compat alias

  // ACSL Agent Manager — real ACSL staff who supervise and create acsl_agents
  const isAcslAgentManager =
    userRole === "acsl_agent_manager";

  // Partner (formerly admin) — accept both old and new role values for backward compat
  const isPartner =
    userRole === "partner" ||
    userRole === "admin";
  const isAdmin = isPartner; // backward compat alias

  // Partner Agent — partner-owned sales users.
  const isPartnerAgent =
    userRole === "partner_agent";

  // Agent — standalone partner-linked sales users.
  const isAgent =
    userRole === "agent" ||
    userRole === "agent_user";

  // Helper function to check if user has admin level access (partner, partner_agent, super_admin, or acsl_agent)
  const hasAdminAccess = isSuperAdmin || isAcslAgent || isAcslAgentManager || isPartner || isPartnerAgent || isAgent;

  // TODO: TEMPORARY - Remove this atmosfair.com email check when implementing proper role-based navigation
  // Helper function to check if user email contains atmosfair.com
  const isAtmosfairUser = user?.email?.includes("atmosfair.com") || false;

  useEffect(() => {
    const getSession = async () => {
      try {
        console.log("🔐 [AuthContext] Getting initial session...");

        // Check localStorage state as suggested in the debugging guide
        const cleanupHappened = checkLocalStorageAuth();
        if (cleanupHappened) {
          console.log("🔐 [AuthContext] Corrupted auth data was cleaned up");
        }

        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        // Debug logging as suggested in the message
        console.log("🔐 [AuthContext] Session data:", {
          session: session ? "Present" : "None",
          user: session?.user?.email || "No user",
          error: error?.message || "No error",
        });

        setUser(session?.user || null);

        // If user is already logged in, ensure profile data is available
        if (session?.user) {
          // Store session data in tokenManager
          if (session) {
            console.log(
              "🔐 [AuthContext] Storing session data in tokenManager"
            );
            tokenManager.setLoginData(session);
          }

          // Sync role from stored profile immediately so routing works
          const storedProfile = profileService.getStoredProfileData();
          if (storedProfile?.role) setStoredProfileRole(storedProfile.role);

          // Fetch profile in background if not cached — do NOT await
          if (!storedProfile) {
            profileService.fetchAndStoreProfile().then((profileResponse) => {
              if (!profileResponse.success) {
                console.warn("Failed to fetch user profile on session restore:", profileResponse.error);
              }
              const latestProfile = profileService.getStoredProfileData();
              if (latestProfile?.role) setStoredProfileRole(latestProfile.role);
            }).catch((profileError) => {
              console.error("Error fetching profile on session restore:", profileError.message || profileError);
            });
          }
        } else {
          console.log(
            "🔐 [AuthContext] No session found - user needs to log in"
          );
        }
      } catch (error) {
        console.error("🔐 [AuthContext] Error getting session:", error);
        setUser(null);
      } finally {
        console.log("🔐 [AuthContext] Setting loading to false");
        setLoading(false);
      }
    };

    getSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      const sessionUserId = session?.user?.id || null;
      const lastUserId = lastUserRef.current?.id || null;
      const isNewUser = sessionUserId !== lastUserId;

      // Only log significant events, not session validation noise
      if (isNewUser || event === "SIGNED_OUT" || event === "TOKEN_REFRESHED") {
        console.log("🔐 [AuthContext] Significant auth state change:", {
          event,
          isNewUser,
          userEmail: session?.user?.email || "No user",
          wasUser: lastUserRef.current?.email || "None",
        });
      } else {
        console.log("🔐 [AuthContext] Session validation:", { event });
      }

      // Update user state only if actually different OR if this is a significant event
      const newUser = session?.user || null;
      const oldUserId = user?.id || null;
      const newUserId = newUser?.id || null;

      const hasUserChanged =
        oldUserId !== newUserId || (!user && newUser) || (user && !newUser);

      const isSignificantEvent =
        isNewUser || event === "SIGNED_OUT" || event === "INITIAL_SESSION";

      if (hasUserChanged && isSignificantEvent) {
        console.log("🔐 [AuthContext] User state actually changed, updating", {
          oldId: oldUserId,
          newId: newUserId,
          event,
          isSignificantEvent,
        });
        setUser(newUser);
      } else {
        console.log("🔐 [AuthContext] Skipping state update", {
          userId: oldUserId,
          event,
          hasUserChanged,
          isSignificantEvent,
        });
      }

      // Update last user reference
      lastUserRef.current = session?.user || null;

      // Handle auth state changes - only for significant events
      if (event === "SIGNED_IN" && session?.user && isNewUser) {
        // Store session data in tokenManager
        console.log("🔐 [AuthContext] Storing login session in tokenManager");
        tokenManager.setLoginData(session);

        // Fetch profile in background — do NOT await so loading clears immediately
        profileService.fetchAndStoreProfile().then((profileResponse) => {
          if (!profileResponse.success) {
            console.warn("Failed to fetch user profile on sign in:", profileResponse.error);
          }
          // Sync role from profile so routing works even if JWT metadata lacks the role
          const signInProfile = profileService.getStoredProfileData();
          if (signInProfile?.role) setStoredProfileRole(signInProfile.role);
        }).catch((profileError) => {
          console.error("Error fetching profile on sign in:", profileError.message || profileError);
        });
      } else if (event === "SIGNED_OUT") {
        // Clear profile and token data on sign out
        profileService.clearStoredProfileData();
        tokenManager.clearToken();
        setStoredProfileRole(null);

        // Clear only known auth/session keys. Avoid wiping unrelated app keys.
        if (typeof window !== "undefined") {
          getKnownAuthStorageKeys().forEach((key) => localStorage.removeItem(key));
        }

        // Ensure user state is immediately cleared
        setUser(null);
      }

      console.log(
        "🔐 [AuthContext] Auth state change complete, setting loading to false"
      );
      setLoading(false);
    });

    return () => subscription?.unsubscribe();
  }, [supabase.auth]);

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    // If login is successful, fetch and store user profile
    if (data?.user && !error) {
      // Store session data in tokenManager
      if (data.session) {
        console.log("🔐 [AuthContext] Storing login response in tokenManager");
        tokenManager.setLoginData(data.session);
      }

      // Fetch profile in background — do NOT await so login completes immediately
      profileService.fetchAndStoreProfile().then((profileResponse) => {
        if (!profileResponse.success) {
          console.warn("Failed to fetch user profile:", profileResponse.error);
        }
        const loginProfile = profileService.getStoredProfileData();
        if (loginProfile?.role) setStoredProfileRole(loginProfile.role);
      }).catch((profileError) => {
        console.error("Error fetching profile after login:", profileError.message || profileError);
      });
    }

    return { data, error };
  };

  const signInWithCredentials = async (identifier, password) => {
    try {
      console.log("🔐 [AuthContext] Attempting credentials login...");

      void isSupabaseConfigured;
      const trimmedIdentifier = String(identifier || "").trim();

      const tryDirectEmailLogin = async () => {
        if (!isEmailIdentifier(trimmedIdentifier)) {
          return {
            data: null,
            error: { message: "Login failed. Please check your username/email and password." },
          };
        }

        const { data, error } = await signIn(trimmedIdentifier, password);
        if (error) {
          return {
            data: null,
            error: { message: error.message || "Login failed. Please check your email and password." },
          };
        }

        const directProfileResponse = await profileService.fetchAndStoreProfile();
        const directProfile =
          directProfileResponse?.data || profileService.getStoredProfileData();
        if (directProfile?.role) setStoredProfileRole(directProfile.role);

        return {
          data: {
            user: data?.user,
            session: data?.session,
            profile: directProfile,
            role:
              directProfile?.role ||
              data?.user?.app_metadata?.role ||
              data?.user?.user_metadata?.role,
          },
          error: null,
        };
      };

      let response;
      let responseData = null;

      try {
        response = await fetch(
          `${supabaseFunctionsUrl}/login-with-credentials`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              identifier: trimmedIdentifier,
              password,
            }),
          }
        );
        responseData = await response.json().catch(() => ({}));
      } catch (networkError) {
        console.error(
          "🔐 [AuthContext] Credentials login endpoint unreachable, trying email login fallback:",
          networkError
        );
        return tryDirectEmailLogin();
      }

      if (!response.ok) {
        console.error("🔐 [AuthContext] Credentials login failed:", responseData?.error);

        if (isEmailIdentifier(trimmedIdentifier) || response.status >= 500 || response.status === 404) {
          return tryDirectEmailLogin();
        }

        return {
          data: null,
          error: {
            message:
              responseData?.error ||
              "Login failed. Please check your username/email and password.",
          },
        };
      }

      if (responseData.success && responseData.session) {
        console.log(
          "🔐 [AuthContext] Credentials login successful, setting session"
        );

        // Set the session in Supabase client
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: responseData.session.access_token,
          refresh_token: responseData.session.refresh_token,
        });

        if (sessionError) {
          console.error(
            "🔐 [AuthContext] Error setting session:",
            sessionError
          );
          return { data: null, error: sessionError };
        }

        // Store session data in tokenManager
        tokenManager.setLoginData(responseData.session);

        // Store profile data if provided
        if (responseData.profile) {
          console.log(
            "🔐 [AuthContext] Storing profile from credentials response"
          );
          profileService.setProfile(responseData.profile);
          if (responseData.profile.role) setStoredProfileRole(responseData.profile.role);
        }

        // Update user state
        setUser(responseData.session.user);

        return {
          data: {
            user: responseData.session.user,
            session: responseData.session,
            profile: responseData.profile,
            role:
              responseData.profile?.role ||
              responseData.session.user?.app_metadata?.role ||
              responseData.session.user?.user_metadata?.role,
          },
          error: null,
        };
      }

      return {
        data: null,
        error: { message: "Invalid response format" },
      };
    } catch (error) {
      console.error("🔐 [AuthContext] Error during credentials login:", error);
      return {
        data: null,
        error: {
          message:
            error.message === "Failed to fetch"
              ? "Login service is currently unreachable. Please try again."
              : error.message || "An unexpected error occurred",
        },
      };
    }
  };

  const signOut = async () => {
    try {
      console.log("🔐 [AuthContext] Starting sign out process...");

      // Clear stored profile data and token before signing out
      profileService.clearStoredProfileData();
      tokenManager.clearToken();

      // Clear known auth data BEFORE Supabase signOut without touching unrelated app keys.
      if (typeof window !== "undefined") {
        const keys = getKnownAuthStorageKeys();
        console.log("🔐 [AuthContext] Clearing localStorage keys:", keys);
        keys.forEach((key) => {
          try {
            localStorage.removeItem(key);
          } catch (e) {
            console.error(`Failed to remove ${key}:`, e);
          }
        });
      }

      // Ensure user state is cleared immediately BEFORE Supabase call
      setUser(null);

      // Sign out from Supabase
      const { error } = await supabase.auth.signOut({ scope: "local" });

      if (error) {
        console.error("🔐 [AuthContext] Sign out error:", error);
        // Don't return error - we've already cleared local state
      }

      console.log("🔐 [AuthContext] Sign out completed successfully");
      return { error: null };
    } catch (error) {
      console.error(
        "🔐 [AuthContext] Unexpected error during sign out:",
        error
      );

      // Even if there's an error, clear local state
      profileService.clearStoredProfileData();
      tokenManager.clearToken();
      setUser(null);

      // Clear known auth data again
      if (typeof window !== "undefined") {
        const keys = getKnownAuthStorageKeys();
        keys.forEach((key) => {
          try {
            localStorage.removeItem(key);
          } catch (e) {
            console.error(`Failed to remove ${key}:`, e);
          }
        });
      }

      return { error: null }; // Return success even if Supabase signOut failed
    }
  };

  const value = useMemo(() => ({
    user,
    loading,
    isAuthenticated,
    isSuperAdmin,
    isSuperAdminAgent,
    isAcslAgent,
    isAcslAgentManager,
    isAdmin,
    isPartner,
    isAgent,
    isPartnerAgent,
    hasAdminAccess,
    userRole,
    storedProfileRole,
    isAtmosfairUser,
    signIn,
    signInWithCredentials,
    signOut,
    supabase,
    getStoredProfile: () => profileService.getStoredProfileData(),
    getOrganizationId: () => profileService.getOrganizationId(),
    getUserDetails: () => profileService.getUserDetails(),
  }), [user, loading, isAuthenticated, isSuperAdmin, isSuperAdminAgent, isAcslAgent, isAcslAgentManager, isAdmin, isPartner, isAgent, isPartnerAgent, hasAdminAccess, userRole, storedProfileRole, isAtmosfairUser, supabase]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
