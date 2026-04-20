import { NextResponse } from "next/server";
import { deskFetch } from "@/lib/zoho";

export const dynamic = "force-dynamic";

export async function GET() {
  const report: Record<string, unknown> = {};

  try {
    const viewsData = await deskFetch<{
      data?: Array<{ id: string; name: string }>;
    }>("/views", { module: "tickets" });
    const allViews = (viewsData.data ?? []).map((v) => ({
      id: v.id,
      name: v.name,
    }));
    report.viewsCount = allViews.length;
    report.viewsContainingClosed = allViews.filter((v) =>
      v.name.toLowerCase().includes("closed"),
    );

    const closedView = allViews.find((v) => v.name === "Closed Onboarding");
    report.closedOnboardingView = closedView ?? null;

    if (closedView) {
      const listWithFields = await deskFetch<{
        data?: Array<Record<string, unknown>>;
      }>("/tickets", {
        viewId: closedView.id,
        from: "0",
        limit: "2",
        fields: "cf_became_a_customer_date",
      });
      report.listWithFieldsSample = listWithFields.data?.[0] ?? null;

      const firstId = listWithFields.data?.[0]?.id;
      if (firstId) {
        const single = await deskFetch<Record<string, unknown>>(
          `/tickets/${firstId}`,
          { include: "customFields" },
        );
        report.singleTicketKeys = Object.keys(single);
        report.singleTicketCf = single.cf ?? null;
        report.singleTicketCustomFields = single.customFields ?? null;
      }
    }
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json(report, { status: 200 });
}
