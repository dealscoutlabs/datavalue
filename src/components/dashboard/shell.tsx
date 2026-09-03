import Link from "next/link";
import { Logo } from "@/components/marketing/chrome";
import { Badge } from "@/components/ui/badge";
import { brand } from "@/config/brand";
import { signOutAction } from "@/app/dashboard/actions";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/sources", label: "Sources" },
  { href: "/questionnaire", label: "Questionnaire" },
  { href: "/report", label: "Report" },
  { href: "/settings", label: "Settings" },
] as const;

export function AppShell({
  children,
  current,
  organizationName,
  isDemo,
  isPlatformAdmin,
}: {
  children: React.ReactNode;
  current: string;
  organizationName: string;
  isDemo: boolean;
  isPlatformAdmin?: boolean;
}) {
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Logo />
            <span aria-hidden className="text-line-strong">
              /
            </span>
            <span className="truncate text-sm font-medium text-ink-muted">{organizationName}</span>
            {isDemo ? <Badge tone="caution">{brand.demo.badgeLabel}</Badge> : null}
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-md px-2 py-1 text-sm text-ink-muted hover:bg-ground hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </div>
        <div className="mx-auto max-w-6xl px-5">
          <nav aria-label="Sections" className="-mb-px flex gap-1 overflow-x-auto">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={current === n.href ? "page" : undefined}
                className={cn(
                  "whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                  current === n.href
                    ? "border-accent text-ink"
                    : "border-transparent text-ink-muted hover:text-ink"
                )}
              >
                {n.label}
              </Link>
            ))}
            {isPlatformAdmin ? (
              <Link
                href="/admin"
                aria-current={current === "/admin" ? "page" : undefined}
                className={cn(
                  "whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium",
                  current === "/admin"
                    ? "border-accent text-ink"
                    : "border-transparent text-ink-muted hover:text-ink"
                )}
              >
                Admin
              </Link>
            ) : null}
          </nav>
        </div>
      </header>

      {isDemo ? (
        <div className="border-b border-caution-line bg-caution-soft">
          <p className="mx-auto max-w-6xl px-5 py-2.5 text-xs leading-relaxed text-caution">
            <strong>Demo data.</strong> Every figure below comes from a fixed sample dataset. No
            provider account is connected, and no OAuth authorization has taken place.
          </p>
        </div>
      ) : null}

      <main id="main" className="flex-1">
        <div className="mx-auto max-w-6xl px-5 py-8">{children}</div>
      </main>
    </>
  );
}
