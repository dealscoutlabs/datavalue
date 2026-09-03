/**
 * Organisation authorization.
 *
 * Every server action and route handler that touches organisation data goes
 * through one of these. There is no path that trusts an organizationId supplied
 * by the client without checking membership first.
 */
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { OrgRole } from "@/generated/prisma";

export class AuthorizationError extends Error {
  constructor(message = "Not authorized") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export async function getSessionUser() {
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) return null;
  return prisma.user.findUnique({ where: { id } });
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  return user;
}

/** Throws rather than redirecting — for route handlers and server actions. */
export async function requireUserStrict() {
  const user = await getSessionUser();
  if (!user) throw new AuthorizationError("Sign in required");
  return user;
}

export async function requirePlatformAdmin() {
  const user = await requireUser();
  if (!user.isPlatformAdmin) redirect("/dashboard");
  return user;
}

/** The caller's active organisation. Users belong to exactly one in this MVP. */
export async function requireOrganization(userId: string) {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) redirect("/onboarding");
  return { organization: membership.organization, role: membership.role };
}

export async function assertOrgAccess(
  userId: string,
  organizationId: string,
  roles?: OrgRole[]
) {
  const membership = await prisma.organizationMember.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });
  if (!membership) throw new AuthorizationError("Not a member of this organization");
  if (roles && !roles.includes(membership.role)) {
    throw new AuthorizationError("Insufficient role");
  }
  return membership;
}

/** Resolve a connection and prove the caller owns it in one step. */
export async function requireConnection(userId: string, connectionId: string) {
  const connection = await prisma.providerConnection.findUnique({
    where: { id: connectionId },
  });
  if (!connection) throw new AuthorizationError("Connection not found");
  await assertOrgAccess(userId, connection.organizationId);
  return connection;
}
