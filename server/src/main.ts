import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { configFromEnv } from "./config.js";
import { Store } from "./store.js";
import { CredentialVault } from "./vault.js";
import { SessionStore } from "./auth.js";
import { setContext } from "./context.js";
import { buildApp } from "./server.js";
import { hashPassword } from "./security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function bootstrap() {
  const config = configFromEnv();
  const store = new Store(config.dataDir);
  const vault = CredentialVault.load(config.vaultSecret, config.dataDir);

  // 首次启动：从环境变量创建管理员账户
  if (config.bootstrapAdmin && !store.hasLocalUser()) {
    await store.upsertUser({
      id: randomUUID(),
      username: config.bootstrapAdmin.username,
      passwordHash: hashPassword(config.bootstrapAdmin.password),
      role: "admin",
      hasPin: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    console.log(`已创建启动管理员账户：${config.bootstrapAdmin.username}`);
  }

  if (config.authMode !== "oidc" && !store.hasLocalUser()) {
    console.error(
      "本地认证已启用但未配置启动管理员，请设置 HPM_BOOTSTRAP_ADMIN_USERNAME / HPM_BOOTSTRAP_ADMIN_PASSWORD",
    );
    process.exit(1);
  }

  const sessions = new SessionStore();
  setContext({ config, store, vault, sessions });

  const candidates = [
    path.join(__dirname, "..", "public"),
    path.join(__dirname, "..", "..", "web", "dist"),
  ];
  const publicDir = candidates.find((p) => fs.existsSync(p));

  const app = buildApp(publicDir, config.corsOrigin);

  const [host, port] = config.bind.split(":");
  app.listen(Number(port), host, () => {
    console.log(`HousePlusMail 已启动，监听 ${config.bind}`);
    console.log(`数据存储目录：${path.resolve(config.dataDir)}`);
  });
}

bootstrap().catch((err) => {
  console.error("HousePlusMail 启动失败：", err);
  process.exit(1);
});
