import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Branch } from "@/types/branches";
import {
  Edit,
  Eye,
  Trash2,
  MapPin,
  Building2,
  MoreVertical,
} from "lucide-react";

interface BranchesTableProps {
  branchesData: Branch[];
  formatDate: (date: string) => string;
  viewBranchDetails: (branch: Branch) => void;
  editBranch: (branch: Branch) => void;
  deleteBranch: (branch: Branch) => void;
  loading: boolean;
}

const BranchesTable: React.FC<BranchesTableProps> = ({
  branchesData,
  formatDate,
  viewBranchDetails,
  editBranch,
  deleteBranch,
  loading,
}) => {
  return (
    <div className="bg-white rounded-lg border border-gray-200 relative">
      {/* Table Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 bg-white/70 backdrop-blur-sm flex items-center justify-center z-10 rounded-lg">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600 mx-auto mb-2"></div>
            <p className="text-sm text-gray-600">Loading data...</p>
          </div>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Branch</TableHead>
            {/* <TableHead>Organization</TableHead> */}
            <TableHead>Location</TableHead>
            <TableHead>Created</TableHead>
            {/* <TableHead>Created By</TableHead> */}
            <TableHead className="text-center">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className={loading ? "opacity-40" : ""}>
          {branchesData.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center py-8">
                <div className="flex flex-col items-center gap-3 text-gray-500">
                  <Building2 className="h-12 w-12 text-gray-300" />
                  <div>
                    <p className="text-gray-900 font-medium">
                      No branches found
                    </p>
                    <p className="text-sm">
                      There are no branches matching your current filters.
                    </p>
                  </div>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            branchesData.map((branch) => (
              <TableRow
                key={branch.id}
                className="hover:bg-gray-50 text-gray-700"
              >
                {/* Branch Name */}
                <TableCell className="font-medium">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <Building2 className="h-4 w-4 text-brand-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        {branch.name}
                      </p>
                      {/* <p className="text-xs text-gray-500 truncate">
                        ID: {branch.id.slice(0, 8)}...
                      </p> */}
                    </div>
                  </div>
                </TableCell>

                {/* Organization */}
                {/* <TableCell>
                  <div className="max-w-[200px]">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {branch.organizations?.partner_name || "N/A"}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {branch.organizations?.email || "N/A"}
                    </p>
                  </div>
                </TableCell> */}

                {/* Location */}
                <TableCell>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <div className="min-w-0">
                      {branch.state && (
                        <p className=" text-gray-900 truncate font-medium">
                          {branch.state}
                          {branch.lga && `, ${branch.lga}`} {branch.country}
                        </p>
                      )}
                    </div>
                  </div>
                </TableCell>

                {/* Created Date */}
                <TableCell>
                  <p className="text-sm text-gray-900">
                    {formatDate(branch.created_at)}
                  </p>
                </TableCell>

                {/* Created By
                <TableCell>
                  <div className="max-w-[150px]">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {branch.profiles?.full_name || "N/A"}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {branch.profiles?.email || "N/A"}
                    </p>
                  </div>
                </TableCell> */}

                {/* Actions */}
                <TableCell className="text-center">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-8 w-8 p-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => viewBranchDetails(branch)}
                        className="py-2 px-3 rounded-md hover:!bg-primary hover:!text-white"
                      >
                        <Eye className="mr-5 h-4 w-4" />
                        View Details
                      </DropdownMenuItem>
                      <hr className="border-gray-200" />
                      <DropdownMenuItem
                        onClick={() => editBranch(branch)}
                        className="py-2 px-3 rounded-md hover:!bg-primary hover:!text-white"
                      >
                        <Edit className="mr-5 h-4 w-4" />
                        Edit Branch
                      </DropdownMenuItem>
                      <hr className="border-gray-200" />
                      <DropdownMenuItem
                        onClick={() => deleteBranch(branch)}
                        className="text-red-600 py-2 px-3 rounded-md hover:!bg-red-600 hover:!text-white"
                      >
                        <Trash2 className="mr-5 h-4 w-4" />
                        Delete Branch
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
};

export default BranchesTable;
