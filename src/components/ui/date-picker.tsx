"use client";

import * as React from "react";
import { format, parse, isValid } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent as PopoverContentRaw,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// popover.jsx is untyped; give PopoverContent permissive props for TS.
const PopoverContent = PopoverContentRaw as React.FC<
  React.HTMLAttributes<HTMLDivElement> & { align?: "start" | "center" | "end" }
>;

interface DatePickerProps {
  /** ISO date string, YYYY-MM-DD */
  value?: string;
  /** Called with an ISO date string (YYYY-MM-DD) or "" when cleared */
  onChange?: (value: string) => void;
  placeholder?: string;
  /** ISO lower bound (inclusive) */
  min?: string;
  /** ISO upper bound (inclusive) */
  max?: string;
  className?: string;
  disabled?: boolean;
}

const toDate = (s?: string): Date | undefined => {
  if (!s) return undefined;
  const d = parse(s, "yyyy-MM-dd", new Date());
  return isValid(d) ? d : undefined;
};

const DatePicker = ({
  value,
  onChange,
  placeholder = "Select date...",
  min,
  max,
  className,
  disabled,
}: DatePickerProps) => {
  const [open, setOpen] = React.useState(false);
  const selected = toDate(value);
  const minDate = toDate(min);
  const maxDate = toDate(max);

  const disabledMatchers = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !selected && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {selected ? format(selected, "PPP") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            onChange?.(d ? format(d, "yyyy-MM-dd") : "");
            setOpen(false);
          }}
          autoFocus
          defaultMonth={selected ?? minDate}
          disabled={disabledMatchers.length ? disabledMatchers : undefined}
        />
      </PopoverContent>
    </Popover>
  );
};

DatePicker.displayName = "DatePicker";

export { DatePicker };
