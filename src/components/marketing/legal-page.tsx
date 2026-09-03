import { SiteFooter, SiteHeader } from "@/components/marketing/chrome";
import { Notice } from "@/components/ui/notice";
import { brand } from "@/config/brand";

/**
 * Shared shell for the legal placeholder pages. Each one carries a visible
 * "requires legal review before production" notice at the top, not the bottom.
 */
export function LegalPage({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: string;
  sections: { heading: string; body: string[] }[];
}) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <div className="mx-auto max-w-3xl px-5 py-14">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">{title}</h1>
          <Notice tone="caution" className="mt-5" title="Placeholder — not legal text">
            {brand.legal.placeholderNotice} It describes how the product currently behaves so that
            counsel has something concrete to work from. It is not a contract, not a privacy notice
            that meets any statutory requirement, and must not be relied on.
          </Notice>
          <p className="mt-6 text-base leading-relaxed text-ink-muted">{intro}</p>

          {sections.map((s) => (
            <section key={s.heading} className="mt-8">
              <h2 className="text-lg font-semibold tracking-tight text-ink">{s.heading}</h2>
              {s.body.map((p, i) => (
                <p key={i} className="mt-3 text-sm leading-relaxed text-ink-muted">
                  {p}
                </p>
              ))}
            </section>
          ))}

          <p className="mt-10 border-t border-line pt-6 text-sm text-ink-muted">
            Questions: {brand.contact.publicEmail}
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
