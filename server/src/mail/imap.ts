import { ImapFlow } from "imapflow";
import { connectTcp, wrapTls, tlsOptions } from "../proxy.js";
import type { ProxyConfig } from "../proxy.js";
import type { ConnectionSecurity } from "../types.js";
import type { MessageSummary, MailboxInfo } from "../types.js";

export interface ImapAccountSpec {
  host: string;
  port: number;
  security: ConnectionSecurity;
  username: string;
  password: string;
}

const OPERATION_TIMEOUT = 30_000;

async function connectImap(spec: ImapAccountSpec, proxy?: ProxyConfig): Promise<ImapFlow> {
  const secure = spec.security === "tls";
  const tlsOpts = tlsOptions();
  // imapflow 1.x 不支持在构造函数中直接传入 socket，这里用 any 透传（仅代理路径使用）。
  const baseOptions: any = {
    host: spec.host,
    port: spec.port,
    secure,
    auth: { user: spec.username, pass: spec.password },
    tls: tlsOpts,
    logger: false,
  };
  if (!proxy || proxy.kind === "direct") {
    const client = new ImapFlow(baseOptions);
    await client.connect();
    return client;
  }
  const tcp = await connectTcp(spec.host, spec.port, proxy);
  const socket = secure ? wrapTls(tcp, spec.host, tlsOpts) : tcp;
  const client = new ImapFlow({ ...baseOptions, secure: false, socket });
  await client.connect();
  return client;
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} 操作超时`)), OPERATION_TIMEOUT),
    ),
  ]);
}

export async function testImap(spec: ImapAccountSpec, proxy?: ProxyConfig): Promise<void> {
  const client = await connectImap(spec, proxy);
  try {
    await withTimeout(client.noop(), "IMAP NOOP");
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

export async function listMailboxes(
  spec: ImapAccountSpec,
  proxy?: ProxyConfig,
): Promise<MailboxInfo[]> {
  const client = await connectImap(spec, proxy);
  try {
    const tree = await withTimeout(client.listTree(), "IMAP 列举邮箱");
    const result: MailboxInfo[] = [];
    const walk = (nodes: any[]) => {
      for (const node of nodes) {
        const path = node.path;
        if (!path) continue;
        result.push({
          path,
          name: node.name ?? path,
          delimited: !!node.delimiter,
          subscribed: !!node.subscribed,
        });
        if (node.folders?.length) walk(node.folders);
      }
    };
    walk((tree as any[]) ?? []);
    return result;
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

function addressList(arr: any): { name?: string; email: string }[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((a) => ({
      name: a.name || undefined,
      email: a.address || "",
    }))
    .filter((a) => a.email);
}

export async function listMessages(
  spec: ImapAccountSpec,
  proxy: ProxyConfig | undefined,
  mailbox: string,
  limit = 50,
): Promise<{ total: number; messages: MessageSummary[] }> {
  const client = await connectImap(spec, proxy);
  try {
    const mbox = await client.mailboxOpen(mailbox);
    const total = (mbox as any).exists ?? 0;
    const messages: MessageSummary[] = [];
    if (total > 0) {
      const start = Math.max(1, total - limit + 1);
      const range = `${start}:*`;
      const fetch = client.fetch(range, {
        uid: true,
        envelope: true,
        flags: true,
        size: true,
      });
      for await (const msg of fetch) {
        const env = (msg as any).envelope ?? {};
        const flags: string[] = (msg as any).flags ?? [];
        messages.push({
          uid: String((msg as any).uid),
          id: env.messageId,
          from: addressList(env.from),
          to: addressList(env.to),
          subject: env.subject || "(无主题)",
          date: env.date ? new Date(env.date).getTime() : Date.now(),
          seen: flags.includes("\\Seen"),
          flagged: flags.includes("\\Flagged"),
          answered: flags.includes("\\Answered"),
          size: (msg as any).size ?? 0,
        });
      }
    }
    messages.reverse(); // 最新在前
    return { total, messages };
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

export async function getMessageSource(
  spec: ImapAccountSpec,
  proxy: ProxyConfig | undefined,
  mailbox: string,
  uid: string,
): Promise<Buffer> {
  const client = await connectImap(spec, proxy);
  try {
    await client.mailboxOpen(mailbox);
    const msg = await client.fetchOne(uid, {
      uid: true,
      source: true,
      sourceOptions: { uid: true },
    } as any);
    const raw = (msg as any)?.source;
    if (!raw) throw new Error("无法读取邮件内容");
    return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

export async function markRead(
  spec: ImapAccountSpec,
  proxy: ProxyConfig | undefined,
  mailbox: string,
  uid: string,
): Promise<void> {
  const client = await connectImap(spec, proxy);
  try {
    await client.mailboxOpen(mailbox);
    await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

export async function deleteMessage(
  spec: ImapAccountSpec,
  proxy: ProxyConfig | undefined,
  mailbox: string,
  uid: string,
): Promise<void> {
  const client = await connectImap(spec, proxy);
  try {
    await client.mailboxOpen(mailbox);
    await client.messageDelete(uid, { uid: true });
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

export async function appendMessage(
  spec: ImapAccountSpec,
  proxy: ProxyConfig | undefined,
  mailbox: string,
  raw: Buffer,
): Promise<void> {
  const client = await connectImap(spec, proxy);
  try {
    await client.append(mailbox, raw, ["\\Seen"]);
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}
