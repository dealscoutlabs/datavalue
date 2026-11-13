import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "RoofSignal Admin",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-line bg-surface">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 text-sm">
            <Link href="/admin" className="font-semibold text-ink">
              RoofSignal
            </Link>
            <Link href="/admin" className="text-ink-muted hover:text-ink">
              Counties
            </Link>
            <Link href="/admin/campaigns" className="text-ink-muted hover:text-ink">
              Campaigns
            </Link>
            <span className="ml-auto rounded bg-caution-soft px-2 py-0.5 text-xs text-caution">
              Phase 1 · paid providers mocked
            </span>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
