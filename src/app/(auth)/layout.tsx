import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8 flex items-center gap-2 text-lg font-semibold">
        <Logo className="size-7" /> Loopmend
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
