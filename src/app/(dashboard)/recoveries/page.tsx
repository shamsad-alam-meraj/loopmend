import { ComingSoon } from "@/components/ui/coming-soon";
import { requirePageAuth } from "@/lib/auth";

export default async function Page() {
  await requirePageAuth();
  return <ComingSoon title="Recoveries" description="" />;
}
