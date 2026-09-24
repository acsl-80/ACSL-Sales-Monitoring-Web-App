import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listRequests } from "../api";

export const CHANGE_CONTROL_LIST_KEY = ["change-control", "list"] as const;

/**
 * Every request this person has raised, newest first (the server's own
 * order). There is no "get one" action in the change-request-intake
 * contract, so the detail page reads from this same cached list and finds
 * its ref in it — one fetch path for both My requests and one request, and a
 * reply, a confirm, or a fresh raise just invalidates this key to bring both
 * screens up to date.
 */
export function useMyRequests() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: CHANGE_CONTROL_LIST_KEY, queryFn: listRequests });

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: CHANGE_CONTROL_LIST_KEY }),
    [queryClient],
  );

  return {
    requests: query.data ?? [],
    isLoading: query.isPending,
    isFetching: query.isFetching,
    error: query.error ? (query.error as Error).message : null,
    refresh,
  };
}
