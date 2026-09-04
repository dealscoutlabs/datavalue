/**
 * OAuth handshake plumbing shared by every connector.
 *
 * Threat model handled here:
 *  - CSRF on the callback: a single-use, random `state` is minted server-side and
 *    stored with the initiating user and organisation. The callback refuses any
 *    state it did not mint, any state that has expired, and any state whose user
 *    is not the one currently signed in.
 *  - Account linking: because the state row carries userId AND organizationId,
 *    an attacker cannot get their provider account attached to someone else's
 *    organisation by replaying a callback URL.
 *  - Authorization code interception: PKCE (S256) wherever the provider supports it.
 *  - Replay: the state row is deleted the moment it is consumed.
 */
import { prisma } from "@/lib/prisma";
import { createPkcePair, randomToken } from "@/lib/crypto";
import type { ProviderKey } from "@/generated/prisma";

const STATE_TTL_MS = 10 * 60 * 1000;

/** Providers that support PKCE on their authorization-code flow. */
const PKCE_PROVIDERS: ReadonlySet<ProviderKey> = new Set<ProviderKey>([
  "DROPBOX",
  "MICROSOFT",
  "GOOGLE",
  "GOOGLE_ADMIN",
]);

export function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.AUTH_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function redirectUriFor(provider: ProviderKey): string {
  return `${appUrl()}/api/connect/${provider.toLowerCase()}/callback`;
}

export async function mintState(args: {
  provider: ProviderKey;
  userId: string;
  organizationId: string;
  redirectTo?: string;
}) {
  const state = randomToken(32);
  const usesPkce = PKCE_PROVIDERS.has(args.provider);
  const pkce = usesPkce ? createPkcePair() : null;

  await prisma.oAuthState.create({
    data: {
      state,
      codeVerifier: pkce?.verifier ?? null,
      provider: args.provider,
      userId: args.userId,
      organizationId: args.organizationId,
      redirectTo: args.redirectTo ?? null,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  });

  return { state, codeChallenge: pkce?.challenge };
}

export class OAuthStateError extends Error {}

/** Single-use consumption. Throws on anything that does not match exactly. */
export async function consumeState(args: {
  state: string | null;
  provider: ProviderKey;
  userId: string;
}) {
  if (!args.state) throw new OAuthStateError("Missing state");

  const row = await prisma.oAuthState.findUnique({ where: { state: args.state } });
  if (!row) throw new OAuthStateError("Unrecognised state");

  // Consume first, so a replay of the same callback cannot succeed even if the
  // checks below throw.
  await prisma.oAuthState.delete({ where: { id: row.id } }).catch(() => {});

  if (row.expiresAt < new Date()) throw new OAuthStateError("State expired");
  if (row.provider !== args.provider) throw new OAuthStateError("Provider mismatch");
  if (row.userId !== args.userId) throw new OAuthStateError("State belongs to another session");

  return row;
}

/** Housekeeping — expired states are dead weight and a small privacy liability. */
export async function purgeExpiredStates() {
  await prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

export function parseProviderParam(raw: string): ProviderKey | null {
  const key = raw.toUpperCase();
  const allowed: ProviderKey[] = [
    "DROPBOX",
    "HUBSPOT",
    "MICROSOFT",
    "GOOGLE",
    "GOOGLE_ADMIN",
    "SLACK",
  ];
  return allowed.includes(key as ProviderKey) ? (key as ProviderKey) : null;
}
