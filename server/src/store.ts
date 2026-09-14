import fs from "node:fs";
import path from "node:path";
import type { MailAccountStored, User } from "./types.js";

interface StoreData {
  version: number;
  users: User[];
  accounts: MailAccountStored[];
}

// 简单的基于文件的持久化层：进程内持有数据，变更后原子写入（写入临时文件再 rename）。
// 适用于内部自用部署；如需更高并发可替换为 SQLite。
export class Store {
  private data: StoreData;
  private file: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "store.json");
    this.data = this.load();
  }

  private load(): StoreData {
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw) as StoreData;
      if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.accounts)) {
        return { version: parsed.version ?? 1, users: parsed.users, accounts: parsed.accounts };
      }
    } catch {
      // 文件不存在或损坏，使用空存储
    }
    return { version: 1, users: [], accounts: [] };
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2);
    const tmp = `${this.file}.${process.pid}.tmp`;
    // 串行化写入，避免并发 rename 竞态
    this.writeQueue = this.writeQueue.then(
      () =>
        new Promise<void>((resolve, reject) => {
          fs.writeFile(tmp, snapshot, (err) => {
            if (err) return reject(err);
            fs.rename(tmp, this.file, (renameErr) => {
              if (renameErr) return reject(renameErr);
              resolve();
            });
          });
        }),
    );
    return this.writeQueue;
  }

  // ---------- 用户 ----------
  getUsers(): User[] {
    return this.data.users;
  }

  getUserById(id: string): User | undefined {
    return this.data.users.find((u) => u.id === id);
  }

  getUserByName(username: string): User | undefined {
    const lower = username.toLowerCase();
    return this.data.users.find((u) => u.username.toLowerCase() === lower);
  }

  async upsertUser(user: User): Promise<User> {
    const idx = this.data.users.findIndex((u) => u.id === user.id);
    if (idx >= 0) this.data.users[idx] = user;
    else this.data.users.push(user);
    await this.persist();
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    this.data.users = this.data.users.filter((u) => u.id !== id);
    this.data.accounts = this.data.accounts.filter((a) => a.userId !== id);
    await this.persist();
  }

  hasLocalUser(): boolean {
    return this.data.users.length > 0;
  }

  // ---------- 账户 ----------
  getAccounts(userId: string): MailAccountStored[] {
    return this.data.accounts.filter((a) => a.userId === userId);
  }

  getAccount(userId: string, id: string): MailAccountStored | undefined {
    return this.data.accounts.find((a) => a.userId === userId && a.id === id);
  }

  async upsertAccount(account: MailAccountStored): Promise<void> {
    const idx = this.data.accounts.findIndex(
      (a) => a.userId === account.userId && a.id === account.id,
    );
    if (idx >= 0) this.data.accounts[idx] = account;
    else this.data.accounts.push(account);
    await this.persist();
  }

  async deleteAccount(userId: string, id: string): Promise<boolean> {
    const before = this.data.accounts.length;
    this.data.accounts = this.data.accounts.filter(
      (a) => !(a.userId === userId && a.id === id),
    );
    const removed = this.data.accounts.length < before;
    if (removed) await this.persist();
    return removed;
  }

  async setDefaultAccount(userId: string, id: string): Promise<void> {
    let changed = false;
    for (const a of this.data.accounts) {
      if (a.userId !== userId) continue;
      const shouldDefault = a.id === id;
      if (a.isDefault !== shouldDefault) {
        a.isDefault = shouldDefault;
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  async ensureDefault(userId: string): Promise<void> {
    const owned = this.data.accounts.filter((a) => a.userId === userId);
    if (owned.length === 0) return;
    if (owned.some((a) => a.isDefault)) return;
    owned.sort((a, b) => a.createdAt - b.createdAt);
    owned[0].isDefault = true;
    await this.persist();
  }
}
