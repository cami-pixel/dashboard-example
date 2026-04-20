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

export async function deskFetch<T>(
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

  return res.json() as Promise<T>;
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

let cachedViewIds: Map<string, string> | null = null;

async function getViewIdByName(name: string): Promise<string> {
  if (cachedViewIds?.has(name)) return cachedViewIds.get(name)!;

  const data = await deskFetch<{
    data?: Array<{ id: string; name: string }>;
  }>("/views", { module: "tickets" });

  cachedViewIds = new Map((data.data ?? []).map((v) => [v.name, v.id]));
  const id = cachedViewIds.get(name);
  if (!id) {
    throw new Error(`Zoho Desk view not found: "${name}"`);
  }
  return id;
}

export interface ClosedTicket {
  id: string;
  status: string;
  becameCustomerDate: string | null;
}

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

export async function getClosedOnboardingTickets(): Promise<ClosedTicket[]> {
  const viewId = await getViewIdByName("Closed Onboarding");
  const tickets: ClosedTicket[] = [];
  let from = 0;
  const limit = 100;

  while (true) {
    const data = await deskFetch<{ data?: Array<Record<string, unknown>> }>(
      "/tickets",
      {
        viewId,
        from: String(from),
        limit: String(limit),
        fields: "cf_became_a_customer_date",
      },
    );

    const batch = data.data ?? [];
    if (batch.length === 0) break;

    for (const t of batch) {
      tickets.push({
        id: String(t.id),
        status: String(t.status ?? "Unknown"),
        becameCustomerDate: extractBecameCustomerDate(t),
      });
    }

    if (batch.length < limit) break;
    from += limit;
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
