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
  modifiedTime: string;
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
        modifiedTime: t.modifiedTime ?? t.createdTime,
        webUrl: t.webUrl ?? null,
      });
    }

    if (batch.length < limit) break;
    from += limit;
  }

  return tickets;
}
