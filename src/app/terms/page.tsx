import { LegalPage } from "@/components/marketing/legal-page";
import { brand } from "@/config/brand";

export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      intro={`Placeholder terms describing how ${brand.name} currently operates. Counsel must replace this before production.`}
      sections={[
        {
          heading: "What this service does",
          body: [
            `${brand.name} measures the volume and broad type of data held in the cloud services you connect, and screens that data against a set of rights and sensitivity questions. It produces an inventory and an eligibility assessment.`,
            "It does not appraise your data, does not determine whether you hold the rights to license it, and does not make an offer to buy or license anything.",
          ],
        },
        {
          heading: "Connecting an account is not a sale",
          body: [
            brand.legal.connectionDisclosure,
            "Authorizing a data source grants read-only, metadata-only access for measurement. It creates no licence, no option, no right of first refusal and no obligation on either side.",
          ],
        },
        {
          heading: "Indicative rates",
          body: [
            brand.legal.rateDisclosure,
            "Where a rate range is shown, it is a per-unit reference figure for one source. Rates are never summed into a portfolio total, and no rate is shown for a source that has not passed the eligibility screening.",
          ],
        },
        {
          heading: "Your responsibilities",
          body: [
            "You confirm that you are authorised to connect the accounts you connect, and that doing so does not breach an agreement you are party to.",
            "You are responsible for the accuracy of your questionnaire answers. The assessment is only as good as what you tell it.",
          ],
        },
        {
          heading: "No warranty",
          body: [
            "The service is provided as is. Measurements depend on what each provider's API exposes, and every figure is labelled with how it was obtained and how confident we are in it.",
          ],
        },
      ]}
    />
  );
}
