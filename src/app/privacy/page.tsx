import { LegalPage } from "@/components/marketing/legal-page";
import { brand } from "@/config/brand";

export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      intro="Placeholder privacy description. It states accurately what the application does today, which is the starting point counsel needs — it is not a compliant privacy notice."
      sections={[
        {
          heading: "What we collect from you",
          body: [
            "Your name, email address and password hash. Your company name, website, industry and employee range. Your questionnaire answers. If you request a verified review, the contact details you submit on that form.",
          ],
        },
        {
          heading: "What we collect from your connected sources",
          body: [
            "Metadata only: byte sizes, file and record counts, file extensions and MIME categories, timestamps, and aggregate statistics such as field completeness percentages.",
            "We do not collect, retain, display or transmit the contents of any file, email, chat message, attachment or customer record. The scan calls no download or content endpoint, and we do not request the permissions that would allow it.",
            "Your connected data is never sent to a language model.",
          ],
        },
        {
          heading: "OAuth credentials",
          body: [
            "Access and refresh tokens are encrypted at rest using AES-256-GCM with a key held only on the server. They are never returned to your browser, never stored in browser storage, and are redacted from logs and error reports.",
          ],
        },
        {
          heading: "Deletion",
          body: [
            "Disconnecting a source revokes the credential at the provider where the provider supports it, and deletes the stored tokens, scan checkpoints, measurements and any computed rate for that source.",
            "Deleting your account removes your user record, your organisation, and every connection, measurement, assessment and lead associated with it.",
          ],
        },
        {
          heading: "What we do not claim",
          body: [
            `${brand.name} holds no compliance certification. We do not claim SOC 2, HIPAA or GDPR compliance, and we do not claim that any regulator or legal adviser has reviewed this service.`,
          ],
        },
      ]}
    />
  );
}
