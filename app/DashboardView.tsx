"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Ticket } from "@/lib/zoho";

function formatRelativeTime(dateStr: string): { text: string; className: string } {
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  let text: string;
  if (diffMinutes < 1) text = "just now";
  else if (diffMinutes < 60) text = `${diffMinutes}m ago`;
  else if (diffHours < 24) text = `${diffHours}h ago`;
  else if (diffDays < 30) text = `${diffDays}d ago`;
  else text = date.toLocaleDateString();

  const className =
    diffDays >= 7
      ? "font-medium text-red-600"
      : diffDays >= 3
        ? "font-medium text-amber-600"
        : "text-slate-700";

  return { text, className };
}

export default function DashboardView({ tickets }: { tickets: Ticket[] }) {
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const counts: Record<string, number> = {};
  for (const t of tickets) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }

  const sortedStatuses = Object.entries(counts).sort(([, a], [, b]) => b - a);
  const filteredTickets = selectedStatus
    ? tickets.filter((t) => t.status === selectedStatus)
    : [];

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#FF4D3E] text-xl font-bold text-white shadow-sm">
            R
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">RoverPass</h1>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
              Onboarding Dashboard
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            <span>Live · Updated just now</span>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isPending}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            {isPending ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <div className="mb-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          Ticket Statuses
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {tickets.length} tickets across {sortedStatuses.length} statuses
          {selectedStatus && (
            <>
              {" · filtering: "}
              <span className="font-medium text-[#FF4D3E]">
                {selectedStatus}
              </span>
            </>
          )}
        </p>
      </div>

      <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sortedStatuses.map(([status, count]) => {
          const isSelected = selectedStatus === status;
          return (
            <button
              key={status}
              type="button"
              onClick={() => setSelectedStatus(isSelected ? null : status)}
              className={`cursor-pointer rounded-xl border p-5 text-left transition ${
                isSelected
                  ? "border-[#FF4D3E] bg-white shadow-md ring-2 ring-[#FF4D3E]/20"
                  : "border-slate-200 bg-white shadow-sm hover:border-slate-300 hover:shadow-md"
              }`}
            >
              <div className="mb-2 text-sm font-medium text-slate-600">
                {status}
              </div>
              <div className="flex items-baseline gap-2">
                <div className="text-3xl font-bold text-slate-900">{count}</div>
                <div className="text-xs text-slate-400">
                  {((count / tickets.length) * 100).toFixed(0)}%
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {selectedStatus && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {selectedStatus}
              </h2>
              <p className="text-sm text-slate-500">
                {filteredTickets.length} ticket
                {filteredTickets.length === 1 ? "" : "s"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedStatus(null)}
              className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
            >
              Clear ✕
            </button>
          </div>

          {filteredTickets.length === 0 ? (
            <div className="px-6 py-10 text-center text-slate-500">
              No tickets in this status.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Ticket
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Contact
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Created
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Last Activity
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTickets.map((t) => {
                    const lastActivity = formatRelativeTime(t.modifiedTime);
                    return (
                      <tr key={t.id} className="hover:bg-slate-50">
                        <td className="px-6 py-4 align-top">
                          {t.webUrl ? (
                            <a
                              href={t.webUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold text-[#FF4D3E] hover:underline"
                            >
                              #{t.ticketNumber}
                            </a>
                          ) : (
                            <span className="font-semibold text-slate-900">
                              #{t.ticketNumber}
                            </span>
                          )}
                          <div className="mt-1 text-sm text-slate-700">
                            {t.subject}
                          </div>
                        </td>
                        <td className="px-6 py-4 align-top text-sm text-slate-700">
                          {t.contactName}
                        </td>
                        <td className="px-6 py-4 align-top text-sm text-slate-700">
                          {t.contactEmail ?? "—"}
                        </td>
                        <td className="px-6 py-4 align-top text-sm text-slate-700">
                          {new Date(t.createdTime).toLocaleDateString()}
                        </td>
                        <td
                          className={`px-6 py-4 align-top text-sm ${lastActivity.className}`}
                        >
                          {lastActivity.text}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
