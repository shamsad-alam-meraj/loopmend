import { switchOrganizationAction } from "@/actions/auth.actions";
import type { AuthContext } from "@/lib/auth";

export function OrgSwitcher({ auth }: { auth: AuthContext }) {
  if (auth.memberships.length <= 1) {
    return <div className="truncate text-sm font-medium" title={auth.org.name}>{auth.org.name}</div>;
  }
  return (
    <form action={switchOrganizationAction} className="w-full">
      <select
        name="orgId"
        defaultValue={auth.org.id}
        aria-label="Switch organization"
        className="w-full truncate rounded-md border border-input bg-card px-2 py-1 text-sm"
      >
        {auth.memberships.map((m) => (
          <option key={m.org.id} value={m.org.id}>{m.org.name}</option>
        ))}
      </select>
      <button type="submit" className="mt-1 text-[11px] text-primary hover:underline">Switch</button>
    </form>
  );
}
