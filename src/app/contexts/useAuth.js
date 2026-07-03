import { createContext, useContext } from "react";

// The auth context object — imported by AuthProvider and consumed by useAuth.
// Kept in its own module so AuthContext.jsx can be a component-only export,
// which lets Vite Fast Refresh hot-update without a full page reload.
export const AuthContext = createContext(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
