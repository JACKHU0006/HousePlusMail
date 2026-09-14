import { Router, Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { getContext } from "./context.js";
import {
  AppError,
  authenticated,
  authRead,
  authMutate,
} from "./auth.js";
import type {
  AccountInput,
  ConnectionSecurity,
  MailAccount,
  MailAccountStored,
  ProxyStored,
} from "./types.js";
import type { ProxyConfig } from "./proxy.js";
import type { ImapAccountSpec } from "./mail/imap.js";
import type { SmtpAccountSpec } from "./mail/smtp.js";
import { testImap } from "./mail/imap.js";
import { testSmtp } from "./mail/smtp.js";
import type { ConnectionTestResponse } from "./types.js";

export const accountsRouter = Router();

function toPublic(a: MailAccountStored): MailAccount {
  return {
    id: a.id,
    userId: a.userId,
    displayName: a.displayName,
    email: a.email,
    username: a.username,
    imap: a.imap,
    smtp: a.smtp,
    proxy: {
      kind: a.proxy.kind,
      host: a.proxy.host,
      port: a.proxy.port,
      username: a.proxy.username,
      hasPassword: !!a.proxy.passwordCipher,
    },
    isDefault: a.isDefault,
    lastSyncedAt: a.lastSyncedAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    hasPassword: true,
  };
}

function cleanRequired(value: string, field: string, max: number): string {
  const v = value.trim();
  if (v.length === 0 || [...v].length > max || [...v].some((c) => c.charCodeAt(0) < 32))
    throw AppError.validation(`${field} 无效`);
  return v;
}

function cleanHost(value: string, field: string): string {
  const v = value.trim().replace(/\.$/, "");
  if (
    v.length === 0 ||
    v.length > 253 ||
    v.includes("://") ||
    /\s/.test(v)
  )
    throw AppError.validation(`${field} 主机无效`);
  return v.toLowerCase();
}

function looksLikeEmail(value: string): boolean {
  const at = value.lastIndexOf("@");
  if (at <= 0) return false;
  const domain = value.slice(at + 1);
  return domain.includes(".") && !/\s/.test(value);
}

function validateServer(server: AccountInput["imap"], label: string): void {
  server.host = cleanHost(server.host, label);
  if (!server.port || server.port <= 0) throw AppError.validation(`${label} 端口无效`);
  if (server.security !== "tls" && server.security !== "starttls")
    throw AppError.validation(`${label} 加密方式不支持`);
}

function validateProxy(proxy: AccountInput["proxy"]): void {
  const p = proxy ?? { kind: "direct" as const };
  switch (p.kind) {
    case "direct":
      p.host = undefined;
      p.port = undefined;
      p.username = undefined;
      p.password = undefined;
      break;
    case "http":
    case "socks5": {
      p.host = cleanHost(p.host ?? "", "代理");
      if (!p.port || p.port <= 0) throw AppError.validation("代理端口无效");
      break;
    }
    default:
      throw AppError.validation("代理类型不支持");
  }
}

function validate(input: AccountInput, requirePassword: boolean): void {
  input.displayName = cleanRequired(input.displayName, "显示名称", 80);
  input.email = cleanRequired(input.email, "邮箱", 254).toLowerCase();
  if (!looksLikeEmail(input.email)) throw AppError.validation("邮箱地址无效");
  input.username = cleanRequired(input.username, "用户名", 320);
  validateServer(input.imap, "IMAP");
  validateServer(input.smtp, "SMTP");
  if (input.password !== undefined) {
    if (
      input.password.length === 0 ||
      input.password.length > 4096 ||
      [...input.password].some((c) => c.charCodeAt(0) < 32)
    )
      throw AppError.validation("邮件密码无效");
  } else if (requirePassword) {
    throw AppError.validation("邮件密码为必填项");
  }
  validateProxy(input.proxy);
}

function toProxyStored(proxy: AccountInput["proxy"], vault: ReturnType<typeof getContext>["vault"]): ProxyStored {
  const p = proxy ?? { kind: "direct" as const };
  return {
    kind: p.kind,
    host: p.host,
    port: p.port,
    username: p.username,
    passwordCipher: p.password ? vault.seal(p.password) : undefined,
  };
}

function resolveProxy(stored: ProxyStored, vault: ReturnType<typeof getContext>["vault"]): ProxyConfig {
  return {
    kind: stored.kind,
    host: stored.host,
    port: stored.port,
    username: stored.username,
    password: stored.passwordCipher ? vault.open(stored.passwordCipher) : undefined,
  };
}

interface Resolved {
  spec: ImapAccountSpec;
  smtpSpec: SmtpAccountSpec;
  proxy?: ProxyConfig;
  stored: MailAccountStored;
}

export async function resolveAccount(
  userId: string,
  id: string,
): Promise<Resolved> {
  const { store, vault } = getContext();
  const stored = store.getAccount(userId, id);
  if (!stored) throw AppError.notFound("邮件账户不存在");
  const password = vault.open(stored.passwordCipher);
  return {
    spec: {
      host: stored.imap.host,
      port: stored.imap.port,
      security: stored.imap.security,
      username: stored.username,
      password,
    },
    smtpSpec: {
      host: stored.smtp.host,
      port: stored.smtp.port,
      security: stored.smtp.security,
      username: stored.username,
      password,
    },
    proxy: resolveProxy(stored.proxy, vault),
    stored,
  };
}

async function testConnection(
  spec: ImapAccountSpec,
  smtpSpec: SmtpAccountSpec,
  proxy?: ProxyConfig,
): Promise<ConnectionTestResponse> {
  const [imapR, smtpR] = await Promise.allSettled([
    testImap(spec, proxy),
    testSmtp(smtpSpec, proxy),
  ]);
  const summarize = (r: PromiseSettledResult<void>): string | undefined =>
    r.status === "rejected"
      ? String((r.reason as Error)?.message ?? r.reason).slice(0, 220)
      : undefined;
  return {
    imap: imapR.status === "fulfilled",
    smtp: smtpR.status === "fulfilled",
    imapError: summarize(imapR),
    smtpError: summarize(smtpR),
  };
}

// GET /accounts
accountsRouter.get("/", authRead, (req: Request, res: Response) => {
  const { userId } = authenticated(req);
  const { store } = getContext();
  const accounts = store.getAccounts(userId).map(toPublic);
  res.json(accounts);
});

// POST /accounts
accountsRouter.post("/", authMutate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = authenticated(req);
    const { store, vault } = getContext();
    const input = req.body as AccountInput;
    validate(input, true);
    if (store.getAccounts(userId).some((a) => a.email === input.email.toLowerCase()))
      throw AppError.conflict("该邮箱已存在");

    const now = Date.now();
    const id = randomUUID();
    const count = store.getAccounts(userId).length;
    const isDefault = !!input.isDefault || count === 0;
    if (isDefault) await store.setDefaultAccount(userId, id);

    const stored: MailAccountStored = {
      id,
      userId,
      displayName: input.displayName,
      email: input.email.toLowerCase(),
      username: input.username,
      passwordCipher: vault.seal(input.password!),
      imap: input.imap,
      smtp: input.smtp,
      proxy: toProxyStored(input.proxy, vault),
      isDefault,
      lastSyncedAt: undefined,
      createdAt: now,
      updatedAt: now,
    };
    await store.upsertAccount(stored);
    res.status(201).json(toPublic(stored));
  } catch (err) {
    next(err);
  }
});

