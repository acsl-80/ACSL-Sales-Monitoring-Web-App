import { useQuery } from "@tanstack/react-query";
import { getForm } from "../api";

export const CHANGE_CONTROL_FORM_KEY = ["change-control", "form"] as const;

/**
 * The form's open/closed flag and its option lists (type, impact, module —
 * filtered to this app in the caller — and the app list itself). Cached for
 * the session: nobody else changes these while someone is filling the form
 * or reading a thread's screenshot picker settings.
 */
export function useChangeControlForm() {
  return useQuery({
    queryKey: CHANGE_CONTROL_FORM_KEY,
    queryFn: getForm,
    staleTime: 5 * 60 * 1000,
  });
}
