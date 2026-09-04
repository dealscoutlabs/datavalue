import Link from "next/link";
import { brand } from "@/config/brand";
import { Button } from "@/components/ui/button";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2 ${className}`} aria-label={`${brand.name} home`}>
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-md bg-accent text-[13px] font-bold text-white"
      >
        DV
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-ink">{brand.logoText}</span>
    </Link>
  );
}

export function SiteHeader({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Logo />
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/#how-it-works">How it works</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/data-payout">Estimator</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/#faq">FAQ</Link>
          </Button>
          {signedIn ? (
            <Button asChild size="sm">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/signin">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">{brand.primaryCta}</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              {brand.buyer.legalNotice} Connecting an account is not a sale or a license.
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <Link className="text-ink-muted hover:text-ink" href="/terms">
              Terms
            </Link>
            <Link className="text-ink-muted hover:text-ink" href="/privacy">
              Privacy
            </Link>
            <Link className="text-ink-muted hover:text-ink" href="/security">
              Data processing &amp; security
            </Link>
            <Link className="text-ink-muted hover:text-ink" href="/contact">
              Contact
            </Link>
          </nav>
        </div>
        <p className="mt-8 border-t border-line pt-6 text-xs leading-relaxed text-ink-subtle">
          {brand.legal.rateDisclosure} {brand.name} is a measurement and screening tool. It does not
          determine whether you hold the rights to license any data, and it makes no offer to buy or
          license anything.
        </p>
      </div>
    </footer>
  );
}
