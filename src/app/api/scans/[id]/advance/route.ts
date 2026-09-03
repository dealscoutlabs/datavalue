import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertOrgAccess, AuthorizationError, requireUserStrict } from "@/lib/org";
import { advanceScan } from "@/lib/scan/runner";
import { safeErrorMessage, log } from "@/lib/logging";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().cuid() });

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUserStrict();
    const { id } = paramsSchema.parse(await ctx.params);

    const job = await prisma.scanJob.findUnique({ where: { id }, select: { organizationId: true } });
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Ownership is verified against the job's organisation, never a client-supplied id.
    await assertOrgAccess(user.id, job.organizationId);

    const result = await advanceScan(id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
    log("scan.advance_error", { reason: safeErrorMessage(err) });
    return NextResponse.json({ error: "Scan could not be advanced" }, { status: 500 });
  }
}
