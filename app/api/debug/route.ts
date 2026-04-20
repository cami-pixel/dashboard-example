import { NextResponse } from "next/server";
import { deskFetch } from "@/lib/zoho";

export const dynamic = "force-dynamic";

const STATUSES = [
  "Closed - Won (LIVE) Marketplace",
  "Closed - Won (LIVE) CM Complete (Approved and Uploaded to RoverPass)",
  "Closed - Won (LIVE) Website",
  "Closed - Won (LIVE) CRS",
  "Closed - Won (LIVE) Premium Listing",
  "Closed Won",
  "Closed - Lost",
];

async function tryCall(
  label: string,
  path: string,
  params: Record<string, string>,
) {
  try {
    const data = await deskFetch<{ data?: unknown[]; count?: number }>(
      path,
      params,
    );
    return {
      label,
      ok: true,
      count: Array.isArray(data.data) ? data.data.length : 0,
      countField: data.count,
      sample: Array.isArray(data.data) ? data.data[0] : null,
    };
  } catch (e) {
    return {
      label,
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 300) : String(e),
    };
  }
}

export async function GET() {
  const attempts: unknown[] = [];

  attempts.push(
    await tryCall("views_tickets_lower", "/views", { module: "tickets" }),
  );
  attempts.push(
    await tryCall("views_tickets_cap", "/views", { module: "Tickets" }),
  );
  attempts.push(
    await tryCall("search_one_status", "/tickets/search", {
      status: STATUSES[0],
      limit: "2",
    }),
  );
  attempts.push(
    await tryCall("search_closed_won", "/tickets/search", {
      status: "Closed Won",
      limit: "2",
    }),
  );

  return NextResponse.json({ attempts }, { status: 200 });
}
