import { LegalPage } from "@/components/marketing/legal-page";

export const metadata = { title: "Data processing & security" };

export default function SecurityPage() {
  return (
    <LegalPage
      title="Data processing & security"
      intro="A plain description of the controls that exist in this application today. It is deliberately specific, and deliberately does not claim anything that has not been built."
      sections={[
        {
          heading: "Least privilege",
          body: [
            "Each connector requests the narrowest read-only scope its provider offers for the measurement it performs. No connector requests a write, delete or content-download scope. Where a permission would enable something we do not need, we do not ask for it — the Slack connector, for example, deliberately does not request message history access.",
          ],
        },
        {
          heading: "Credentials at rest",
          body: [
            "OAuth access and refresh tokens are encrypted with AES-256-GCM, an authenticated cipher, using a 32-byte key held in server environment configuration. Each record uses a fresh random IV and stores its authentication tag, so tampering is detected on decryption.",
          ],
        },
        {
          heading: "Authorization flow",
          body: [
            "Every authorization uses a single-use, server-minted state value bound to the initiating user and organisation, and PKCE with S256 wherever the provider supports it. A callback whose state we did not mint, that has expired, that names a different provider, or that belongs to a different signed-in user is rejected outright.",
          ],
        },
        {
          heading: "Application authorization",
          body: [
            "Application sign-in is entirely separate from data-source authorization; the two share no credential store. Every server action and API route verifies organisation membership before touching organisation data, and admin functions check the platform-admin flag server side rather than relying on a hidden navigation link.",
          ],
        },
        {
          heading: "Logging",
          body: [
            "Tokens, authorization codes, PKCE verifiers, state values and provider response payloads are redacted before anything is logged or written to the audit trail. Provider error bodies are reduced to a status and a short generic reason, because they frequently echo request parameters.",
          ],
        },
        {
          heading: "What we do not claim",
          body: [
            "No certification, audit or attestation exists for this service. There is no SOC 2 report, no HIPAA assessment and no legal sign-off. This page describes engineering controls, not compliance status.",
          ],
        },
      ]}
    />
  );
}
