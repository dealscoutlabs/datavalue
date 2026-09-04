import Link from "next/link";
import { auth } from "@/lib/auth";
import { brand } from "@/config/brand";
import { catalog, COMING_SOON } from "@/lib/connectors/registry";
import { SiteFooter, SiteHeader } from "@/components/marketing/chrome";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

/*
 * FRAMING NOTE — read before editing this page.
 *
 * There is no dollar figure on the homepage. Not a range, not an average, not a
 * "businesses like yours" teaser. The hero measures and screens; it does not
 * price. FTC Section 5 deception is assessed on the NET IMPRESSION a
 * communication leaves, not on whether a disclaimer appeared somewhere below it,
 * so a headline number with fine print beneath it would fail the test no matter
 * how carefully the fine print were worded. The eligibility-first framing is
 * what makes this product defensible.
 */

const STEPS = [
  {
    n: "1",
    title: "Connect your sources",
    body: "Authorize read-only, metadata-only access to the services your business already uses. We never request permission to read a file, an email or a customer record.",
  },
  {
    n: "2",
    title: "We measure what is there",
    body: "A metadata scan counts volume, file and record totals, broad category mix and the date range your data spans — and tells you how each number was obtained.",
  },
  {
    n: "3",
    title: "You get an eligibility assessment",
    body: "A short rights and sensitivity questionnaire produces your Data Inventory & Eligibility Report. Where the screening passes, it also shows indicative per-unit reference rates.",
  },
];

const FAQ = [
  {
    q: "What exactly do you scan?",
    a: "Metadata only: byte sizes, file and record counts, file extensions and MIME categories, and timestamps. The scan calls no download or content endpoint on any provider. It cannot read a document, an email body, a chat message or a customer record, because we never request the permissions that would allow it.",
  },
  {
    q: "Does connecting an account sell my data?",
    a: "No. Connecting grants read-only, metadata-only access so we can measure volume. It is not a sale, a license, an option or an agreement of any kind. Nothing is sold or shared without a separate signed agreement that you would negotiate and sign.",
  },
  {
    q: "Why does most business communication data require a rights review?",
    a: "Because email and chat archives structurally contain material the business did not write. Every thread has a counterparty; every mailbox contains employee correspondence, job applicants, vendors and customers. A business generally cannot license the other side of its own conversations on its own authority. We mark communication corpora as requiring review by default, regardless of how the questionnaire is answered.",
  },
  {
    q: "How do the rate estimates work?",
    a: "Where the eligibility screening passes, we show a per-unit reference range — dollars per gigabyte, or dollars per usable record — with the full multiplier chain visible so you can see how each number was derived. These are illustrative reference points drawn from publicly reported corpus-licensing activity. They are not quotes, offers or appraisals, and we do not add them into a portfolio total.",
  },
  {
    q: "Why isn't there a total dollar figure?",
    a: "Because it would not be honest. A total implies both that your data is licensable and that a buyer exists at that price, and neither is established by a metadata scan. What we can measure honestly is how much data you have, of what broad kind, from when — and whether anything in it obviously blocks a licensing conversation. That is what this product reports.",
  },
  {
    q: "How is my data secured?",
    a: "OAuth credentials are encrypted at rest with AES-256-GCM using a server-held key and are never exposed to the browser. We request the narrowest read-only scopes each provider offers and never request write or delete permissions. Tokens and provider payloads are redacted from logs. You can disconnect a source at any time, which revokes the credential where the provider supports it and deletes the stored tokens, cursors and measurements.",
  },
  {
    q: "What happens next if my screening passes?",
    a: "You can request a verified review. That records your details and notifies our team; a person then looks at the rights position properly. Requesting a review does not commit you to anything and is not an offer from us.",
  },
];

