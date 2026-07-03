import { Button } from "@/components/ui/button";
import { Download, Trash2, X } from "lucide-react";

type BulkActionsToolbarProps = {
  selectedCount: number;
  onExportSelected: () => void;
  onDeleteSelected: () => void;
  onClearSelection: () => void;
  disabled?: boolean;
};

const BulkActionsToolbar = ({
  selectedCount,
  onExportSelected,
  onDeleteSelected,
  onClearSelection,
  disabled = false,
}: BulkActionsToolbarProps) => {
  if (selectedCount === 0) return null;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-blue-900">
            {selectedCount} item{selectedCount !== 1 ? "s" : ""} selected
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onExportSelected}
              disabled={disabled}
              className="text-blue-700 border-blue-300 hover:bg-blue-100"
            >
              <Download className="w-4 h-4 mr-2" />
              Export Selected
            </Button>
            {/* <Button
              variant="outline"
              size="sm"
              onClick={onDeleteSelected}
              disabled={disabled}
              className="text-red-700 border-red-300 hover:bg-red-100"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Selected
            </Button> */}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearSelection}
          disabled={disabled}
          className="text-blue-700 hover:bg-blue-100"
        >
          <X className="w-4 h-4 mr-2" />
          Clear Selection
        </Button>
      </div>
    </div>
  );
};

export default BulkActionsToolbar;
