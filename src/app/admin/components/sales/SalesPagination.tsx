import React from "react";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

interface SalesPaginationProps {
  pagination: {
    page: number;
    totalPages: number;
  };
  handlePageChange: (page: number) => void;
  tableLoading: boolean;
}

const SalesPagination: React.FC<SalesPaginationProps> = ({
  pagination,
  handlePageChange,
  tableLoading,
}) => (
  <Pagination>
    <PaginationContent>
      <PaginationItem>
        <PaginationPrevious
          onClick={() => handlePageChange(pagination.page - 1)}
          className={
            pagination.page <= 1 || tableLoading
              ? "pointer-events-none opacity-50"
              : "cursor-pointer"
          }
        />
      </PaginationItem>
      {[...Array(pagination.totalPages)].map((_, index) => {
        const page = index + 1;
        const isCurrentPage = page === pagination.page;
        const showPage =
          page === 1 ||
          page === pagination.totalPages ||
          (page >= pagination.page - 2 && page <= pagination.page + 2);
        if (!showPage) {
          if (page === pagination.page - 3 || page === pagination.page + 3) {
            return (
              <PaginationItem key={page}>
                <PaginationEllipsis />
              </PaginationItem>
            );
          }
          return null;
        }
        return (
          <PaginationItem key={page}>
            <PaginationLink
              onClick={() => !tableLoading && handlePageChange(page)}
              isActive={isCurrentPage}
              className={`cursor-pointer ${
                tableLoading ? "pointer-events-none" : ""
              }`}
            >
              {page}
            </PaginationLink>
          </PaginationItem>
        );
      })}
      <PaginationItem>
        <PaginationNext
          onClick={() => handlePageChange(pagination.page + 1)}
          className={
            pagination.page >= pagination.totalPages || tableLoading
              ? "pointer-events-none opacity-50"
              : "cursor-pointer"
          }
        />
      </PaginationItem>
    </PaginationContent>
  </Pagination>
);

export default SalesPagination;
