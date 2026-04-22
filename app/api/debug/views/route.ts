import { listTicketViews } from "@/lib/zoho";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const views = await listTicketViews();
    return Response.json(views);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
