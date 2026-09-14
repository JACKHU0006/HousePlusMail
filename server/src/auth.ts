import crypto from "node:crypto";
import { Request, Response, NextFunction } from "express";
import { serialize, parse as parseCookie } from "cookie";
import { randomToken, verifyPassword } from "./security.js";
import { getContext } from "./context.js";
import type { User } from "./types.js";

const SESSION_COOKIE = "hpm_session";
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 天

interface SessionRecord {
  userId: string;
  csrfToken: string;
  expiresAt: number;
}

export class SessionStore {
  private sessions = new Map<string, SessionRecord>();

  create(userId: string): { token: string; csrfToken: string } {
    const token = randomToken(32);
    const csrfToken = randomToken(32);
    this.sessions.set(this.digest(token), {
      userId,
      csrfToken,
      expiresAt: Date.now() + SESSION_TTL * 1000,
    });
    return { token, csrfToken };
  }

  get(token: string): SessionRecord | undefined {
    const record = this.sessions.get(this.digest(token));
    if (!record) return undefined;
    if (record.expiresAt < Date.now()) {
      this.sessions.delete(this.digest(token));
      return undefined;
    }
    return record;
  }

  remove(token: string): void {
    this.sessions.delete(this.digest(token));
  }

  revokeUser(userId: string): void {
    for (const [key, record] of this.sessions) {
      if (record.userId === userId) this.sessions.delete(key);
    }
  }

  private digest(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }
}

export interface AuthInfo {
  userId: string;
  csrfToken: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthInfo;
    }
  }
}

export class AppError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
  static unauthorized(message = "未授权"): AppError {
    return new AppError(401, message);
  }
  static forbidden(message = "禁止访问"): AppError {
    return new AppError(403, message);
  }
  static notFound(message = "未找到"): AppError {
    return new AppError(404, message);
  }
  static validation(message: string): AppError {
    return new AppError(400, message);
  }
  static conflict(message = "资源冲突"): AppError {
    return new AppError(409, message);
  }
  static csrf(): AppError {
    return new AppError(403, "CSRF 校验失败");
  }
}

function cookieValue(headers: Record<string, unknown>, name: string): string | undefined {
  const raw = headers["cookie"];
  if (typeof raw !== "string") return undefined;
  return parseCookie(raw)[name];
}

function isHttps(req: Request): boolean {
  return req.headers["x-forwarded-proto"] === "https";
}

function sessionCookie(token: string, secure: boolean): string {
  return serialize(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: SESSION_TTL,
  });
}

function expiredCookie(): string {
  return serialize(SESSION_COOKIE, "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 0,
  });
}

function requireCsrf(req: Request, expected: string): void {
  const supplied = req.headers["x-csrf-token"];
  if (typeof supplied !== "string") throw AppError.csrf();
  if (
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  ) {
    throw AppError.csrf();
  }
}

export function requireSession(req: Request): AuthInfo {
  const token = cookieValue(req.headers as Record<string, unknown>, SESSION_COOKIE);
  if (!token) throw AppError.unauthorized();
  const record = getContext().sessions.get(token);
  if (!record) throw AppError.unauthorized();
  return { userId: record.userId, csrfToken: record.csrfToken };
}

export function requireMutation(req: Request): AuthInfo {
  const info = requireSession(req);
  requireCsrf(req, info.csrfToken);
  return info;
}

export function authRead(req: Request, _res: Response, next: NextFunction): void {
  try {
    req.auth = requireSession(req);
    next();
  } catch (err) {
    next(err);
  }
}

export function authMutate(req: Request, _res: Response, next: NextFunction): void {
  try {
    req.auth = requireMutation(req);
    next();
  } catch (err) {
    next(err);
  }
}

export function authenticated(req: Request): AuthInfo {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

export async function handleLogin(req: Request, res: Response): Promise<void> {
  const { username, password } = req.body ?? {};
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.length > 128 ||
    password.length > 4096
  ) {
    throw AppError.unauthorized();
  }
  const { store, sessions } = getContext();
  const user = store.getUserByName(username);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw AppError.unauthorized();
  }
  const { token, csrfToken } = sessions.create(user.id);
  res.setHeader("Set-Cookie", sessionCookie(token, isHttps(req)));
  res.json(sessionResponse(csrfToken, user));
}

export async function handleLogout(req: Request, res: Response): Promise<void> {
  const token = cookieValue(req.headers as Record<string, unknown>, SESSION_COOKIE);
  if (token) getContext().sessions.remove(token);
  res.setHeader("Set-Cookie", expiredCookie());
  res.status(204).end();
}

export async function handleSession(req: Request, res: Response): Promise<void> {
  const info = requireSession(req);
  const user = getContext().store.getUserById(info.userId);
  if (!user) throw AppError.unauthorized();
  res.json(sessionResponse(info.csrfToken, user));
}

export function sessionResponse(csrfToken: string, user: User) {
  return {
    authenticated: true,
    csrfToken,
    version: process.env.npm_package_version ?? "0.1.0",
    user: publicUser(user),
  };
}

export function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    hasPin: user.hasPin,
  };
}

export function authConfigResponse() {
  const { config } = getContext();
  return {
    localEnabled: config.authMode !== "oidc",
    oidcEnabled: config.authMode === "oidc" || config.authMode === "hybrid",
  };
}
