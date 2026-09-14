import type { Config } from "./config.js";
import type { Store } from "./store.js";
import type { CredentialVault } from "./vault.js";
import { SessionStore } from "./auth.js";

export interface AppContext {
  config: Config;
  store: Store;
  vault: CredentialVault;
  sessions: SessionStore;
}

let ctx: AppContext | null = null;

export function setContext(c: AppContext): void {
  ctx = c;
}

export function getContext(): AppContext {
  if (!ctx) throw new Error("应用上下文尚未初始化");
  return ctx;
}
