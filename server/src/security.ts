import crypto from "node:crypto";

// 使用 Node 内置 scrypt 进行密码哈希（无原生依赖）。
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const derived = crypto.scryptSync(password, salt, expected.length);
  return (
    derived.length === expected.length &&
    crypto.timingSafeEqual(derived, expected)
  );
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

// PIN 使用同样的哈希方式，但前缀区分，避免与普通密码哈希混淆。
export function hashPin(pin: string): string {
  return "pin$" + hashPassword(pin).slice("scrypt$".length);
}

export function verifyPin(pin: string, stored: string): boolean {
  if (!stored.startsWith("pin$")) return false;
  return verifyPassword(pin, "scrypt$" + stored.slice("pin$".length));
}
