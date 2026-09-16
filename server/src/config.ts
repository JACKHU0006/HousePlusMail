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

  return {
    bind: str("HPM_BIND", "0.0.0.0:8080"),
    dataDir,
    authMode,
    bootstrapAdmin,
    vaultSecret: process.env.HPM_VAULT_SECRET,
    registrationEnabled,
  };
}
