import Link from "next/link";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1">{children}</div>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-2xl px-4 py-4 text-xs text-ink-subtle">
          RoofSignal is a referral service that connects homeowners with independent, licensed local contractors. We
          do not perform roofing work. <Link href="/optout" className="underline">Stop calls and texts</Link>
        </div>
      </footer>
    </div>
  );
}
