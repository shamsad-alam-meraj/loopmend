import { Construction } from "lucide-react";
import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";

export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState icon={<Construction />} title="Not available yet" description="This module is being rolled out." />
    </>
  );
}
