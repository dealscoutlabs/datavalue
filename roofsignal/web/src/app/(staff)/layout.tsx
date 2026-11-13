import type { Metadata } from "next";
import Link from "next/link";

import { logout } from "@/app/(public)/login/actions";
import { getUser } from "@/lib/session";

export const metadata: Metadata = { title: "RoofSignal Staff", robots: { index: false, follow: false } };

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  const manager = user.role !== "agent";
  return (
    <>
      <header className="border-b border-line bg-surface">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
          <span className="font-semibold text-ink">RoofSignal</span>
          <Link href="/agent" className="text-ink-muted hover:text-ink">
            Call queue
          </Link>
          {manager && (
            <>
              <Link href="/admin" className="text-ink-muted hover:text-ink">
                Counties
              </Link>
              <Link href="/admin/campaigns" className="text-ink-muted hover:text-ink">
                Campaigns
              </Link>
              <Link href="/admin/compliance" className="text-ink-muted hover:text-ink">
                Compliance log
              </Link>
            </>
          )}
          <span className="ml-auto rounded bg-caution-soft px-2 py-0.5 text-xs text-caution">paid providers mocked</span>
          <span className="text-xs text-ink-subtle">
            {user.display_name} · {user.role}
          </span>
          <form action={logout}>
            <button className="text-xs text-accent hover:underline">Sign out</button>
          </form>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  );
}
