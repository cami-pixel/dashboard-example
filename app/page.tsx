import type { ClosedTicket } from "@/lib/zoho";
import { getClosedOnboardingTickets, getTicketsByView } from "@/lib/zoho";
import DashboardView from "./DashboardView";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const viewId = process.env.ZOHO_VIEW_ID;

  if (!viewId) {
    return (
      <main className="min-h-screen bg-slate-50 p-8">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-3xl font-bold text-red-700">
            Configuration error
          </h1>
          <p className="mt-2 text-gray-700">
            Missing <code>ZOHO_VIEW_ID</code> in environment variables.
          </p>
        </div>
      </main>
    );
  }

  try {
    const tickets = await getTicketsByView(viewId);
    let closedTickets: ClosedTicket[] = [];
    try {
      closedTickets = await getClosedOnboardingTickets();
    } catch (err) {
      console.error("Failed to load Closed Onboarding tickets:", err);
    }
    return (
      <main className="min-h-screen bg-slate-50 p-8">
        <DashboardView tickets={tickets} closedTickets={closedTickets} />
      </main>
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return (
      <main className="min-h-screen bg-slate-50 p-8">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
            <div className="font-semibold">Error loading data</div>
            <div className="mt-1 text-sm">{message}</div>
          </div>
        </div>
      </main>
    );
  }
}
