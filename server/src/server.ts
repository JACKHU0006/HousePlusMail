import express, { Request, Response, NextFunction } from "express";
import path from "node:path";
import fs from "node:fs";
import { accountsRouter } from "./accounts.js";
import { messagesRouter } from "./messages.js";
import {
  AppError,
  handleLogin,
  handleLogout,
  handleSession,
  handleRegister,
  authConfigResponse,
  authRead,
} from "./auth.js";

export function buildApp(publicDir?: string, corsOrigin?: string) {
  const app = express();

  // 跨域（拆分部署时：前端在另一个来源/子域）。
  // 允许的来源：* 或逗号分隔的来源列表。仅在显式配置时启用。
  app.use((req, res, next) => {
    if (!corsOrigin) return next();
    const reqOrigin = req.headers.origin;
    if (corsOrigin === "*") {
      res.setHeader("Access-Control-Allow-Origin", "*");
    } else if (reqOrigin && corsOrigin.split(",").map((s) => s.trim()).includes(reqOrigin)) {
      res.setHeader("Access-Control-Allow-Origin", reqOrigin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-csrf-token");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  app.use(express.json({ limit: "25mb" }));

  // 基础安全响应头
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  const api = express.Router();

  api.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      name: "houseplusmail",
      version: process.env.npm_package_version ?? "0.1.0",
    });
  });

  api.get("/auth/config", (_req, res) => res.json(authConfigResponse()));
  api.get("/session", authRead, wrap(handleSession));
  api.post("/auth/login", wrap(handleLogin));
  api.post("/auth/register", wrap(handleRegister));
  api.post("/auth/logout", wrap(handleLogout));

  api.use("/accounts", accountsRouter);
  api.use("/", messagesRouter);

  app.use("/api/v1", api);

  // 静态前端（若已构建）
  if (publicDir && fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(publicDir, "index.html"));
    });
  }

  // 统一错误处理
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err?.message ?? "服务器内部错误" });
  });

  return app;
}

function wrap(
  handler: (req: Request, res: Response) => Promise<void>,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (err) {
      next(err);
    }
  };
}

export { AppError };
