// 共享类型定义：与 meowmail 的账户 / 邮件模型对齐，仅保留邮件管理相关字段。

export type ConnectionSecurity = "tls" | "starttls";
export type ProxyKind = "direct" | "http" | "socks5";

export interface ServerConfig {
  host: string;
  port: number;
  security: ConnectionSecurity;
}

export interface ProxyInput {
  kind: ProxyKind;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
}

export interface ProxyStored {
  kind: ProxyKind;
  host?: string;
  port?: number;
  username?: string;
  passwordCipher?: string;
}

export interface ProxyPublic {
  kind: ProxyKind;
  host?: string;
  port?: number;
  username?: string;
  hasPassword: boolean;
}

export interface AccountInput {
  displayName: string;
  email: string;
  username: string;
  password?: string;
  imap: ServerConfig;
  smtp: ServerConfig;
  proxy?: ProxyInput;
  isDefault?: boolean;
}

export interface MailAccount {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  username: string;
  imap: ServerConfig;
  smtp: ServerConfig;
  proxy: ProxyPublic;
  isDefault: boolean;
  lastSyncedAt?: number;
  createdAt: number;
  updatedAt: number;
  hasPassword: boolean;
}

export interface MailAccountStored extends Omit<MailAccount, "proxy" | "hasPassword"> {
  passwordCipher: string;
  proxy: ProxyStored;
}

export type Role = "admin" | "user";

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  hasPin: boolean;
  pinHash?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  hasPin: boolean;
}

export interface MailAttachment {
  filename: string;
  contentType: string;
  size: number;
  content?: string; // base64
}

export interface ParsedMail {
  messageId?: string;
  inReplyTo?: string;
  references: string[];
  fromName?: string;
  fromEmail: string;
  to: string[];
  cc: string[];
  subject: string;
  preview: string;
  bodyText: string;
  bodyHtml?: string;
  date: number;
  attachmentCount: number;
  attachments: MailAttachment[];
  size: number;
}

export interface MailboxInfo {
  path: string;
  name: string;
  delimited: boolean;
  subscribed: boolean;
}

export interface MessageSummary {
  uid: string;
  id?: string;
  from: { name?: string; email: string }[];
  to: { name?: string; email: string }[];
  subject: string;
  date: number;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  size: number;
  preview?: string;
}

export interface ConnectionTestResponse {
  imap: boolean;
  smtp: boolean;
  imapError?: string;
  smtpError?: string;
}
