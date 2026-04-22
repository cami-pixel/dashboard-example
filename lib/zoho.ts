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

  const maxAttempts = 4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        orgId,
      },
    });

    const isRetriable = res.status === 429 || res.status >= 500;
    if (isRetriable && attempt < maxAttempts - 1) {
      const retryHeader = Number(res.headers.get("Retry-After"));
      const delayMs =
        (Number.isFinite(retryHeader) && retryHeader > 0
          ? retryHeader
          : 2 ** attempt) * 1000;
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    if (!res.ok) {
      throw new Error(`Zoho Desk API ${res.status}: ${await res.text()}`);
    }

    if (res.status === 204) return {} as T;
    const text = await res.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  throw new Error(`Zoho Desk API exhausted ${maxAttempts} attempts: ${url}`);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface PinnedComment {
  id: string;
  content: string;
  commentedTime: string;
  pinnedTime: string;
  commenterName: string | null;
}

export interface Ticket {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string;
  contactName: string;
  contactEmail: string | null;
  ownerName: string | null;
  createdTime: string;
  lastActivityTime: string;
  webUrl: string | null;
  pinnedComments: PinnedComment[];
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
  assignee?: {
    firstName?: string;
    lastName?: string;
    name?: string;
    email?: string;
  } | null;
  ownerName?: string;
}

async function fetchAllActivityPages(
  ticketId: string,
  resource: "threads" | "comments",
): Promise<Array<Record<string, unknown>>> {
  const all: Array<Record<string, unknown>> = [];
  let from = 0;
  const pageSize = 50;
  const safetyCap = 2000;

  while (from < safetyCap) {
    const data = await deskFetch<{
      data?: Array<Record<string, unknown>>;
    }>(`/tickets/${ticketId}/${resource}`, {
      limit: String(pageSize),
      from: String(from),
    });

    const items = data.data ?? [];
    if (items.length === 0) break;
    all.push(...items);
    from += items.length;
  }

  return all;
}

const ACTIVITY_TIME_FIELDS: Record<"threads" | "comments", readonly string[]> =
  {
    threads: ["createdTime"],
    comments: ["commentedTime", "modifiedTime", "createdTime"],
  };

function extractLatestMs(
  items: Array<Record<string, unknown>>,
  fieldNames: readonly string[],
): number {
  let latestMs = 0;
  for (const item of items) {
    for (const f of fieldNames) {
      const v = item[f];
      if (typeof v !== "string") continue;
      const ms = new Date(v).getTime();
      if (Number.isFinite(ms) && ms > latestMs) latestMs = ms;
      break;
    }
  }
  return latestMs;
}

async function fetchLatestCreatedTime(
  ticketId: string,
  resource: "threads" | "comments",
): Promise<number> {
  try {
    const items = await fetchAllActivityPages(ticketId, resource);
    return extractLatestMs(items, ACTIVITY_TIME_FIELDS[resource]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `[activity:error] ticket=${ticketId} resource=${resource} ${msg}`,
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

async function fetchPins(
  ticketId: string,
): Promise<Array<Record<string, unknown>>> {
  try {
    const data = await deskFetch<{ data?: Array<Record<string, unknown>> }>(
      `/tickets/${ticketId}/pins`,
    );
    return data.data ?? [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/\b404\b/.test(msg)) return [];
    console.error(`[pins:error] ticket=${ticketId} ${msg}`);
    return [];
  }
}

function resolvePinnedComments(
  pins: Array<Record<string, unknown>>,
): PinnedComment[] {
  const resolved: PinnedComment[] = [];
  for (const pin of pins) {
    const type = String(pin.type ?? pin.entityType ?? "").toLowerCase();
    if (type && !type.startsWith("comment")) continue;

    const entity = pin.entityPinned as
      | Record<string, unknown>
      | null
      | undefined;
    if (!entity) continue;

    const commentId = typeof entity.id === "string" ? entity.id : "";
    if (!commentId) continue;

    const commenter = entity.commenter as
      | { name?: unknown }
      | null
      | undefined;

    resolved.push({
      id: commentId,
      content: typeof entity.content === "string" ? entity.content : "",
      commentedTime:
        typeof entity.commentedTime === "string"
          ? entity.commentedTime
          : typeof entity.modifiedTime === "string"
            ? entity.modifiedTime
            : typeof entity.createdTime === "string"
              ? entity.createdTime
              : "",
      pinnedTime:
        typeof pin.pinnedTime === "string" ? pin.pinnedTime : "",
      commenterName:
        commenter && typeof commenter.name === "string"
          ? commenter.name
          : null,
    });
  }

  resolved.sort(
    (a, b) =>
      new Date(b.pinnedTime).getTime() - new Date(a.pinnedTime).getTime(),
  );
  return resolved;
}

async function getTicketActivityAndPins(ticketId: string): Promise<{
  latestActivityTime: string | null;
  pinnedComments: PinnedComment[];
}> {
  const [threads, comments, pins] = await Promise.all([
    fetchAllActivityPages(ticketId, "threads").catch((e) => {
      console.error(
        `[activity:error] ticket=${ticketId} resource=threads ${e instanceof Error ? e.message : String(e)}`,
      );
      return [] as Array<Record<string, unknown>>;
    }),
    fetchAllActivityPages(ticketId, "comments").catch((e) => {
      console.error(
        `[activity:error] ticket=${ticketId} resource=comments ${e instanceof Error ? e.message : String(e)}`,
      );
      return [] as Array<Record<string, unknown>>;
    }),
    fetchPins(ticketId),
  ]);

  const threadsMs = extractLatestMs(threads, ACTIVITY_TIME_FIELDS.threads);
  const commentsMs = extractLatestMs(comments, ACTIVITY_TIME_FIELDS.comments);
  const latestMs = Math.max(threadsMs, commentsMs);

  return {
    latestActivityTime:
      latestMs > 0 ? new Date(latestMs).toISOString() : null,
    pinnedComments: resolvePinnedComments(pins),
  };
}

export async function debugTicketActivity(ticketId: string): Promise<{
  ticketId: string;
  threads: {
    count: number;
    latest: string | null;
    items: Array<Record<string, unknown>>;
    error?: string;
  };
  comments: {
    count: number;
    latest: string | null;
    items: Array<Record<string, unknown>>;
    error?: string;
  };
  pins: {
    count: number;
    raw: Array<Record<string, unknown>>;
    error?: string;
  };
  pinnedComments: PinnedComment[];
  resolved: string | null;
}> {
  const pull = async (resource: "threads" | "comments") => {
    try {
      const items = await fetchAllActivityPages(ticketId, resource);
      const latestMs = extractLatestMs(items, ACTIVITY_TIME_FIELDS[resource]);
      return {
        count: items.length,
        latest: latestMs > 0 ? new Date(latestMs).toISOString() : null,
        items,
      };
    } catch (e) {
      return {
        count: 0,
        latest: null,
        items: [] as Array<Record<string, unknown>>,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  };

  const pullPins = async () => {
    try {
      const data = await deskFetch<{ data?: Array<Record<string, unknown>> }>(
        `/tickets/${ticketId}/pins`,
      );
      const raw = data.data ?? [];
      return { count: raw.length, raw };
    } catch (e) {
      return {
        count: 0,
        raw: [] as Array<Record<string, unknown>>,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  };

  const [threads, comments, pins] = await Promise.all([
    pull("threads"),
    pull("comments"),
    pullPins(),
  ]);

  const threadsMs = threads.latest ? new Date(threads.latest).getTime() : 0;
  const commentsMs = comments.latest ? new Date(comments.latest).getTime() : 0;
  const latestMs = Math.max(threadsMs, commentsMs);

  return {
    ticketId,
    threads,
    comments,
    pins,
    pinnedComments: resolvePinnedComments(pins.raw),
    resolved: latestMs > 0 ? new Date(latestMs).toISOString() : null,
  };
}

export interface ClosedTicket {
  id: string;
  ticketNumber: string;
  status: string;
  name: string;
  becameCustomerDate: string | null;
  createdTime: string | null;
  webUrl: string | null;
  contactName: string;
  contactEmail: string | null;
  ownerName: string | null;
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

function extractOwnerName(raw: Record<string, unknown>): string | null {
  const assignee = raw.assignee as
    | {
        firstName?: string;
        lastName?: string;
        name?: string;
        email?: string;
      }
    | null
    | undefined;
  if (assignee) {
    const combined = `${assignee.firstName ?? ""} ${assignee.lastName ?? ""}`.trim();
    if (combined) return combined;
    if (assignee.name) return assignee.name;
    if (assignee.email) return assignee.email;
  }
  const ownerName = raw.ownerName;
  if (typeof ownerName === "string" && ownerName.trim()) return ownerName;
  return null;
}

function toClosedTicket(t: Record<string, unknown>): ClosedTicket {
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
  return {
    id: String(t.id),
    ticketNumber: String(t.ticketNumber ?? ""),
    status: String(t.status ?? ""),
    name,
    becameCustomerDate: extractBecameCustomerDate(t),
    createdTime: typeof t.createdTime === "string" ? t.createdTime : null,
    webUrl: typeof t.webUrl === "string" ? t.webUrl : null,
    contactName,
    contactEmail: contact?.email ?? null,
    ownerName: extractOwnerName(t),
  };
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
      if (String(t.status ?? "") !== status) continue;
      tickets.push(toClosedTicket(t));
    }

    if (batch.length < limit) break;
    from += limit;
  }

  return tickets;
}

export async function getClosedOnboardingTickets(): Promise<ClosedTicket[]> {
  const viewId = process.env.ZOHO_CLOSED_VIEW_ID;
  if (viewId) {
    return getClosedOnboardingTicketsFromView(viewId);
  }

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

async function getClosedOnboardingTicketsFromView(
  viewId: string,
): Promise<ClosedTicket[]> {
  const allowed = new Set(CLOSED_ONBOARDING_STATUSES);
  const tickets: ClosedTicket[] = [];
  const seen = new Set<string>();
  let from = 0;
  const limit = 100;

  while (true) {
    const data = await deskFetch<{ data?: Array<Record<string, unknown>> }>(
      "/tickets",
      {
        viewId,
        from: String(from),
        limit: String(limit),
        include: "contacts,assignee",
        fields: "cf_became_a_customer_date",
      },
    );

    const batch = data.data ?? [];
    if (batch.length === 0) break;

    for (const t of batch) {
      const status = String(t.status ?? "");
      if (!allowed.has(status)) continue;
      const id = String(t.id);
      if (seen.has(id)) continue;
      seen.add(id);
      tickets.push(toClosedTicket(t));
    }

    if (batch.length < limit) break;
    from += limit;
  }

  return tickets;
}

export async function listTicketViews(): Promise<{
  working: string | null;
  attempts: Array<{ path: string; ok: boolean; status?: number; note: string }>;
  views: Array<{ id: string; name: string; category: string | null }>;
}> {
  const candidates: Array<{ path: string; params: Record<string, string> }> = [
    { path: "/tickets/views", params: { category: "shared" } },
    { path: "/tickets/views", params: { category: "personal" } },
    { path: "/tickets/views", params: { category: "all" } },
    { path: "/tickets/views", params: { viewType: "custom" } },
    { path: "/tickets/views", params: {} },
  ];

  const attempts: Array<{
    path: string;
    ok: boolean;
    status?: number;
    note: string;
  }> = [];

  const token = await getAccessToken();
  const orgId = getOrgId();

  for (const c of candidates) {
    const url = new URL(`${DESK_URL}/api/v1${c.path}`);
    for (const [k, v] of Object.entries(c.params)) {
      url.searchParams.set(k, v);
    }
    const displayPath = `${c.path}${
      Object.keys(c.params).length
        ? "?" +
          Object.entries(c.params)
            .map(([k, v]) => `${k}=${v}`)
            .join("&")
        : ""
    }`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        orgId,
      },
    });
    if (!res.ok) {
      attempts.push({
        path: displayPath,
        ok: false,
        status: res.status,
        note: `failed (${res.status})`,
      });
      continue;
    }
    const text = await res.text();
    let parsed: { data?: Array<Record<string, unknown>> } = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      attempts.push({
        path: displayPath,
        ok: false,
        status: res.status,
        note: "non-JSON response",
      });
      continue;
    }
    const batch = parsed.data ?? [];
    attempts.push({
      path: displayPath,
      ok: true,
      status: res.status,
      note: `returned ${batch.length} items`,
    });
    const views = batch.map((v) => ({
      id: String(v.id ?? ""),
      name: String(v.name ?? ""),
      category:
        typeof v.category === "string"
          ? v.category
          : typeof v.categoryName === "string"
            ? v.categoryName
            : null,
    }));
    return { working: displayPath, attempts, views };
  }

  return { working: null, attempts, views: [] };
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
      include: "contacts,assignee",
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
        ownerName: extractOwnerName(t as unknown as Record<string, unknown>),
        createdTime: t.createdTime,
        lastActivityTime: t.modifiedTime ?? t.createdTime,
        webUrl: t.webUrl ?? null,
        pinnedComments: [],
      });
    }

    if (batch.length < limit) break;
    from += limit;
  }

  await mapWithConcurrency(tickets, 5, async (ticket) => {
    const { latestActivityTime, pinnedComments } =
      await getTicketActivityAndPins(ticket.id);
    if (latestActivityTime) {
      const currentMs = new Date(ticket.lastActivityTime).getTime();
      const activityMs = new Date(latestActivityTime).getTime();
      if (activityMs > currentMs) {
        ticket.lastActivityTime = latestActivityTime;
      }
    }
    ticket.pinnedComments = pinnedComments;
  });

  return tickets;
}
