import type { NextRequest } from "next/server";

import { ApiError, apiFetch } from "@/lib/api";

export async function GET(_req: NextRequest, ctx: RouteContext<"/admin/campaigns/[id]/export">) {
  const { id } = await ctx.params;
  try {
    const res = await apiFetch(`/api/campaigns/${encodeURIComponent(id)}/export.csv`);
    return new Response(await res.text(), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": res.headers.get("content-disposition") ?? `attachment; filename="${id}.csv"`,
      },
    });
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return new Response("Export failed", { status });
  }
}
