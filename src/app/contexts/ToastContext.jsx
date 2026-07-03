
import React from "react";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { ToastContext } from "./useToastNotification";

export const ToastProvider = ({ children }) => {
  const { toast, toasts, removeToast } = useToast();

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
};
