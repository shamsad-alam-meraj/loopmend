import type { Metadata } from "next";
import { requirePageAuth } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const auth = await requirePageAuth();
  return <PageHeader title={`Welcome, ${auth.user.fullName ?? auth.user.email}`} description={`${auth.org.name} · signed in as ${auth.role}`} />;
}
