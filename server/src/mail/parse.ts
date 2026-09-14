import { simpleParser } from "mailparser";
import type { ParsedMail } from "mailparser";
import type { ParsedMail as OurParsedMail, MailAttachment } from "../types.js";

const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 128 * 1024 * 1024;

// 将原始 RFC822 邮件解析为结构化数据（与 meowmail 的 parse_message 对齐）。
export async function parseMessage(raw: Buffer): Promise<OurParsedMail> {
  const parsed: ParsedMail = await simpleParser(raw);

  const fromAddr = parsed.from as any;
  const fromEmail = fromAddr?.value?.[0]?.address || "unknown@invalid";
  const fromName = fromAddr?.value?.[0]?.name || undefined;

  const toEmails = ((parsed.to as any)?.value ?? []).map((a: any) => a.address || "").filter(Boolean);
  const ccEmails = ((parsed.cc as any)?.value ?? []).map((a: any) => a.address || "").filter(Boolean);

  const text = typeof parsed.text === "string" ? parsed.text : "";
  const html = typeof parsed.html === "string" ? parsed.html : undefined;
  const preview = (text || "").replace(/\s+/g, " ").trim().slice(0, 180);

  let retained = 0;
  const attachments: MailAttachment[] = [];
  for (const att of parsed.attachments ?? []) {
    const filename = att.filename || `attachment-${attachments.length + 1}`;
    const contentType = att.contentType || "application/octet-stream";
    const size = att.size || att.content.length;
    const canRetain =
      size <= MAX_ATTACHMENT_BYTES &&
      retained + size <= MAX_ATTACHMENT_TOTAL_BYTES;
    let content: string | undefined;
    if (canRetain) {
      retained += size;
      content = att.content.toString("base64");
    }
    attachments.push({ filename, contentType, size, content });
  }

  let references: string[] = [];
  if (typeof parsed.references === "string") {
    references = parsed.references
      .split(/\s+/)
      .map((r) => r.replace(/[<>]/g, "").trim())
      .filter(Boolean);
  } else if (Array.isArray(parsed.references)) {
    for (const ref of parsed.references) {
      if (typeof ref === "string") {
        references.push(ref.replace(/[<>]/g, "").trim());
      } else if (ref && typeof ref === "object" && "messageId" in ref) {
        references.push(String((ref as any).messageId).replace(/[<>]/g, "").trim());
      }
    }
  }

  return {
    messageId: parsed.messageId,
    inReplyTo: typeof parsed.inReplyTo === "string" ? parsed.inReplyTo : undefined,
    references,
    fromName,
    fromEmail,
    to: toEmails,
    cc: ccEmails,
    subject: parsed.subject || "(无主题)",
    preview,
    bodyText: text,
    bodyHtml: html,
    date: parsed.date ? parsed.date.getTime() : Date.now(),
    attachmentCount: attachments.length,
    attachments,
    size: raw.length,
  };
}