export default async function HomePage() {
  const session = await auth();
  const sources = catalog();

  return (
    <>
      <SiteHeader signedIn={Boolean(session?.user)} />

      <main id="main" className="flex-1">
        {/* Hero — measurement and eligibility only. No currency figure. */}
        <section className="border-b border-line bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
            <div className="max-w-2xl">
              <Badge tone="neutral" className="mb-6">
                Metadata-only · Read-only · Disconnect anytime
              </Badge>
              <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">
                {brand.tagline}
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-ink-muted">{brand.supportingText}</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <Link href="/signup">{brand.primaryCta}</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/demo">View demo</Link>
                </Button>
                <Button asChild size="lg" variant="ghost">
                  <Link href="/data-payout">Try the estimator</Link>
                </Button>
              </div>
              <p className="mt-5 text-sm text-ink-subtle">
                No dollar figure is shown before you complete the rights questionnaire, and none is
                shown for any source that needs a rights review.
              </p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-20 border-b border-line">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <h2 className="text-2xl font-semibold tracking-tight text-ink">How it works</h2>
            <ol className="mt-8 grid gap-5 md:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.n}>
                  <Card className="h-full">
                    <CardContent className="pt-6">
                      <span
                        aria-hidden
                        className="grid size-8 place-items-center rounded-full border border-accent-line bg-accent-soft text-sm font-semibold text-accent"
                      >
                        {s.n}
                      </span>
                      <h3 className="mt-4 text-base font-semibold text-ink">{s.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{s.body}</p>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Supported sources */}
        <section className="border-b border-line bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <h2 className="text-2xl font-semibold tracking-tight text-ink">Supported sources</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
              A source is listed as supported only when it can genuinely be connected, scanned,
              measured and disconnected. Where a provider&rsquo;s own policies limit what can be measured,
              that limit is stated here rather than hidden.
            </p>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sources.map((s) => (
                <li key={s.provider}>
                  <Card className="h-full">
                    <CardContent className="pt-6">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-semibold text-ink">{s.label}</h3>
                        {s.liveCapable ? (
                          <Badge tone="positive">Available</Badge>
                        ) : (
                          <Badge tone="caution">Demo only</Badge>
                        )}
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{s.description}</p>
                      {s.limitationNotice ? (
                        <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-subtle">
                          {s.limitationNotice}
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>

            <h3 className="mt-10 text-sm font-semibold text-ink">Coming soon</h3>
            <ul className="mt-3 flex flex-wrap gap-2">
              {COMING_SOON.map((c) => (
                <li key={c.key}>
                  <span className="inline-flex cursor-not-allowed items-center rounded-md border border-dashed border-line bg-ground px-3 py-1.5 text-xs text-ink-subtle">
                    {c.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Trust */}
        <section className="border-b border-line">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <h2 className="text-2xl font-semibold tracking-tight text-ink">
              What we do and do not touch
            </h2>
            <div className="mt-8 grid gap-5 md:grid-cols-2">
              <Card>
                <CardContent className="pt-6">
                  <h3 className="text-sm font-semibold text-ink">Metadata only, read only</h3>
                  <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-muted">
                    <li>We request the narrowest read-only scope each provider offers.</li>
                    <li>We never request a write, delete or content-download permission.</li>
                    <li>We measure counts, byte sizes, file categories and timestamps — nothing else.</li>
                    <li>Your data is never sent to a language model.</li>
                  </ul>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <h3 className="text-sm font-semibold text-ink">Your control</h3>
                  <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-muted">
                    <li>Disconnect any source at any time, in one click.</li>
                    <li>
                      Disconnecting revokes the credential where the provider supports it and deletes
                      the stored tokens, cursors and measurements.
                    </li>
                    <li>Delete your account and every associated record whenever you want.</li>
                    <li>Nothing is sold or shared without a separate signed agreement.</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 bg-surface">
          <div className="mx-auto max-w-3xl px-5 py-16">
            <h2 className="text-2xl font-semibold tracking-tight text-ink">
              Frequently asked questions
            </h2>
            <dl className="mt-8 divide-y divide-line border-y border-line">
              {FAQ.map((item) => (
                <div key={item.q} className="py-6">
                  <dt className="text-sm font-semibold text-ink">{item.q}</dt>
                  <dd className="mt-2 text-sm leading-relaxed text-ink-muted">{item.a}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-10 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/signup">{brand.primaryCta}</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/demo">View demo</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
