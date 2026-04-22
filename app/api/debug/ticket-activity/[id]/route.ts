import type { NextRequest } from "next/server";
import { debugTicketActivity } from "@/lib/zoho";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  try {
    const data = await debugTicketActivity(id);
    return Response.json(data);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
