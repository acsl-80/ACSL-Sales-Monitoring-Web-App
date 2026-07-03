import * as React from "react";
import { Check } from "lucide-react";

interface DateRange {
  startDate: string | null;
  endDate: string | null;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange, isFinalChange?: boolean) => void;
  maxDate?: string;
  disabled?: boolean;
  className?: string;
}

// Date picker with manual apply button - no automatic API calls
const DateRangePicker: React.FC<DateRangePickerProps> = ({
  value,
  onChange,
  maxDate,
  disabled,
  className = "",
}) => {
  const today = new Date().toISOString().split("T")[0];
  const [startInputValue, setStartInputValue] = React.useState("");
  const [endInputValue, setEndInputValue] = React.useState("");
  const [pendingStartDate, setPendingStartDate] = React.useState<string | null>(
    null
  );
  const [pendingEndDate, setPendingEndDate] = React.useState<string | null>(
    null
  );

  // Sync with prop values
  React.useEffect(() => {
    setStartInputValue(value.startDate || "");
    setPendingStartDate(value.startDate);
  }, [value.startDate]);

  React.useEffect(() => {
    setEndInputValue(value.endDate || "");
    setPendingEndDate(value.endDate);
  }, [value.endDate]);

  const isCompleteDate = (dateStr: string) => {
    if (!dateStr) return false;
    return dateStr.length === 10 && !isNaN(new Date(dateStr).getTime());
  };

  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setStartInputValue(newValue);

    if (isCompleteDate(newValue)) {
      setPendingStartDate(newValue);
    } else if (!newValue) {
      setPendingStartDate(null);
      // If clearing start date, also clear end date and apply immediately
      setEndInputValue("");
      setPendingEndDate(null);
      onChange({ startDate: null, endDate: null }, true);
    }
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setEndInputValue(newValue);

    if (isCompleteDate(newValue)) {
      setPendingEndDate(newValue);
    } else if (!newValue) {
      setPendingEndDate(null);
    }
  };

  const handleApplyDates = () => {
    // Apply the pending dates
    onChange(
      {
        startDate: pendingStartDate,
        endDate: pendingEndDate,
      },
      true
    );
  };

  // Show apply button when there are pending changes
  const shouldShowApplyButton =
    pendingStartDate &&
    (pendingStartDate !== value.startDate || pendingEndDate !== value.endDate);

  return (
    <div className={`flex gap-2 items-end ${className}`}>
      <div className="flex flex-col">
        <label className="text-xs text-gray-600 mb-1">Start Date</label>
        <input
          type="date"
          value={startInputValue}
          max={maxDate || today}
          onChange={handleStartDateChange}
          disabled={disabled}
          className="border rounded px-2 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-gray-600 mb-1">End Date</label>
        <input
          type="date"
          value={endInputValue}
          min={pendingStartDate || undefined}
          max={maxDate || today}
          onChange={handleEndDateChange}
          disabled={disabled || !pendingStartDate}
          className="border rounded px-2 py-1 text-sm"
        />
      </div>

      {/* Apply Button - only visible when dates are selected */}
      {shouldShowApplyButton && (
        <button
          onClick={handleApplyDates}
          disabled={disabled}
          className="border border-green-500 bg-green-50 hover:bg-green-100 text-green-700 p-2 rounded flex items-center justify-center transition-colors"
          title="Apply date filter"
        >
          <Check className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};

export default DateRangePicker;
