import nodemailer from "nodemailer";
import { connectTcp, wrapTls, tlsOptions, insecureTls } from "../proxy.js";
import type { ProxyConfig } from "../proxy.js";
import type { ConnectionSecurity } from "../types.js";

export interface SmtpAccountSpec {
  host: string;
  port: number;
  security: ConnectionSecurity;
  username: string;
  password: string;
}

export interface SendOptions {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

async function buildTransport(spec: SmtpAccountSpec, proxy?: ProxyConfig) {
  const secure = spec.security === "tls";
  const tlsOpts = tlsOptions();
  if (!proxy || proxy.kind === "direct") {
    return nodemailer.createTransport({
      host: spec.host,
      port: spec.port,
      secure,
      auth: { user: spec.username, pass: spec.password },
      tls: tlsOpts,
    });
  }
  // 经过代理：预先建立 socket（TLS 已在此处完成握手）
  const tcp = await connectTcp(spec.host, spec.port, proxy);
  const socket = secure ? wrapTls(tcp, spec.host, tlsOpts) : tcp;
  return nodemailer.createTransport({
    connection: socket,
    secure: false,
    auth: { user: spec.username, pass: spec.password },
    tls: tlsOpts,
  });
}

export async function testSmtp(spec: SmtpAccountSpec, proxy?: ProxyConfig): Promise<void> {
  const transport = await buildTransport(spec, proxy);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

export async function sendMail(
  spec: SmtpAccountSpec,
  proxy: ProxyConfig | undefined,
  options: SendOptions,
): Promise<void> {
  const transport = await buildTransport(spec, proxy);
  try {
    await transport.sendMail({
      from: options.from,
      to: options.to.join(", "),
      cc: options.cc?.length ? options.cc.join(", ") : undefined,
      bcc: options.bcc?.length ? options.bcc.join(", ") : undefined,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
  } finally {
    transport.close();
  }
}

// 发送已经构建好的原始 RFC822 邮件（用于同时归档到“已发送”）。
export async function sendRaw(
  spec: SmtpAccountSpec,
  proxy: ProxyConfig | undefined,
  raw: Buffer,
): Promise<void> {
  const transport = await buildTransport(spec, proxy);
  try {
    await transport.sendMail({ raw });
  } finally {
    transport.close();
  }
}

void insecureTls;
