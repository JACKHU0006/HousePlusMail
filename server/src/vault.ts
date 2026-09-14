import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// 凭据保险库：使用 AES-256-GCM 在静态存储中加密邮件账户密码 / 代理密码。
// 密钥来源（与 meowmail 一致）：
//   - 若提供 HPM_VAULT_SECRET，则由其派生（配合 data/vault.salt）；
//   - 否则在 data/vault.key 生成并持久化随机密钥（权限 0600）。
export class CredentialVault {
  private key: Buffer;

  constructor(key: Buffer) {
    this.key = key;
  }

  static load(secret: string | undefined, dataDir: string): CredentialVault {
    if (secret) {
      const salt = loadOrCreateBytes(path.join(dataDir, "vault.salt"), 16);
      const key = crypto.scryptSync(secret, salt, 32);
      return new CredentialVault(key);
    }
    const key = loadOrCreateBytes(path.join(dataDir, "vault.key"), 32);
    return new CredentialVault(key);
  }

  seal(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, enc, tag]).toString("base64url");
  }

  open(envelope: string): string {
    const buf = Buffer.from(envelope, "base64url");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(buf.length - 16);
    const enc = buf.subarray(12, buf.length - 16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString("utf8");
  }
}

function loadOrCreateBytes(p: string, n: number): Buffer {
  if (fs.existsSync(p)) return fs.readFileSync(p);
  const bytes = crypto.randomBytes(n);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  try {
    fs.writeFileSync(p, bytes, { mode: 0o600 });
  } catch {
    // 忽略权限设置失败，继续运行
  }
  return bytes;
}
