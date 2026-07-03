"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface FormGridProps extends React.HTMLAttributes<HTMLDivElement> {
  columns?: 1 | 2;
  children: React.ReactNode;
}

/**
 * FormGrid - A responsive grid layout for form fields
 *
 * By default, creates a 2-column grid on medium screens and above (md:grid-cols-2)
 * and single column on mobile devices.
 *
 * Usage:
 * <FormGrid>
 *   <FormField>...</FormField>
 *   <FormField>...</FormField>
 *   <FormField className="md:col-span-2">...</FormField> // Full width field
 * </FormGrid>
 */
export function FormGrid({
  columns = 2,
  className,
  children,
  ...props
}: FormGridProps) {
  return (
    <div
      className={cn(
        "grid gap-4",
        columns === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface FormFieldWrapperProps extends React.HTMLAttributes<HTMLDivElement> {
  fullWidth?: boolean;
  children: React.ReactNode;
}

/**
 * FormFieldWrapper - A wrapper for individual form fields within FormGrid
 *
 * Usage:
 * <FormFieldWrapper fullWidth>
 *   <Label>Field Label</Label>
 *   <Input />
 * </FormFieldWrapper>
 */
export function FormFieldWrapper({
  fullWidth = false,
  className,
  children,
  ...props
}: FormFieldWrapperProps) {
  return (
    <div
      className={cn(
        "flex flex-col space-y-2",
        fullWidth && "md:col-span-2",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export default FormGrid;
