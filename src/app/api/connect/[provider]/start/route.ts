import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserStrict, requireOrganization, AuthorizationError } from "@/lib/org";
import { getAdapter } from "@/lib/connectors/registry";
import { mintState, parseProviderParam, purgeExpiredStates, redirectUriFor } from "@/lib/connectors/oauth";
import { log, safeErrorMessage } from "@/lib/logging";

export const dynamic = "force-dynamic";

/**
 * Begins a provider authorization. Reached only from the permission-explanation
 * screen, never linked directly, so nobody arrives at a provider consent page
 * without first being told exactly what will and will not be inspected.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ provider: string }> }) {
  try {
    const user = await requireUserStrict();
    const { provider: raw } = await ctx.params;
    const provider = parseProviderParam(raw);
    if (!provider) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

    const { organization } = await requireOrganization(user.id);

    // A demo organisation must never reach a provider consent screen.
    if (organization.isDemo) {
      return NextResponse.json(
        { error: "Demo organisations cannot connect live provider accounts." },
        { status: 400 }
      );
    }

    const adapter = getAdapter(provider);
    if (!adapter.isConfigured()) {
      return NextResponse.json(
        { error: `${adapter.label} is not configured on this deployment. See README setup.` },
        { status: 400 }
      );
    }

    await purgeExpiredStates();
    const { state, codeChallenge } = await mintState({
      provider,
      userId: user.id,
      organizationId: organization.id,
    });

    await prisma.auditEvent.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        action: "connection.authorization_started",
        detail: { provider },
      },
    });

    const url = adapter.getAuthorizationUrl({
      state,
      codeChallenge,
      redirectUri: redirectUriFor(provider),
    });
    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
    log("oauth.start_error", { reason: safeErrorMessage(err) });
    return NextResponse.json({ error: "Could not start authorization" }, { status: 500 });
  }
}
