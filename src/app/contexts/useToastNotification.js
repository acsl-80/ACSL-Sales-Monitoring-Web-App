import { createContext, useContext } from "react";

export const ToastContext = createContext(undefined);

export const useToastNotification = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToastNotification must be used within a ToastProvider");
  }
  return context;
};
