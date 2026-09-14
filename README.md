# HousePlusMail

自托管、多用户、多邮件账户的 Web 邮件客户端。参考 [meowmail](https://github.com/ca-x/meowmail) 的架构与核心邮件功能实现，**仅保留多邮件管理器所需的能力，不含 AI / 日历 / 通讯录 / 清理规则 / MCP / 通知 等任何附加模块**。

## 特性

- **多用户**：本地账号体系，首次启动通过环境变量引导出管理员。
- **多邮件账户**：每个用户可添加多个 IMAP/SMTP 账户，密码在静态存储中以 AES-256-GCM 加密（凭据保险库）。
- **收件**：浏览邮箱文件夹、邮件列表、查看正文与附件、标记已读、删除。
- **发件**：撰写并发送邮件，自动归档到“已发送”文件夹。
- **连接测试**：添加/编辑账户时可一键测试 IMAP 与 SMTP 连通性。
- **代理**：支持直连 / HTTP / SOCKS5 代理访问邮件服务器。
- **会话安全**：HttpOnly Cookie 会话 + CSRF 防护，与 meowmail 一致。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 后端 | Node.js + Express + TypeScript（tsx 运行） |
| 邮件协议 | `imapflow`（IMAP）、`nodemailer`（SMTP）、`mailparser`（解析） |
| 前端 | React + Vite + TypeScript |
| 持久化 | 文件存储（`data/store.json`，原子写入）+ 随机密钥 `data/vault.key` |

> 说明：本仓库以 TypeScript 重新实现，以便在无 Rust 工具链的机器上直接构建运行；
> 其模块划分、账户模型、API 契约与 meowmail 保持对齐。

## 快速开始

### 1. 配置环境变量

复制 `.env.example` 为 `.env`（或由系统环境变量提供）：

```
HPM_BIND=0.0.0.0:8080
HPM_DATA_DIR=data
HPM_AUTH_MODE=local
HPM_BOOTSTRAP_ADMIN_USERNAME=admin
HPM_BOOTSTRAP_ADMIN_PASSWORD=请改成强密码
# 可选：使用固定密钥派生保险库（备份时需与数据库一起保管）
# HPM_VAULT_SECRET=一个足够长的随机字符串
# 可选：自签名证书场景跳过 TLS 校验
# HPM_INSECURE_TLS=1
```

### 2. 安装依赖并构建前端

```bash
# 前端
cd web
npm install
npm run build      # 产物输出到 ../server/public

# 后端
cd ../server
npm install
```

### 3. 启动

```bash
cd server
npm start
```

浏览器打开 `http://localhost:8080`，使用引导的管理员账号登录，进入「账户管理」添加你的第一个 IMAP/SMTP 账户即可使用。

### 开发模式

```bash
# 终端 1
cd server && npm run dev
# 终端 2
cd web && npm run dev    # Vite 开发服务器，API 已代理到 8080
```

## API 概览

所有接口前缀 `/api/v1`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| GET | `/auth/config` | 认证模式 |
| GET/POST | `/session` `/auth/login` `/auth/logout` | 会话 |
| GET/POST | `/accounts` | 列出 / 创建账户 |
| POST | `/accounts/test` | 测试草稿账户连通性 |
| PATCH/DELETE | `/accounts/:id` | 更新 / 删除账户 |
| POST | `/accounts/:id/test` | 测试已保存账户 |
| GET | `/accounts/:id/mailboxes` | 列出文件夹 |
| GET | `/accounts/:id/messages?mailbox=&limit=` | 邮件列表 |
| GET | `/accounts/:id/messages/:uid?mailbox=` | 邮件详情 |
| POST | `/accounts/:id/messages/:uid/read` | 标记已读 |
| DELETE | `/accounts/:id/messages/:uid?mailbox=` | 删除邮件 |
| POST | `/accounts/:id/send` | 发送邮件 |

## 安全说明

- 邮件账户密码使用 AES-256-GCM 加密后落盘；密钥来自 `HPM_VAULT_SECRET`（确定性派生）或 `data/vault.key`（随机生成）。
- 备份 `data/` 时请一并保管 `vault.key`（或保持 `HPM_VAULT_SECRET` 不变），否则无法解密已存密码。
- 默认 Cookie 在反向代理提供 HTTPS 时自动标记为 Secure。

## 部署

HousePlusMail 由「有状态后端 + 静态前端」组成，可按两种形态部署。

### 1. 源码托管（GitHub）

本仓库即为完整源码，可直接 `git init` / `git remote add` / `git push` 到你的 GitHub：

```bash
git init
git add -A
git commit -m "Initial HousePlusMail"
git remote add origin git@github.com:YOUR/REPO.git
git push -u origin main
```

### 2. 单实例部署（最简单）

前后端同进程、同端口（前端由后端直接托管 `server/public`）。适合任意带持久文件系统的主机：

- **Docker**（已提供 `Dockerfile`）：挂载 `/app/data` 卷保存数据，设置好环境变量后用 `docker run -p 8080:8080 -v $(pwd)/data:/app/data ...` 启动。
- **裸机 / VPS**：`npm install` 前后端 → `npm run build`（前端）→ `cd server && npm start`。

### 3. 拆分部署（前端静态托管 + 后端有状态服务）

适合「前端放 Vercel / Cloudflare Pages，后端另跑」：

- **前端** → Vercel 或 Cloudflare Pages：构建时注入 `VITE_API_BASE`（需包含 `/api/v1` 前缀）指向后端地址。

  ```
  # web/.env（或平台的环境变量）
  VITE_API_BASE=https://api.yourdomain.com/api/v1
  ```

  然后 `npm run build`，将 `web/dist`（即 `server/public`）作为静态站点发布。
- **后端** → Railway / Render / Fly.io / 任意 VPS / Cloudflare Containers（使用现有 Dockerfile）。

  > ⚠️ 后端**不能**跑在纯 Serverless 上（Vercel Functions / Cloudflare Workers）：它需要持久化文件系统（`data/store.json`、`vault.key`）以及长生命周期的 IMAP/SMTP TCP 连接，而 Serverless 不保证这两者。

### 关键环境变量

| 变量 | 用于 | 说明 |
| --- | --- | --- |
| `VITE_API_BASE` | 前端（构建时） | API 基址，含 `/api/v1`；单端口部署留空（默认相对路径） |
| `HPM_CORS_ORIGIN` | 后端 | 拆分部署时允许的前端来源，逗号分隔或 `*` |
| `HPM_BIND` / `HPM_DATA_DIR` | 后端 | 监听地址 / 数据目录 |
| `HPM_AUTH_MODE` | 后端 | `local`（本版仅实现 local） |
| `HPM_BOOTSTRAP_ADMIN_USERNAME/PASSWORD` | 后端 | 首次启动创建的管理员 |
| `HPM_VAULT_SECRET` | 后端 | 固定保险库密钥（可选，备份时需与数据一起保管） |
| `HPM_INSECURE_TLS` | 后端 | 私有 CA / 自签名证书场景跳过 TLS 校验（可选） |

### 多设备访问与 Cookie 说明

后端一旦在公网可达（公网 IP / 域名），任意设备的浏览器访问前端即可使用，邮件账户数据集中在后端，无需每台设备单独配置。

会话 Cookie 默认 `sameSite=lax` 且仅在反向代理提供 HTTPS 时标记为 `Secure`。**推荐前后端使用同一注册域的不同子域**（例如 `app.example.com` 与 `api.example.com`，二者属 same-site，`lax` Cookie 可正常发送）。若前端与后端分属不同注册域，则 `lax` Cookie 不会被发送——此时应使用同域子域方案，或后续将 Cookie 改为 `sameSite=none; Secure`（本版未实现，建议优先采用同域子域）。

## 与 meowmail 的差异

为聚焦"多邮件管理器"这一核心目标，HousePlusMail 移除了 meowmail 中的 AI 助手、CalDAV 日历、通讯录、收件规则自动化、MCP 服务、通知推送等模块，仅保留账户管理、IMAP 收发、SMTP 发送与基础会话安全。
