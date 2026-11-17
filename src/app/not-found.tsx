import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <Logo className="size-8" />
      <h1 className="text-xl font-semibold" data-testid="not-found">Not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">This page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>Go home</Link>
    </div>
  );
}
