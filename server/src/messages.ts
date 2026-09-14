import { Router, Request, Response, NextFunction } from "express";
import nodemailer from "nodemailer";
import { authenticated, authRead, authMutate, AppError } from "./auth.js";
import { resolveAccount } from "./accounts.js";
import { getContext } from "./context.js";
import {
  listMailboxes,
  listMessages,
  getMessageSource,
  markRead,
  deleteMessage,
  appendMessage,
} from "./mail/imap.js";
import { sendRaw } from "./mail/smtp.js";
import { parseMessage } from "./mail/parse.js";

export const messagesRouter = Router();

const SENT_CANDIDATES = ["Sent", "Sent Items", "Sent Mail", "已发送", "INBOX.Sent"];

// GET /accounts/:id/mailboxes
messagesRouter.get(
  "/accounts/:id/mailboxes",
  authRead,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = authenticated(req);
      const { spec, proxy } = await resolveAccount(userId, req.params.id);
      res.json(await listMailboxes(spec, proxy));
    } catch (err) {
      next(err);
    }
  },
);

// GET /accounts/:id/messages?mailbox=&limit=
messagesRouter.get(
  "/accounts/:id/messages",
  authRead,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = authenticated(req);
      const { spec, proxy } = await resolveAccount(userId, req.params.id);
      const mailbox = (req.query.mailbox as string) || "INBOX";
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      res.json(await listMessages(spec, proxy, mailbox, limit));
    } catch (err) {
      next(err);
    }
  },
);

// GET /accounts/:id/messages/:uid?mailbox=
messagesRouter.get(
  "/accounts/:id/messages/:uid",
  authRead,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = authenticated(req);
      const { spec, proxy } = await resolveAccount(userId, req.params.id);
      const mailbox = (req.query.mailbox as string) || "INBOX";
      const raw = await getMessageSource(spec, proxy, mailbox, req.params.uid);
      const parsed = await parseMessage(raw);
      res.json(parsed);
    } catch (err) {
      next(err);
    }
  },
);

// POST /accounts/:id/messages/:uid/read
messagesRouter.post(
  "/accounts/:id/messages/:uid/read",
  authMutate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = authenticated(req);
      const { spec, proxy } = await resolveAccount(userId, req.params.id);
      const mailbox = (req.query.mailbox as string) || "INBOX";
      await markRead(spec, proxy, mailbox, req.params.uid);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /accounts/:id/messages/:uid?mailbox=
messagesRouter.delete(
  "/accounts/:id/messages/:uid",
  authMutate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = authenticated(req);
      const { spec, proxy } = await resolveAccount(userId, req.params.id);
      const mailbox = (req.query.mailbox as string) || "INBOX";
      await deleteMessage(spec, proxy, mailbox, req.params.uid);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

// POST /accounts/:id/send
messagesRouter.post(
  "/accounts/:id/send",
  authMutate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = authenticated(req);
      const { spec, smtpSpec, proxy, stored } = await resolveAccount(userId, req.params.id);
      const body = req.body ?? {};
      const to: string[] = normalizeList(body.to);
      const cc: string[] = normalizeList(body.cc);
      const bcc: string[] = normalizeList(body.bcc);
      const subject = typeof body.subject === "string" ? body.subject : "";
      const text = typeof body.text === "string" ? body.text : "";
      const html = typeof body.html === "string" ? body.html : undefined;
      if (to.length === 0) throw AppError.validation("收件人不能为空");

      const fromAddress = stored.email;
      const fromName = stored.displayName;
      const attachments = (Array.isArray(body.attachments) ? body.attachments : [])
        .map((a: any) => ({
          filename: String(a.filename ?? "attachment"),
          content: Buffer.from(a.content ?? "", "base64"),
          contentType: a.contentType,
        }))
        .filter((a: any) => a.content.length > 0);

      const MailComposer = (nodemailer as any).MailComposer;
      const composer = new MailComposer({
        from: fromName ? `${fromName} <${fromAddress}>` : fromAddress,
        to: to.join(", "),
        cc: cc.length ? cc.join(", ") : undefined,
        bcc: bcc.length ? bcc.join(", ") : undefined,
        subject,
        text,
        html,
        attachments,
      });
      const raw = await (composer.compile() as any).build();

      await sendRaw(smtpSpec, proxy, raw);

      // 最佳努力：归档到“已发送”文件夹，失败不影响发送结果
      for (const candidate of SENT_CANDIDATES) {
        try {
          await appendMessage(spec, proxy, candidate, raw);
          break;
        } catch {
          /* 尝试下一个候选文件夹 */
        }
      }

      const { store } = getContext();
      const updated = { ...stored, lastSyncedAt: Date.now() };
      await store.upsertAccount(updated);

      res.status(202).json({ sent: true });
    } catch (err) {
      next(err);
    }
  },
);

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string")
    return value
      .split(/[,;]/)
      .map((v) => v.trim())
      .filter(Boolean);
  return [];
}
