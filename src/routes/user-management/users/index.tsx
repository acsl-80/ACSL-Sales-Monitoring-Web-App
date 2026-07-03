import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/settings/user-management/page"));

type UserManagementSearch = { edit?: string };

export const Route = createFileRoute("/user-management/users/")({
  validateSearch: (search: Record<string, unknown>): UserManagementSearch => ({
    edit: typeof search.edit === "string" ? search.edit : undefined,
  }),
  component: Page,
});
