/**
 * Organisation authorization and admin protection.
 *
 * The rule under test: no server action or route handler may act on an
 * organizationId or connectionId supplied by the client without proving the
 * signed-in user is a member of the owning organisation first.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  memberships: [] as { userId: string; organizationId: string; role: string }[],
  connections: [] as { id: string; organizationId: string }[],
  user: null as { id: string; isPlatformAdmin: boolean } | null,
};

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: async () => (state.user ? { user: { id: state.user.id } } : null),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        state.user && state.user.id === where.id
          ? { id: state.user.id, isPlatformAdmin: state.user.isPlatformAdmin, email: "u@x.com" }
          : null
      ),
    },
    organizationMember: {
      findUnique: vi.fn(async ({ where }: { where: { userId_organizationId: { userId: string; organizationId: string } } }) => {
        const { userId, organizationId } = where.userId_organizationId;
        return state.memberships.find((m) => m.userId === userId && m.organizationId === organizationId) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: { where: { userId: string } }) => {
        const m = state.memberships.find((x) => x.userId === where.userId);
        return m ? { ...m, organization: { id: m.organizationId, name: "Org" } } : null;
      }),
    },
    providerConnection: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        state.connections.find((c) => c.id === where.id) ?? null
      ),
    },
  },
}));

import {
  assertOrgAccess,
  AuthorizationError,
  requireConnection,
  requireOrganization,
  requirePlatformAdmin,
  requireUserStrict,
} from "@/lib/org";

beforeEach(() => {
  state.memberships = [{ userId: "owner", organizationId: "org-a", role: "OWNER" }];
  state.connections = [
    { id: "conn-a", organizationId: "org-a" },
    { id: "conn-b", organizationId: "org-b" },
  ];
  state.user = { id: "owner", isPlatformAdmin: false };
});

describe("organisation authorization", () => {
  it("allows a member into their own organisation", async () => {
    await expect(assertOrgAccess("owner", "org-a")).resolves.toBeTruthy();
  });

  it("refuses a user who is not a member", async () => {
    await expect(assertOrgAccess("outsider", "org-a")).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("refuses a member of one organisation acting on another", async () => {
    await expect(assertOrgAccess("owner", "org-b")).rejects.toThrow(/Not a member/);
  });

  it("enforces a required role", async () => {
    await expect(assertOrgAccess("owner", "org-a", ["OWNER"])).resolves.toBeTruthy();
    await expect(assertOrgAccess("owner", "org-a", ["ADMIN"])).rejects.toThrow(/Insufficient role/);
  });

  it("refuses a connection id belonging to someone else's organisation", async () => {
    await expect(requireConnection("owner", "conn-a")).resolves.toBeTruthy();
    await expect(requireConnection("owner", "conn-b")).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("refuses a connection id that does not exist", async () => {
    await expect(requireConnection("owner", "nope")).rejects.toThrow(/not found/i);
  });

  it("refuses an unauthenticated caller", async () => {
    state.user = null;
    await expect(requireUserStrict()).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("sends a user with no organisation to onboarding", async () => {
    state.memberships = [];
    await expect(requireOrganization("owner")).rejects.toThrow("REDIRECT:/onboarding");
  });
});

describe("admin protection", () => {
  it("redirects a non-admin away from admin surfaces", async () => {
    await expect(requirePlatformAdmin()).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("allows a platform admin", async () => {
    state.user = { id: "owner", isPlatformAdmin: true };
    await expect(requirePlatformAdmin()).resolves.toMatchObject({ isPlatformAdmin: true });
  });

  it("redirects a signed-out visitor to sign in", async () => {
    state.user = null;
    await expect(requirePlatformAdmin()).rejects.toThrow("REDIRECT:/signin");
  });
});
