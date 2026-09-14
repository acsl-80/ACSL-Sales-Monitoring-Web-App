/**
 * Who meets what first on the call centre page.
 *
 * An ordering, not a permission: the server decides what anybody may read,
 * and this decides what they meet first. Keyed on what the person may do,
 * never on the access role: the five agents in production are editors, and
 * keying on `call_agent` put their own queue below everybody else's log for
 * every one of them.
 *
 *   agent    may record calls and may not hand out work: My Work first.
 *   manager  may hand out work: the board and the console first, their own
 *            queue after, because they ask about everybody before themselves.
 *   viewer   neither: the queue and the log, read only.
 */
export type CallCentreLayout = "agent" | "manager" | "viewer";

export function callCentreLayout(input: { canEdit: boolean; canManage: boolean }): CallCentreLayout {
  if (input.canManage) return "manager";
  if (input.canEdit) return "agent";
  return "viewer";
}
