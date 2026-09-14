
import React from "react";
import { useLocalToast, ToastContainer } from "@/components/ui/toast";
import { ToastContext } from "./useToastNotification";

export const ToastProvider = ({ children }) => {
  // The provider owns the one list and the one container. Screens call
  // useToast(), which hands back this provider's toast.
  const { toast, toasts, removeToast } = useLocalToast();

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
};
