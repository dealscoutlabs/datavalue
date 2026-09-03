import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/org";
import { getAdapter } from "@/lib/connectors/registry";
import { consumeState, OAuthStateError, parseProviderParam, redirectUriFor, appUrl } from "@/lib/connectors/oauth";
import { encryptOptional } from "@/lib/crypto";
import { startScan } from "@/lib/scan/runner";
import { log, safeErrorMessage } from "@/lib/logging";

export const dynamic = "force-dynamic";

/**
 * Provider redirect target.
 *
 * The plaintext access and refresh tokens exist only inside this handler. They
 * are encrypted before they touch the database and are never written to a
 * response body, a redirect URL, a cookie or a log line.
 */
export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: rawProvider } = await ctx.params;
  const provider = parseProviderParam(rawProvider);
  const url = new URL(req.url);

  if (!provider) return redirectWithError("unknown_provider");

  // The user denying consent is a normal outcome, not an error state.
  const providerError = url.searchParams.get("error");
  if (providerError) {
    log("oauth.denied", { provider, error: providerError });
    return redirectWithError(
      providerError === "access_denied" ? "denied" : "provider_error",
      provider
    );
  }

  try {
    const user = await getSessionUser();
    if (!user) return redirectWithError("signed_out", provider);

    const stateRow = await consumeState({
      state: url.searchParams.get("state"),
      provider,
      userId: user.id,
    });

    const code = url.searchParams.get("code");
    if (!code) return redirectWithError("missing_code", provider);

    const adapter = getAdapter(provider);
    const tokens = await adapter.exchangeCode({
      code,
      codeVerifier: stateRow.codeVerifier ?? undefined,
      redirectUri: redirectUriFor(provider),
    });

    const existing = await prisma.providerConnection.findFirst({
      where: { organizationId: stateRow.organizationId, provider, isDemo: false },
    });

    const data = {
      status: "CONNECTED" as const,
      accountLabel: tokens.accountLabel,
      accountDomain: tokens.accountDomain,
      externalId: tokens.externalId,
      accessTokenEnc: encryptOptional(tokens.accessToken),
      refreshTokenEnc: encryptOptional(tokens.refreshToken),
      accessTokenExpiresAt: tokens.expiresAt,
      grantedScopes: tokens.scopes,
      scanPath: tokens.scanPath ?? null,
      connectedAt: new Date(),
      disconnectedAt: null,
      lastError: null,
    };

    const connection = existing
      ? await prisma.providerConnection.update({ where: { id: existing.id }, data })
      : await prisma.providerConnection.create({
          data: { organizationId: stateRow.organizationId, provider, isDemo: false, ...data },
        });

    await prisma.auditEvent.create({
      data: {
        organizationId: stateRow.organizationId,
        userId: user.id,
        action: "connection.authorized",
        // Scopes are recorded because they determine what was measurable. No
        // token, code or verifier is recorded.
        detail: { provider, scanPath: tokens.scanPath ?? null, scopes: tokens.scopes },
      },
    });

    await startScan(connection.id);
    return NextResponse.redirect(`${appUrl()}/dashboard?connected=${provider.toLowerCase()}`);
  } catch (err) {
    if (err instanceof OAuthStateError) {
      log("oauth.state_rejected", { provider, reason: err.message });
      return redirectWithError("invalid_state", provider);
    }
    log("oauth.callback_error", { provider, reason: safeErrorMessage(err) });
    return redirectWithError("exchange_failed", provider);
  }
}

function redirectWithError(code: string, provider?: string) {
  const params = new URLSearchParams({ error: code });
  if (provider) params.set("provider", provider.toLowerCase());
  return NextResponse.redirect(`${appUrl()}/sources?${params.toString()}`);
}
