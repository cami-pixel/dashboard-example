"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ClosedTicket, Ticket } from "@/lib/zoho";

const LIVE_STATUS_ORDER = [
  "Closed - Won (LIVE) Marketplace",
  "Closed - Won (LIVE) CM Complete (Approved and Uploaded to RoverPass)",
  "Closed - Won (LIVE) Website",
  "Closed - Won (LIVE) CRS",
  "Closed - Won (LIVE) Premium Listing",
  "Closed - Lost",
] as const;

const LIVE_STATUS_LABELS: Record<string, string> = {
  "Closed - Won (LIVE) Marketplace": "Marketplace",
  "Closed - Won (LIVE) CM Complete (Approved and Uploaded to RoverPass)":
    "CM Complete",
  "Closed - Won (LIVE) Website": "Website",
  "Closed - Won (LIVE) CRS": "CRS",
  "Closed - Won (LIVE) Premium Listing": "Premium Listing",
  "Closed - Lost": "Closed - Lost",
};

const LIVE_STATUS_COLORS: Record<string, string> = {
  "Closed - Won (LIVE) Marketplace": "#10b981",
  "Closed - Won (LIVE) CM Complete (Approved and Uploaded to RoverPass)":
    "#3b82f6",
  "Closed - Won (LIVE) Website": "#a855f7",
  "Closed - Won (LIVE) CRS": "#f59e0b",
  "Closed - Won (LIVE) Premium Listing": "#ec4899",
  "Closed - Lost": "#ef4444",
};