// POST /accounts/test
accountsRouter.post("/test", authMutate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = req.body as AccountInput;
    validate(input, true);
    const spec: ImapAccountSpec = {
      host: input.imap.host,
      port: input.imap.port,
      security: input.imap.security,
      username: input.username,
      password: input.password!,
    };
    const smtpSpec: SmtpAccountSpec = {
      host: input.smtp.host,
      port: input.smtp.port,
      security: input.smtp.security,
      username: input.username,
      password: input.password!,
    };
    const proxy: ProxyConfig | undefined = input.proxy?.kind
      ? {
          kind: input.proxy.kind,
          host: input.proxy.host,
          port: input.proxy.port,
          username: input.proxy.username,
          password: input.proxy.password,
        }
      : undefined;
    res.json(await testConnection(spec, smtpSpec, proxy));
  } catch (err) {
    next(err);
  }
});

// PATCH /accounts/:id
accountsRouter.patch("/:id", authMutate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = authenticated(req);
    const { store, vault } = getContext();
    const id = req.params.id;
    const existing = store.getAccount(userId, id);
    if (!existing) throw AppError.notFound("邮件账户不存在");
    const input = req.body as AccountInput;
    validate(input, false);
    if (
      store
        .getAccounts(userId)
        .some((a) => a.email === input.email.toLowerCase() && a.id !== id)
    )
      throw AppError.conflict("该邮箱已存在");

    const passwordCipher = input.password
      ? vault.seal(input.password)
      : existing.passwordCipher;
    const proxy = input.proxy
      ? toProxyStored(input.proxy, vault)
      : existing.proxy;

    const isDefault = !!input.isDefault;
    if (isDefault && !existing.isDefault) await store.setDefaultAccount(userId, id);

    const updated: MailAccountStored = {
      ...existing,
      displayName: input.displayName,
      email: input.email.toLowerCase(),
      username: input.username,
      passwordCipher,
      imap: input.imap,
      smtp: input.smtp,
      proxy,
      isDefault,
      updatedAt: Date.now(),
    };
    await store.upsertAccount(updated);
    if (!isDefault && existing.isDefault) await store.ensureDefault(userId);
    res.json(toPublic(updated));
  } catch (err) {
    next(err);
  }
});

// DELETE /accounts/:id
accountsRouter.delete("/:id", authMutate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = authenticated(req);
    const { store } = getContext();
    const ok = await store.deleteAccount(userId, req.params.id);
    if (!ok) throw AppError.notFound("邮件账户不存在");
    await store.ensureDefault(userId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /accounts/:id/test
accountsRouter.post("/:id/test", authMutate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = authenticated(req);
    const resolved = await resolveAccount(userId, req.params.id);
    res.json(await testConnection(resolved.spec, resolved.smtpSpec, resolved.proxy));
  } catch (err) {
    next(err);
  }
});
