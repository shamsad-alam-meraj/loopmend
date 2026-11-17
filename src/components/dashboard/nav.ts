import { Activity, BarChart3, BrainCircuit, CheckCheck, LayoutDashboard, ScrollText, Settings, Siren, Undo2, Workflow } from "lucide-react";

export const NAV = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/incidents", label: "Incidents", icon: Siren },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/investigations", label: "Investigations", icon: BrainCircuit },
  { href: "/recoveries", label: "Recoveries", icon: Undo2 },
  { href: "/approvals", label: "Approvals", icon: CheckCheck },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/audit", label: "Audit log", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export { Activity };