function LiveListingsChart({
  closedTickets,
}: {
  closedTickets: ClosedTicket[];
}) {
  const [hovered, setHovered] = useState<{
    monthKey: string;
    status: string;
  } | null>(null);
  const [liveFilter, setLiveFilter] = useState<{
    status: string;
    monthKey: string | null;
  } | null>(null);

  const now = new Date();
  const months: { key: string; label: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("en-US", {
      month: "short",
      year: "2-digit",
    });
    months.push({ key, label });
  }
  const monthKeys = new Set(months.map((m) => m.key));

  const ticketsByBucket: Record<string, Record<string, ClosedTicket[]>> = {};
  for (const m of months) ticketsByBucket[m.key] = {};
  const totalsByStatus: Record<string, number> = {};
  const ticketsByStatus: Record<string, ClosedTicket[]> = {};
  let totalInRange = 0;

  for (const t of closedTickets) {
    if (!t.becameCustomerDate) continue;
    const d = new Date(t.becameCustomerDate);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!monthKeys.has(key)) continue;
    (ticketsByBucket[key][t.status] ??= []).push(t);
    (ticketsByStatus[t.status] ??= []).push(t);
    totalsByStatus[t.status] = (totalsByStatus[t.status] ?? 0) + 1;
    totalInRange++;
  }

  const maxMonthTotal = Math.max(
    1,
    ...months.map((m) =>
      Object.values(ticketsByBucket[m.key]).reduce(
        (sum, arr) => sum + arr.length,
        0,
      ),
    ),
  );

  const statusesInLegend = LIVE_STATUS_ORDER.filter(
    (s) => (totalsByStatus[s] ?? 0) > 0,
  );

  const filteredTickets: ClosedTicket[] = liveFilter
    ? liveFilter.monthKey
      ? (ticketsByBucket[liveFilter.monthKey]?.[liveFilter.status] ?? [])
      : (ticketsByStatus[liveFilter.status] ?? [])
    : [];
  const filteredTicketsSorted = [...filteredTickets].sort((a, b) => {
    const ad = a.becameCustomerDate
      ? new Date(a.becameCustomerDate).getTime()
      : 0;
    const bd = b.becameCustomerDate
      ? new Date(b.becameCustomerDate).getTime()
      : 0;
    return bd - ad;
  });
  const filterMonthLabel = liveFilter?.monthKey
    ? months.find((m) => m.key === liveFilter.monthKey)?.label
    : null;

  return (
    <div className="mb-10">
      <div className="mb-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          Live Listings
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {totalInRange} ticket{totalInRange === 1 ? "" : "s"} closed in the
          last 12 months
        </p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {LIVE_STATUS_ORDER.map((s) => {
          const count = totalsByStatus[s] ?? 0;
          const isSelected =
            liveFilter?.status === s && liveFilter.monthKey === null;
          return (
            <button
              key={s}
              type="button"
              disabled={count === 0}
              onClick={() =>
                setLiveFilter(
                  isSelected ? null : { status: s, monthKey: null },
                )
              }
              className={`rounded-xl border p-3 text-left shadow-sm transition ${
                isSelected
                  ? "border-[#FF4D3E] bg-[#FF4D3E]"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-slate-200 disabled:hover:shadow-sm"
              } ${count > 0 ? "cursor-pointer" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: LIVE_STATUS_COLORS[s] }}
                />
                <div
                  className={`truncate text-xs font-medium ${
                    isSelected ? "text-white/90" : "text-slate-600"
                  }`}
                >
                  {LIVE_STATUS_LABELS[s]}
                </div>
              </div>
              <div
                className={`mt-1 text-2xl font-bold ${
                  isSelected ? "text-white" : "text-slate-900"
                }`}
              >
                {count}
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex h-64 items-stretch gap-2">
          {months.map((m, mIdx) => {
            const monthData = ticketsByBucket[m.key];
            const monthTotal = Object.values(monthData).reduce(
              (sum, arr) => sum + arr.length,
              0,
            );
            const heightPct = (monthTotal / maxMonthTotal) * 100;
            const isHoveredMonth = hovered?.monthKey === m.key;
            const hoveredTickets =
              isHoveredMonth && hovered
                ? (monthData[hovered.status] ?? [])
                : [];
            const tooltipAlign =
              mIdx < 2
                ? "left-0"
                : mIdx > months.length - 3
                  ? "right-0"
                  : "left-1/2 -translate-x-1/2";
            return (
              <div
                key={m.key}
                className="relative flex h-full flex-1 flex-col items-center"
              >
                {isHoveredMonth && hovered && hoveredTickets.length > 0 && (
                  <div
                    className={`pointer-events-none absolute bottom-full z-20 mb-2 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg ${tooltipAlign}`}
                  >
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{
                          backgroundColor: LIVE_STATUS_COLORS[hovered.status],
                        }}
                      />
                      <span>
                        {LIVE_STATUS_LABELS[hovered.status]} —{" "}
                        {hoveredTickets.length}
                      </span>
                    </div>
                    <div className="mt-2 space-y-0.5 text-xs text-slate-700">
                      {hoveredTickets.slice(0, 10).map((t) => (
                        <div key={t.id} className="truncate">
                          {t.name}
                        </div>
                      ))}
                      {hoveredTickets.length > 10 && (
                        <div className="text-slate-400">
                          +{hoveredTickets.length - 10} more
                        </div>
                      )}
                    </div>
                    <div className="mt-2 border-t border-slate-100 pt-1 text-[10px] text-slate-400">
                      Click to view details
                    </div>
                  </div>
                )}
                <div className="relative flex w-full flex-1 items-end">
                  <div
                    className="flex w-full flex-col-reverse overflow-hidden rounded-t"
                    style={{ height: `${heightPct}%` }}
                  >
                    {LIVE_STATUS_ORDER.map((s) => {
                      const count = (monthData[s] ?? []).length;
                      if (count === 0 || monthTotal === 0) return null;
                      const segPct = (count / monthTotal) * 100;
                      const isSelected =
                        liveFilter?.status === s &&
                        liveFilter.monthKey === m.key;
                      return (
                        <div
                          key={s}
                          className={`cursor-pointer transition-opacity hover:opacity-80 ${
                            isSelected ? "ring-2 ring-[#FF4D3E]" : ""
                          }`}
                          style={{
                            backgroundColor: LIVE_STATUS_COLORS[s],
                            height: `${segPct}%`,
                          }}
                          onMouseEnter={() =>
                            setHovered({ monthKey: m.key, status: s })
                          }
                          onMouseLeave={() => setHovered(null)}
                          onClick={() =>
                            setLiveFilter(
                              isSelected
                                ? null
                                : { status: s, monthKey: m.key },
                            )
                          }
                        />
                      );
                    })}
                  </div>
                </div>
                <div className="mt-2 text-[10px] font-semibold tabular-nums text-slate-600">
                  {monthTotal}
                </div>
                <div className="text-xs text-slate-500">{m.label}</div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-100 pt-4">
          {statusesInLegend.length === 0 ? (
            <span className="text-xs text-slate-400">
              No tickets with a &ldquo;Became a Customer Date&rdquo; in the last
              12 months.
            </span>
          ) : (
            statusesInLegend.map((s) => (
              <div
                key={s}
                className="flex items-center gap-2 text-xs text-slate-600"
              >
                <span
                  className="inline-block h-3 w-3 rounded"
                  style={{ backgroundColor: LIVE_STATUS_COLORS[s] }}
                />
                <span>{LIVE_STATUS_LABELS[s]}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {liveFilter && (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: LIVE_STATUS_COLORS[liveFilter.status],
                  }}
                />
                <h2 className="text-lg font-bold text-slate-900">
                  {LIVE_STATUS_LABELS[liveFilter.status]}
                  {filterMonthLabel ? ` · ${filterMonthLabel}` : ""}
                </h2>
              </div>
              <p className="mt-0.5 text-sm text-slate-500">
                {filteredTicketsSorted.length} ticket
                {filteredTicketsSorted.length === 1 ? "" : "s"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setLiveFilter(null)}
              className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
            >
              Clear ✕
            </button>
          </div>
          {filteredTicketsSorted.length === 0 ? (
            <div className="px-6 py-10 text-center text-slate-500">
              No tickets in this bucket.
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
                      Customer
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Contact
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Became Customer
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTicketsSorted.map((t) => (
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
                      </td>
                      <td className="px-6 py-4 align-top text-sm text-slate-700">
                        {t.name}
                      </td>
                      <td className="px-6 py-4 align-top text-sm text-slate-700">
                        {t.contactName}
                      </td>
                      <td className="px-6 py-4 align-top text-sm text-slate-700">
                        {t.contactEmail ?? "—"}
                      </td>
                      <td className="px-6 py-4 align-top text-sm text-slate-700">
                        {t.becameCustomerDate
                          ? new Date(t.becameCustomerDate).toLocaleDateString()
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(dateStr: string): {
  text: string;
  className: string;
} {
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
      ? "bg-red-50 text-red-700"
      : diffDays >= 3
        ? "bg-amber-50 text-amber-700"
        : "bg-emerald-50 text-emerald-700";

  return { text, className };
}

export default function DashboardView({
  tickets,
  closedTickets,
  closedError,
}: {
  tickets: Ticket[];
  closedTickets: ClosedTicket[];
  closedError: string | null;
}) {
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

      {closedError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <div className="font-semibold">Failed to load Live Listings data</div>
          <div className="mt-1 break-all font-mono text-xs">{closedError}</div>
        </div>
      )}
      <LiveListingsChart closedTickets={closedTickets} />

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
              className={`cursor-pointer rounded-xl border p-5 text-left shadow-sm transition ${
                isSelected
                  ? "border-[#FF4D3E] bg-[#FF4D3E] shadow-md"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-md"
              }`}
            >
              <div
                className={`mb-2 text-sm font-medium ${
                  isSelected ? "text-white/90" : "text-slate-600"
                }`}
              >
                {status}
              </div>
              <div className="flex items-baseline gap-2">
                <div
                  className={`text-3xl font-bold ${
                    isSelected ? "text-white" : "text-slate-900"
                  }`}
                >
                  {count}
                </div>
                <div
                  className={`text-xs ${
                    isSelected ? "text-white/70" : "text-slate-400"
                  }`}
                >
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
                    const lastActivity = formatRelativeTime(t.lastActivityTime);
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
                        <td className="px-6 py-4 align-top">
                          <span
                            className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${lastActivity.className}`}
                          >
                            {lastActivity.text}
                          </span>
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
