/**
 * Lead notification.
 *
 * Exactly one destination is ever contacted: brand.contact.internalLeadEmail.
 * No address supplied by a user is ever emailed by this application, and the
 * message body contains no provider payload and no credential.
 */
import nodemailer from "nodemailer";
import { brand } from "@/config/brand";
import { log, safeErrorMessage } from "@/lib/logging";

export type NotifyResult = { sent: boolean; error?: string };

function transport() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASSWORD
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
  });
}

export async function notifyLead(args: {
  offerRequestId: string;
  companyName: string;
  contactName: string;
  businessEmail: string;
  eligibilityStatus: string;
  sourceCount: number;
}): Promise<NotifyResult> {
  const to = brand.contact.internalLeadEmail;
  const mailer = transport();

  if (!mailer) {
    // No SMTP configured. The lead is already persisted and visible in the admin
    // area; log a safe notice rather than silently dropping it.
    log("lead.notification_skipped", {
      offerRequestId: args.offerRequestId,
      reason: "SMTP not configured",
      destination: to,
    });
    return { sent: false, error: "SMTP is not configured on this deployment." };
  }

  const lines = [
    `New verified-review request for ${brand.name}.`,
    "",
    `Company:      ${args.companyName}`,
    `Contact:      ${args.contactName} <${args.businessEmail}>`,
    `Eligibility:  ${args.eligibilityStatus}`,
    `Sources:      ${args.sourceCount}`,
    `Reference:    ${args.offerRequestId}`,
    "",
    "Full details, including the questionnaire snapshot, are in the admin area.",
    "This message contains no provider data and no credentials.",
  ];

  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM ?? `${brand.name} <no-reply@example.com>`,
      to,
      subject: `[${brand.name}] Verified review request — ${args.companyName}`,
      text: lines.join("\n"),
    });
    log("lead.notified", { offerRequestId: args.offerRequestId });
    return { sent: true };
  } catch (err) {
    const error = safeErrorMessage(err);
    log("lead.notification_failed", { offerRequestId: args.offerRequestId, reason: error });
    return { sent: false, error };
  }
}
