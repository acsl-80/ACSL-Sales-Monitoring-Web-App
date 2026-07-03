"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { cva, type VariantProps } from "class-variance-authority";

const modalContentVariants = cva(
  "fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white shadow-lg focus:outline-none flex flex-col overflow-hidden max-h-[90vh]",
  {
    variants: {
      size: {
        sm: "max-w-sm",
        md: "max-w-md",
        lg: "max-w-lg",
        xl: "max-w-xl",
        "2xl": "max-w-2xl",
        "3xl": "max-w-3xl",
        "4xl": "max-w-4xl",
        "5xl": "max-w-5xl",
        full: "max-w-[95vw]",
      },
    },
    defaultVariants: {
      size: "lg",
    },
  }
);

type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl" | "full";
};

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = "",
  size = "lg",
  ...props
}: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} {...props}>
      <DialogOverlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm transition-opacity" />
      <DialogContent
        className={twMerge(modalContentVariants({ size }), className)}
      >
        <div className="flex-shrink-0 px-6 pt-6">
          <DialogClose asChild>
            <button
              className="absolute top-4 right-4 z-10 text-gray-400 hover:text-gray-600 focus:outline-none"
              aria-label="Close"
            >
              <span aria-hidden>
                <X className="h-4 w-4" />
              </span>
            </button>
          </DialogClose>
          {title && (
            <DialogTitle className="text-lg font-semibold mb-2">
              {title}
            </DialogTitle>
          )}
          {description && (
            <DialogDescription className="mb-4 text-gray-500">
              {description}
            </DialogDescription>
          )}
        </div>
        <div className="overflow-y-auto overflow-x-hidden flex-1 px-6 pb-6">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default Modal;
