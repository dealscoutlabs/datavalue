import { SiteFooter, SiteHeader } from "@/components/marketing/chrome";
import { Card, CardContent } from "@/components/ui/card";
import { brand } from "@/config/brand";

export const metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <div className="mx-auto max-w-2xl px-5 py-14">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Contact</h1>
          <p className="mt-3 text-base leading-relaxed text-ink-muted">
            Placeholder contact details. Replace them in{" "}
            <code className="font-mono text-sm">src/config/brand.ts</code>.
          </p>
          <Card className="mt-6">
            <CardContent className="pt-6">
              <dl className="space-y-4 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-subtle">Company</dt>
                  <dd className="mt-1 text-ink">{brand.buyer.companyName}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-subtle">Email</dt>
                  <dd className="mt-1 text-ink">{brand.contact.publicEmail}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-subtle">Address</dt>
                  <dd className="mt-1 text-ink">
                    {brand.contact.addressLines.map((l) => (
                      <span key={l} className="block">
                        {l}
                      </span>
                    ))}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
