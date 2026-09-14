import type {
  AccountInput,
  ConnectionTestResponse,
  MailAccount,
  MailboxInfo,
  MessageSummary,
  ParsedMail,
  PublicUser,
  SessionResponse,
} from "./types";

// 单端口部署时留空，使用相对路径 /api/v1；
// 拆分部署（前端托管在 Vercel / Cloudflare Pages）时，
// 在构建期通过 VITE_API_BASE 注入后端地址，需包含 /api/v1 前缀，
// 例如 https://api.yourdomain.com/api/v1
const BASE = import.meta.env.VITE_API_BASE || "/api/v1";
let csrf = localStorage.getItem("hpm_csrf") || "";

export function setCsrf(token: string) {
  csrf = token;
  localStorage.setItem("hpm_csrf", token);
}

async function req<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (["POST", "PATCH", "PUT", "DELETE"].includes(method))
    headers["x-csrf-token"] = csrf;
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `请求失败 (${res.status})`);
  return data as T;
}

export const api = {
  health: () => req("GET", "/health"),
  session: () => req<SessionResponse>("GET", "/session"),
  authConfig: () => req("GET", "/auth/config"),
  login: (username: string, password: string) =>
    req<SessionResponse>("POST", "/auth/login", { username, password }),
  logout: () => req("POST", "/auth/logout"),

  listAccounts: () => req<MailAccount[]>("GET", "/accounts"),
  createAccount: (input: AccountInput) => req<MailAccount>("POST", "/accounts", input),
  updateAccount: (id: string, input: AccountInput) =>
    req<MailAccount>("PATCH", `/accounts/${id}`, input),
  deleteAccount: (id: string) => req("DELETE", `/accounts/${id}`),
  testDraft: (input: AccountInput) =>
    req<ConnectionTestResponse>("POST", "/accounts/test", input),
  testSaved: (id: string) => req<ConnectionTestResponse>("POST", `/accounts/${id}/test`),

  mailboxes: (id: string) => req<MailboxInfo[]>("GET", `/accounts/${id}/mailboxes`),
  messages: (id: string, mailbox: string, limit = 50) =>
    req<{ total: number; messages: MessageSummary[] }>(
      "GET",
      `/accounts/${id}/messages?mailbox=${encodeURIComponent(mailbox)}&limit=${limit}`,
    ),
  message: (id: string, uid: string, mailbox: string) =>
    req<ParsedMail>(
      "GET",
      `/accounts/${id}/messages/${uid}?mailbox=${encodeURIComponent(mailbox)}`,
    ),
  markRead: (id: string, uid: string, mailbox: string) =>
    req("POST", `/accounts/${id}/messages/${uid}/read?mailbox=${encodeURIComponent(mailbox)}`),
  deleteMessage: (id: string, uid: string, mailbox: string) =>
    req("DELETE", `/accounts/${id}/messages/${uid}?mailbox=${encodeURIComponent(mailbox)}`),
  send: (id: string, payload: Record<string, unknown>) =>
    req("POST", `/accounts/${id}/send`, payload),
};
