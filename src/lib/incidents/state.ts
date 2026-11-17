import type { IncidentStatus } from "@schema";

/** Allowed incident status transitions. System flows and humans both go through this. */
const TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  open: ["investigating", "awaiting_approval", "recovering", "resolved", "dismissed"],
  investigating: ["open", "awaiting_approval", "recovering", "resolved", "dismissed"],
  awaiting_approval: ["open", "investigating", "recovering", "resolved", "dismissed"],
  recovering: ["open", "resolved", "dead_letter", "awaiting_approval"],
  resolved: ["open"],
  dismissed: ["open"],
  dead_letter: ["open", "resolved", "awaiting_approval"],
};

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

/** Transitions a person may trigger directly from the UI/API. */
export const MANUAL_ACTIONS = {
  resolve: "resolved",
  dismiss: "dismissed",
  reopen: "open",
} as const satisfies Record<string, IncidentStatus>;
export type ManualAction = keyof typeof MANUAL_ACTIONS | "acknowledge" | "assign_self" | "unassign";

export const ACTIVE_STATUSES: IncidentStatus[] = ["open", "investigating", "awaiting_approval", "recovering"];
export const CLOSED_STATUSES: IncidentStatus[] = ["resolved", "dismissed", "dead_letter"];
