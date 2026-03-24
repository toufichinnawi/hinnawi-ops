/**
 * Microsoft Graph API Client
 * Handles authentication and email operations for accounting@bagelandcafe.com
 */

import { ENV } from "./_core/env";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const MAILBOX_USER = "accounting@bagelandcafe.com";

// ─── Token Management ───

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 5 min buffer)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cachedToken.token;
  }

  const tokenUrl = `https://login.microsoftonline.com/${ENV.azureTenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: ENV.azureClientId,
    client_secret: ENV.azureClientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to get Azure AD token: ${response.status} ${err}`);
  }

  const data = await response.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.token;
}

// ─── Graph API Helper ───

async function graphRequest(path: string, options?: RequestInit) {
  const token = await getAccessToken();
  const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Graph API error: ${response.status} ${err}`);
  }

  // Some endpoints return no content (204)
  if (response.status === 204) return null;

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  // Return raw buffer for file downloads
  return response.arrayBuffer();
}

// ─── Email Types ───

export interface GraphEmail {
  id: string;
  subject: string;
  from: {
    emailAddress: {
      name: string;
      address: string;
    };
  };
  receivedDateTime: string;
  hasAttachments: boolean;
  isRead: boolean;
  bodyPreview: string;
  body?: {
    contentType: string;
    content: string;
  };
  importance: string;
  categories: string[];
}

export interface GraphAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  contentBytes?: string; // Base64 encoded
}

export interface EmailListResult {
  emails: GraphEmail[];
  totalCount: number;
  nextLink?: string;
}

// ─── Email Operations ───

/**
 * List emails from the accounting mailbox with filtering and pagination
 */
export async function listEmails(options?: {
  top?: number;
  skip?: number;
  filter?: string;
  search?: string;
  orderBy?: string;
  select?: string[];
  folder?: string;
}): Promise<EmailListResult> {
  const {
    top = 25,
    skip = 0,
    filter,
    search,
    orderBy = "receivedDateTime desc",
    select = ["id", "subject", "from", "receivedDateTime", "hasAttachments", "isRead", "bodyPreview", "importance", "categories"],
    folder,
  } = options || {};

  const params = new URLSearchParams();
  params.set("$top", String(top));
  params.set("$skip", String(skip));
  params.set("$orderby", orderBy);
  params.set("$select", select.join(","));
  params.set("$count", "true");

  if (filter) params.set("$filter", filter);
  if (search) params.set("$search", `"${search}"`);

  const folderPath = folder ? `/mailFolders/${folder}` : "";
  const path = `/users/${MAILBOX_USER}${folderPath}/messages?${params.toString()}`;

  const data = await graphRequest(path, {
    headers: { ConsistencyLevel: "eventual" },
  });

  return {
    emails: data.value || [],
    totalCount: data["@odata.count"] || data.value?.length || 0,
    nextLink: data["@odata.nextLink"],
  };
}

/**
 * Get a single email with full body
 */
export async function getEmail(messageId: string): Promise<GraphEmail> {
  const path = `/users/${MAILBOX_USER}/messages/${messageId}`;
  return graphRequest(path);
}

/**
 * List attachments for a specific email
 */
export async function listAttachments(messageId: string): Promise<GraphAttachment[]> {
  const path = `/users/${MAILBOX_USER}/messages/${messageId}/attachments`;
  const data = await graphRequest(path);
  return data.value || [];
}

/**
 * Get a specific attachment with content bytes
 */
export async function getAttachment(messageId: string, attachmentId: string): Promise<GraphAttachment> {
  const path = `/users/${MAILBOX_USER}/messages/${messageId}/attachments/${attachmentId}`;
  return graphRequest(path);
}

/**
 * Download attachment content as a Buffer
 */
export async function downloadAttachment(messageId: string, attachmentId: string): Promise<{ buffer: Buffer; name: string; contentType: string }> {
  const attachment = await getAttachment(messageId, attachmentId);
  if (!attachment.contentBytes) {
    throw new Error("Attachment has no content bytes");
  }

  return {
    buffer: Buffer.from(attachment.contentBytes, "base64"),
    name: attachment.name,
    contentType: attachment.contentType,
  };
}

/**
 * List emails that have attachments (likely invoices/bills)
 */
export async function listEmailsWithAttachments(options?: {
  top?: number;
  skip?: number;
  search?: string;
  folder?: string;
}): Promise<EmailListResult> {
  return listEmails({
    ...options,
    filter: "hasAttachments eq true",
  });
}

/**
 * Search emails by sender domain (e.g., find all emails from a specific supplier)
 */
export async function searchEmailsBySender(senderEmail: string, options?: {
  top?: number;
  skip?: number;
}): Promise<EmailListResult> {
  return listEmails({
    ...options,
    filter: `from/emailAddress/address eq '${senderEmail}'`,
  });
}

/**
 * Mark an email as read
 */
export async function markAsRead(messageId: string): Promise<void> {
  await graphRequest(`/users/${MAILBOX_USER}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ isRead: true }),
  });
}

/**
 * Add a category to an email (for tagging as "Processed", "Invoice", etc.)
 */
export async function addCategory(messageId: string, category: string): Promise<void> {
  const email = await getEmail(messageId);
  const categories = [...(email.categories || []), category];
  await graphRequest(`/users/${MAILBOX_USER}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ categories }),
  });
}

/**
 * Move an email to a specific folder
 */
export async function moveEmail(messageId: string, destinationFolderId: string): Promise<void> {
  await graphRequest(`/users/${MAILBOX_USER}/messages/${messageId}/move`, {
    method: "POST",
    body: JSON.stringify({ destinationId: destinationFolderId }),
  });
}

/**
 * List mail folders (Inbox, Sent, Archive, etc.)
 */
export async function listMailFolders(): Promise<Array<{ id: string; displayName: string; totalItemCount: number; unreadItemCount: number }>> {
  const data = await graphRequest(`/users/${MAILBOX_USER}/mailFolders?$top=50`);
  return data.value || [];
}

/**
 * Create a mail folder (e.g., "Processed Invoices")
 */
export async function createMailFolder(displayName: string): Promise<{ id: string; displayName: string }> {
  return graphRequest(`/users/${MAILBOX_USER}/mailFolders`, {
    method: "POST",
    body: JSON.stringify({ displayName }),
  });
}

/**
 * Get or create a folder by name
 */
export async function getOrCreateFolder(folderName: string): Promise<{ id: string; displayName: string }> {
  const folders = await listMailFolders();
  const existing = folders.find(f => f.displayName === folderName);
  if (existing) return existing;
  return createMailFolder(folderName);
}
