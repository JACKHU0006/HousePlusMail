import fs from "node:fs";
import path from "node:path";

export interface Config {
  bind: string;
  dataDir: string;
  authMode: "local" | "oidc" | "hybrid";
  bootstrapAdmin?: { username: string; password: string };
  vaultSecret?: string;
  corsOrigin?: string;
  /** 是否允许开放自助注册（POST /auth/register）。默认开启；可设 HPM_REGISTRATION_ENABLED=false 关闭。 */
  registrationEnabled: boolean;
}

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export function configFromEnv(): Config {
  const dataDir = str("HPM_DATA_DIR", "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const authModeRaw = str("HPM_AUTH_MODE", "local").toLowerCase();
  const authMode: Config["authMode"] =
    authModeRaw === "oidc" ? "oidc" : authModeRaw === "hybrid" ? "hybrid" : "local";

  const username = process.env.HPM_BOOTSTRAP_ADMIN_USERNAME;
  const password = process.env.HPM_BOOTSTRAP_ADMIN_PASSWORD;
  const bootstrapAdmin =
    authMode !== "oidc" && username && password
      ? { username, password }
      : undefined;

  // 开放自助注册：默认开启；设 HPM_REGISTRATION_ENABLED=false 关闭。
  // OIDC-only 模式下本地账户无意义，注册恒为关闭。
  const regRaw = (process.env.HPM_REGISTRATION_ENABLED ?? "true").toLowerCase();
  const registrationEnabled = regRaw !== "false" && regRaw !== "0" && authMode !== "oidc";

  // 监听地址：优先 HPM_BIND；若平台注入了 PORT（Render / 多数 PaaS 会注入），
  // 则端口以 PORT 为准（主机仍用 HPM_BIND 的主机部分，默认 0.0.0.0）。
  let bind = str("HPM_BIND", "0.0.0.0:8080");
  if (process.env.PORT) {
    const host = bind.includes(":") ? bind.slice(0, bind.lastIndexOf(":")) : "0.0.0.0";
    bind = `${host}:${process.env.PORT}`;
  }

  return {
    bind,
    dataDir,
    authMode,
    bootstrapAdmin,
    vaultSecret: process.env.HPM_VAULT_SECRET,
    registrationEnabled,
  };
}
