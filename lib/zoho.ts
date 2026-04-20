const ACCOUNTS_URL = "https://accounts.zoho.com";
const DESK_URL = "https://desk.zoho.com";

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN } =
    process.env;
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
    throw new Error(
      "Missing Zoho env vars. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN in .env.local",
    );
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    refresh_token: ZOHO_REFRESH_TOKEN,
  });

  const res = await fetch(`${ACCOUNTS_URL}/oauth/v2/token`, {
    method: "POST",
    body,
  });

  if (!res.ok) {
    throw new Error(
      `Zoho token refresh failed: ${res.status} ${await res.text()}`,
    );
  }

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };

  if (!data.access_token || !data.expires_in) {
    throw new Error(`Zoho token response missing fields: ${JSON.stringify(data)}`);
  }

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

function getOrgId(): string {
  const orgId = process.env.ZOHO_ORG_ID;
  if (!orgId) {
    throw new Error("Missing ZOHO_ORG_ID in .env.local");
  }
  return orgId;
}

async function deskFetch<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const token = await getAccessToken();
  const orgId = getOrgId();

  const url = new URL(`${DESK_URL}/api/v1${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      orgId,
    },
  });

  if (!res.ok) {
    throw new Error(`Zoho Desk API ${res.status}: ${await res.text()}`);
  }

  if (res.status === 204) return {} as T;
  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export interface Ticket {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string;
  contactName: string;
  contactEmail: string | null;
  createdTime: string;
  lastActivityTime: string;
  webUrl: string | null;
}

interface RawTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string;
  createdTime: string;
  modifiedTime: string;
  webUrl?: string;
  contact?: {
    firstName?: string;
    lastName?: string;
    email?: string;
  };
}

async function fetchLatestCreatedTime(
  ticketId: string,
  resource: "threads" | "comments",
): Promise<number> {
  try {
    let latestMs = 0;
    let from = 0;
    const pageSize = 50;
    const safetyCap = 2000;

    while (from < safetyCap) {
      const data = await deskFetch<{
        data?: Array<{ createdTime?: string }>;
      }>(`/tickets/${ticketId}/${resource}`, {
        limit: String(pageSize),
        from: String(from),
      });

      const items = data.data ?? [];
      if (items.length === 0) break;

      for (const item of items) {
        if (item.createdTime) {
          const ms = new Date(item.createdTime).getTime();
          if (ms > latestMs) latestMs = ms;
        }
      }

      from += items.length;
    }

    return latestMs;
  } catch (e) {
    console.error(
      `Failed to fetch ${resource} for ticket ${ticketId}:`,
      e instanceof Error ? e.message : e,
    );
    return 0;
  }
}

async function getLatestActivityTime(
  ticketId: string,
): Promise<string | null> {
  const [threadsMs, commentsMs] = await Promise.all([
    fetchLatestCreatedTime(ticketId, "threads"),
    fetchLatestCreatedTime(ticketId, "comments"),
  ]);
  const latestMs = Math.max(threadsMs, commentsMs);
  return latestMs > 0 ? new Date(latestMs).toISOString() : null;
}

export interface ClosedTicket {
  id: string;
  ticketNumber: string;
  status: string;
  name: string;
  becameCustomerDate: string | null;
  webUrl: string | null;
  contactName: string;
  contactEmail: string | null;
}

const CLOSED_ONBOARDING_STATUSES = [
  "Closed - Won (LIVE) Marketplace",
  "Closed - Won (LIVE) CM Complete (Approved and Uploaded to RoverPass)",
  "Closed - Won (LIVE) Website",
  "Closed - Won (LIVE) CRS",
  "Closed - Won (LIVE) Premium Listing",
  "Closed - Lost",
];

function extractBecameCustomerDate(
  raw: Record<string, unknown>,
): string | null {
  const direct = raw["cf_became_a_customer_date"];
  if (direct) return String(direct);

  const cf = raw.cf as Record<string, unknown> | undefined;
  if (cf?.cf_became_a_customer_date) {
    return String(cf.cf_became_a_customer_date);
  }

  const customFields = raw.customFields as Record<string, unknown> | undefined;
  if (customFields) {
    for (const [k, v] of Object.entries(customFields)) {
      if (!v) continue;
      const normalized = k.toLowerCase().replace(/[^a-z]/g, "");
      if (normalized === "becameacustomerdate") return String(v);
    }
  }

  return null;
}

async function searchClosedTicketsByStatus(
  status: string,
): Promise<ClosedTicket[]> {
  const tickets: ClosedTicket[] = [];
  let from = 0;
  const limit = 100;

  while (true) {
    const data = await deskFetch<{ data?: Array<Record<string, unknown>> }>(
      "/tickets/search",
      {
        status,
        from: String(from),
        limit: String(limit),
      },
    );

    const batch = data.data ?? [];
    if (batch.length === 0) break;

    for (const t of batch) {
      const ticketStatus = String(t.status ?? "");
      if (ticketStatus !== status) continue;
      const rawSubject = String(t.subject ?? "").trim();
      const name =
        rawSubject.replace(/^[A-Z]{1,3}\s*OB\s*[-–:]\s*/i, "").trim() ||
        rawSubject ||
        `#${t.ticketNumber ?? t.id}`;
      const contact = t.contact as
        | { firstName?: string; lastName?: string; email?: string }
        | undefined;
      const contactName =
        `${contact?.firstName ?? ""} ${contact?.lastName ?? ""}`.trim() || "—";
      tickets.push({
        id: String(t.id),
        ticketNumber: String(t.ticketNumber ?? ""),
        status: ticketStatus,
        name,
        becameCustomerDate: extractBecameCustomerDate(t),
        webUrl: typeof t.webUrl === "string" ? t.webUrl : null,
        contactName,
        contactEmail: contact?.email ?? null,
      });
    }

    if (batch.length < limit) break;
    from += limit;
  }

  return tickets;
}

export async function getClosedOnboardingTickets(): Promise<ClosedTicket[]> {
  const seen = new Set<string>();
  const tickets: ClosedTicket[] = [];
  for (const status of CLOSED_ONBOARDING_STATUSES) {
    const batch = await searchClosedTicketsByStatus(status);
    for (const t of batch) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      tickets.push(t);
    }
  }
  return tickets;
}

export async function getTicketsByView(viewId: string): Promise<Ticket[]> {
  const tickets: Ticket[] = [];
  let from = 0;
  const limit = 100;

  while (true) {
    const data = await deskFetch<{ data?: RawTicket[] }>("/tickets", {
      viewId,
      from: String(from),
      limit: String(limit),
      include: "contacts",
    });

    const batch = data.data ?? [];
    if (batch.length === 0) break;

    for (const t of batch) {
      const name = `${t.contact?.firstName ?? ""} ${t.contact?.lastName ?? ""}`.trim();
      tickets.push({
        id: t.id,
        ticketNumber: t.ticketNumber,
        subject: t.subject,
        status: t.status || "Unknown",
        contactName: name || "—",
        contactEmail: t.contact?.email ?? null,
        createdTime: t.createdTime,
        lastActivityTime: t.modifiedTime ?? t.createdTime,
        webUrl: t.webUrl ?? null,
      });
    }

    if (batch.length < limit) break;
    from += limit;
  }

  await Promise.all(
    tickets.map(async (ticket) => {
      const activityTime = await getLatestActivityTime(ticket.id);
      if (!activityTime) return;
      const currentMs = new Date(ticket.lastActivityTime).getTime();
      const activityMs = new Date(activityTime).getTime();
      if (activityMs > currentMs) {
        ticket.lastActivityTime = activityTime;
      }
    }),
  );

  return tickets;
}
