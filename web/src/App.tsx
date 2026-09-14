import { useEffect, useState, useCallback } from "react";
import { api, setCsrf } from "./api";
import type {
  AccountInput,
  ConnectionTestResponse,
  MailAccount,
  MailboxInfo,
  MessageSummary,
  ParsedMail,
  PublicUser,
} from "./types";

export interface ComposeInit {
  to?: string;
  cc?: string;
  subject?: string;
  text?: string;
}

export default function App() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [mailboxes, setMailboxes] = useState<MailboxInfo[]>([]);
  const [selectedMailbox, setSelectedMailbox] = useState("INBOX");
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<ParsedMail | null>(null);
  const [showAccounts, setShowAccounts] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [messageLimit, setMessageLimit] = useState(50);
  const [messageTotal, setMessageTotal] = useState(0);
  const [composeInitial, setComposeInitial] = useState<ComposeInit | null>(null);

  const loadAccounts = useCallback(async () => {
    const list = await api.listAccounts();
    setAccounts(list);
    if (list.length && !selectedAccount) {
      const def = list.find((a) => a.isDefault) || list[0];
      setSelectedAccount(def.id);
    }
  }, [selectedAccount]);

  useEffect(() => {
    (async () => {
      try {
        const s = await api.session();
        setUser(s.user);
        setCsrf(s.csrfToken);
      } catch {
        /* 未登录 */
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (user) loadAccounts().catch((e) => setError(e.message));
  }, [user, loadAccounts]);

  useEffect(() => {
    if (!selectedAccount) return;
    (async () => {
      try {
        const m = await api.mailboxes(selectedAccount);
        setMailboxes(m);
        setSelectedMailbox("INBOX");
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [selectedAccount, showAccounts]);

  const refreshMessages = useCallback(async () => {
    if (!selectedAccount) return;
    const r = await api.messages(selectedAccount, selectedMailbox, messageLimit);
    setMessages(r.messages);
    setMessageTotal(r.total);
  }, [selectedAccount, selectedMailbox, messageLimit]);

  useEffect(() => {
    refreshMessages().catch((e) => setError(e.message));
  }, [refreshMessages]);

  const openMessage = async (uid: string) => {
    if (!selectedAccount) return;
    setSelectedUid(uid);
    setSelectedMessage(null);
    try {
      const m = await api.message(selectedAccount, uid, selectedMailbox);
      setSelectedMessage(m);
      try {
        await api.markRead(selectedAccount, uid, selectedMailbox);
      } catch {
        /* 已读标记失败不阻断阅读 */
      }
      await refreshMessages();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeMessage = async (uid: string) => {
    if (!selectedAccount) return;
    if (!confirm("确定删除该邮件？")) return;
    await api.deleteMessage(selectedAccount, uid, selectedMailbox);
    setSelectedUid(null);
    setSelectedMessage(null);
    await refreshMessages();
  };

  const doLogout = async () => {
    await api.logout();
    setUser(null);
    setCsrf("");
    setAccounts([]);
    setSelectedAccount(null);
    setMessages([]);
    setSelectedMessage(null);
  };

  const openCompose = (initial?: ComposeInit) => {
    setComposeInitial(initial ?? null);
    setShowCompose(true);
  };

  const loadMore = () => {
    if (messageLimit < 200) setMessageLimit((l) => Math.min(l + 50, 200));
  };

  if (loading) return <div className="centered">加载中…</div>;
  if (!user)
    return <LoginPage onLogin={(u, c) => { setUser(u); setCsrf(c); }} />;

  const currentAccount = accounts.find((a) => a.id === selectedAccount);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">HousePlusMail</div>
        <select
          className="account-select"
          value={selectedAccount ?? ""}
          onChange={(e) => { setSelectedAccount(e.target.value); setSelectedUid(null); setSelectedMessage(null); }}
        >
          {accounts.length === 0 && <option value="">（无账户）</option>}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName} &lt;{a.email}&gt;
            </option>
          ))}
        </select>
        <div className="spacer" />
        <span className="user">{user.username}</span>
        <button onClick={() => setShowAccounts(true)}>账户管理</button>
        <button className="primary" onClick={() => setShowCompose(true)} disabled={!selectedAccount}>
          写邮件
        </button>
        <button onClick={doLogout}>退出</button>
      </header>

      {error && (
        <div className="banner error" onClick={() => setError(null)}>
          {error}（点击关闭）
        </div>
      )}

      <div className="body">
        <aside className="folders">
          <div className="section-title">文件夹</div>
          {mailboxes.length === 0 && <div className="muted">无文件夹</div>}
          {mailboxes.map((mb) => (
            <div
              key={mb.path}
              className={"folder" + (mb.path === selectedMailbox ? " active" : "")}
              onClick={() => { setSelectedMailbox(mb.path); setSelectedUid(null); setSelectedMessage(null); }}
            >
              {mb.name}
            </div>
          ))}
        </aside>

        <section className="list">
          <div className="section-title">
            {selectedMailbox}（{messages.length}
            {messageTotal > 0 && messageTotal !== messages.length ? ` / ${messageTotal}` : ""}）
          </div>
          {messages.length === 0 && <div className="muted">该文件夹为空</div>}
          {messages.map((m) => (
            <div
              key={m.uid}
              className={"msg-row" + (m.uid === selectedUid ? " active" : "") + (m.seen ? "" : " unread")}
              onClick={() => openMessage(m.uid)}
            >
              <div className="msg-from">{m.from.map((f) => f.name || f.email).join(", ")}</div>
              <div className="msg-subject">{m.subject}</div>
              <div className="msg-preview">{m.preview || ""}</div>
              <div className="msg-date">{new Date(m.date).toLocaleString()}</div>
            </div>
          ))}
          {messages.length < messageTotal && (
            <button className="load-more" onClick={loadMore} disabled={busy}>
              加载更多（已显示 {messages.length} / 共 {messageTotal}）
            </button>
          )}
        </section>

        <section className="detail">
          {selectedMessage ? (
            <MessageDetail
              mail={selectedMessage}
              onDelete={() => selectedUid && removeMessage(selectedUid)}
              accountEmail={currentAccount?.email}
              onReply={() =>
                openCompose({
                  to: selectedMessage.fromEmail,
                  subject: selectedMessage.subject.startsWith("Re:")
                    ? selectedMessage.subject
                    : `Re: ${selectedMessage.subject}`,
                  text: buildQuote(selectedMessage, "reply"),
                })
              }
              onReplyAll={() =>
                openCompose({
                  to: selectedMessage.fromEmail,
                  cc: [
                    ...selectedMessage.to.filter((t) => t && t !== currentAccount?.email),
                  ].join(", "),
                  subject: selectedMessage.subject.startsWith("Re:")
                    ? selectedMessage.subject
                    : `Re: ${selectedMessage.subject}`,
                  text: buildQuote(selectedMessage, "reply"),
                })
              }
              onForward={() =>
                openCompose({
                  subject: selectedMessage.subject.startsWith("Fwd:")
                    ? selectedMessage.subject
                    : `Fwd: ${selectedMessage.subject}`,
                  text: buildQuote(selectedMessage, "forward"),
                })
              }
            />
          ) : (
            <div className="muted center">选择一封邮件查看详情</div>
          )}
        </section>
      </div>

      {showAccounts && (
        <AccountManagerDialog
          accounts={accounts}
          onChange={async () => { await loadAccounts(); setShowAccounts(false); }}
          onClose={() => setShowAccounts(false)}
        />
      )}
      {showCompose && currentAccount && (
        <ComposeDialog
          account={currentAccount}
          initial={composeInitial}
          onSent={async () => { setShowCompose(false); await refreshMessages(); }}
          onClose={() => setShowCompose(false)}
        />
      )}
    </div>
  );
}

function LoginPage({ onLogin }: { onLogin: (u: PublicUser, csrf: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await api.login(username, password);
      setCsrf(s.csrfToken);
      onLogin(s.user, s.csrfToken);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>HousePlusMail</h1>
        <p className="muted">自托管 · 多用户 · 多邮件账户</p>
        <input
          placeholder="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />
        <input
          placeholder="密码"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="banner error">{error}</div>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "登录中…" : "登录"}
        </button>
      </form>
    </div>
  );
}

function MessageDetail({
  mail,
  onDelete,
  accountEmail,
  onReply,
  onReplyAll,
  onForward,
}: {
  mail: ParsedMail;
  onDelete: () => void;
  accountEmail?: string;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
}) {
  return (
    <div className="message-detail">
      <div className="msg-head">
        <h2>{mail.subject}</h2>
        <div className="msg-meta">
          <div>发件人：{mail.fromName ? `${mail.fromName} <${mail.fromEmail}>` : mail.fromEmail}</div>
          <div>收件人：{mail.to.join(", ")}</div>
          {mail.cc.length > 0 && <div>抄送：{mail.cc.join(", ")}</div>}
          <div>时间：{new Date(mail.date).toLocaleString()}</div>
        </div>
        <div className="msg-actions">
          <button onClick={onReply}>回复</button>
          <button onClick={onReplyAll}>回复全部</button>
          <button onClick={onForward}>转发</button>
          <button className="danger" onClick={onDelete}>
            删除
          </button>
        </div>
      </div>
      <div className="msg-body">
        {mail.bodyHtml ? (
          <iframe title="mail" srcDoc={mail.bodyHtml} className="mail-html" />
        ) : (
          <pre>{mail.bodyText}</pre>
        )}
      </div>
      {mail.attachments.length > 0 && (
        <div className="attachments">
          <div className="section-title">附件（{mail.attachments.length}）</div>
          {mail.attachments.map((a, i) => (
            <div key={i} className="attachment">
              {a.content ? (
                <a
                  href={`data:${a.contentType};base64,${a.content}`}
                  download={a.filename}
                >
                  {a.filename}（{(a.size / 1024).toFixed(1)} KB）
                </a>
              ) : (
                <span>
                  {a.filename}（{(a.size / 1024).toFixed(1)} KB，过大未加载）
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function buildQuote(mail: ParsedMail, mode: "reply" | "forward"): string {
  const who = mail.fromName ? `${mail.fromName} <${mail.fromEmail}>` : mail.fromEmail;
  const header = [
    mode === "forward" ? "---------- 转发邮件 ----------" : "---------- 原邮件 ----------",
    `发件人：${who}`,
    `收件人：${mail.to.map((t) => t || "").join(", ")}`,
    `时间：${new Date(mail.date).toLocaleString()}`,
    `主题：${mail.subject}`,
    "",
  ].join("\n");
  const body = mail.bodyText || "(无纯文本内容)";
  return `\n\n${header}${body}\n`;
}

const EMPTY_FORM: AccountInput = {
  displayName: "",
  email: "",
  username: "",
  password: "",
  imap: { host: "", port: 993, security: "tls" },
  smtp: { host: "", port: 465, security: "tls" },
  proxy: { kind: "direct" },
  isDefault: false,
};

function AccountManagerDialog({
  accounts,
  onChange,
  onClose,
}: {
  accounts: MailAccount[];
  onChange: () => Promise<void>;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<AccountInput | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [test, setTest] = useState<ConnectionTestResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCreate = () => {
    setEditId(null);
    setTest(null);
    setError(null);
    setEditing(JSON.parse(JSON.stringify(EMPTY_FORM)));
  };
  const startEdit = (a: MailAccount) => {
    setEditId(a.id);
    setTest(null);
    setError(null);
    setEditing({
      displayName: a.displayName,
      email: a.email,
      username: a.username,
      password: "",
      imap: { ...a.imap },
      smtp: { ...a.smtp },
      proxy: { kind: a.proxy.kind, host: a.proxy.host, port: a.proxy.port, username: a.proxy.username },
      isDefault: a.isDefault,
    });
  };

  const runTest = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const r = editId ? await api.testSaved(editId) : await api.testDraft(editing);
      setTest(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      if (editId) await api.updateAccount(editId, editing);
      else await api.createAccount(editing);
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("确定删除该邮件账户？")) return;
    await api.deleteAccount(id);
    await onChange();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>账户管理</h3>
          <button onClick={onClose}>关闭</button>
        </div>
        {!editing ? (
          <div className="account-list">
            {accounts.length === 0 && <div className="muted">尚未添加任何邮件账户</div>}
            {accounts.map((a) => (
              <div key={a.id} className="account-item">
                <div>
                  <strong>{a.displayName}</strong> &lt;{a.email}&gt;
                  {a.isDefault && <span className="tag">默认</span>}
                </div>
                <div>
                  <button onClick={() => startEdit(a)}>编辑</button>
                  <button className="danger" onClick={() => remove(a.id)}>
                    删除
                  </button>
                </div>
              </div>
            ))}
            <button className="primary" onClick={startCreate}>
              + 添加账户
            </button>
          </div>
        ) : (
          <AccountForm
            value={editing}
            onChange={setEditing}
            test={test}
            error={error}
            busy={busy}
            onTest={runTest}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        )}
      </div>
    </div>
  );
}

function AccountForm({
  value,
  onChange,
  test,
  error,
  busy,
  onTest,
  onSave,
  onCancel,
}: {
  value: AccountInput;
  onChange: (v: AccountInput) => void;
  test: ConnectionTestResponse | null;
  error: string | null;
  busy: boolean;
  onTest: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<AccountInput>) => onChange({ ...value, ...patch });
  const setImap = (patch: Partial<AccountInput["imap"]>) =>
    onChange({ ...value, imap: { ...value.imap, ...patch } });
  const setSmtp = (patch: Partial<AccountInput["smtp"]>) =>
    onChange({ ...value, smtp: { ...value.smtp, ...patch } });
  const setProxy = (patch: Partial<NonNullable<AccountInput["proxy"]>>) =>
    onChange({ ...value, proxy: { ...(value.proxy || { kind: "direct" }), ...patch } });

  return (
    <div className="account-form">
      <div className="grid">
        <label>显示名称<input value={value.displayName} onChange={(e) => set({ displayName: e.target.value })} /></label>
        <label>邮箱地址<input value={value.email} onChange={(e) => set({ email: e.target.value })} /></label>
        <label>登录用户名<input value={value.username} onChange={(e) => set({ username: e.target.value })} /></label>
        <label>密码<input type="password" placeholder="新增必填，编辑留空则不修改" value={value.password} onChange={(e) => set({ password: e.target.value })} /></label>
      </div>

      <fieldset>
        <legend>IMAP（收件）</legend>
        <div className="grid">
          <label>主机<input value={value.imap.host} onChange={(e) => setImap({ host: e.target.value })} /></label>
          <label>端口<input type="number" value={value.imap.port} onChange={(e) => setImap({ port: Number(e.target.value) })} /></label>
          <label>加密
            <select value={value.imap.security} onChange={(e) => setImap({ security: e.target.value as any })}>
              <option value="tls">TLS（隐式）</option>
              <option value="starttls">STARTTLS</option>
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>SMTP（发件）</legend>
        <div className="grid">
          <label>主机<input value={value.smtp.host} onChange={(e) => setSmtp({ host: e.target.value })} /></label>
          <label>端口<input type="number" value={value.smtp.port} onChange={(e) => setSmtp({ port: Number(e.target.value) })} /></label>
          <label>加密
            <select value={value.smtp.security} onChange={(e) => setSmtp({ security: e.target.value as any })}>
              <option value="tls">TLS（隐式）</option>
              <option value="starttls">STARTTLS</option>
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>代理（可选）</legend>
        <div className="grid">
          <label>类型
            <select value={value.proxy?.kind || "direct"} onChange={(e) => setProxy({ kind: e.target.value as any })}>
              <option value="direct">直连</option>
              <option value="http">HTTP 代理</option>
              <option value="socks5">SOCKS5 代理</option>
            </select>
          </label>
          <label>代理主机<input value={value.proxy?.host || ""} onChange={(e) => setProxy({ host: e.target.value })} disabled={value.proxy?.kind === "direct"} /></label>
          <label>代理端口<input type="number" value={value.proxy?.port || ""} onChange={(e) => setProxy({ port: Number(e.target.value) })} disabled={value.proxy?.kind === "direct"} /></label>
          <label>代理用户<input value={value.proxy?.username || ""} onChange={(e) => setProxy({ username: e.target.value })} disabled={value.proxy?.kind === "direct"} /></label>
          <label>代理密码<input type="password" value={value.proxy?.password || ""} onChange={(e) => setProxy({ password: e.target.value })} disabled={value.proxy?.kind === "direct"} /></label>
        </div>
      </fieldset>

      <label className="checkbox">
        <input type="checkbox" checked={!!value.isDefault} onChange={(e) => set({ isDefault: e.target.checked })} /> 设为默认账户
      </label>

      {error && <div className="banner error">{error}</div>}
      {test && (
        <div className="test-result">
          连接测试：IMAP {test.imap ? "✅" : "❌" + (test.imapError ? `（${test.imapError}）` : "")} ，
          SMTP {test.smtp ? "✅" : "❌" + (test.smtpError ? `（${test.smtpError}）` : "")}
        </div>
      )}

      <div className="modal-actions">
        <button onClick={onTest} disabled={busy}>测试连接</button>
        <button className="primary" onClick={onSave} disabled={busy}>保存</button>
        <button onClick={onCancel} disabled={busy}>取消</button>
      </div>
    </div>
  );
}

function ComposeDialog({
  account,
  initial,
  onSent,
  onClose,
}: {
  account: MailAccount;
  initial?: ComposeInit | null;
  onSent: () => Promise<void>;
  onClose: () => void;
}) {
  const [to, setTo] = useState(initial?.to ?? "");
  const [cc, setCc] = useState(initial?.cc ?? "");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [text, setText] = useState(initial?.text ?? "");
  const [attachments, setAttachments] = useState<{ filename: string; contentType: string; content: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1] || "";
        setAttachments((prev) => [
          ...prev,
          { filename: file.name, contentType: file.type || "application/octet-stream", content: base64 },
        ]);
      };
      reader.readAsDataURL(file);
    });
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.send(account.id, {
        to: to.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
        cc: cc.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
        bcc: bcc.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
        subject,
        text,
        attachments,
      });
      await onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>写邮件 · {account.email}</h3>
          <button onClick={onClose}>关闭</button>
        </div>
        <div className="compose">
          <input placeholder="收件人（逗号分隔）" value={to} onChange={(e) => setTo(e.target.value)} />
          <input placeholder="抄送（可选）" value={cc} onChange={(e) => setCc(e.target.value)} />
          <input placeholder="密送（可选）" value={bcc} onChange={(e) => setBcc(e.target.value)} />
          <input placeholder="主题" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea placeholder="正文" rows={12} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="compose-attach">
            <input type="file" multiple onChange={(e) => onFiles(e.target.files)} />
            {attachments.map((a, i) => (
              <span key={i} className="tag">
                {a.filename}
                <button className="x" onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
          </div>
          {error && <div className="banner error">{error}</div>}
          <div className="modal-actions">
            <button className="primary" onClick={send} disabled={busy}>
              {busy ? "发送中…" : "发送"}
            </button>
            <button onClick={onClose} disabled={busy}>取消</button>
          </div>
        </div>
      </div>
    </div>
  );
}
