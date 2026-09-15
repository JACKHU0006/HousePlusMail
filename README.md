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

### 1. 单实例部署（最简单）

前后端同进程、同端口（前端由后端直接托管 `server/public`）。适合任意带持久文件系统的主机：

- **Docker**（已提供 `Dockerfile`）：挂载 `/app/data` 卷保存数据，设置好环境变量后启动：

  ```bash
  docker build -t houseplusmail .
  docker run -d --name hpm -p 8080:8080 \
    -v $(pwd)/data:/app/data \
    -e HPM_BOOTSTRAP_ADMIN_USERNAME=admin \
    -e HPM_BOOTSTRAP_ADMIN_PASSWORD='改成强密码' \
    houseplusmail
  ```

- **裸机 / VPS**：

  ```bash
  cd web && npm install && npm run build && cd ..
  cd server && npm install && npm start
  ```

### 2. 拆分部署（前端静态托管 + 后端有状态服务）

适合「前端放 Vercel / Cloudflare Pages，后端另跑」。无论哪家风前/后端，核心三件事：
1. 前端构建时注入 `VITE_API_BASE=https://<后端地址>/api/v1`；
2. 后端设置 `HPM_CORS_ORIGIN=https://<前端地址>`；
3. 前后端用**同一注册域的不同子域**（如 `app.example.com` + `api.example.com`）以避免跨域 Cookie 问题。

> ⚠️ 后端**不能**跑在纯 Serverless 上（Vercel Functions / Cloudflare Workers）：它需要持久化文件系统（`data/store.json`、`vault.key`）以及长生命周期的 IMAP/SMTP TCP 连接，而 Serverless 不保证这两者。

#### 推荐组合

> 本仓库采用 **Cloudflare Pages（前端）+ Render 免费档（后端）**：前端免费托管，后端零成本、Docker 原生、自带持久盘。代价是 Render 免费档 **15 分钟无访问会休眠、首次访问约 30 秒冷启动**（适合自用、访问不频繁）；若要常驻不休眠，改用 **Railway**（约 $5/月）。Cloudflare Containers 需 **Workers Paid 付费计划**，故不作为首选。

- **零成本、长期可用（本仓库采用）**：前端 **Cloudflare Pages**（免费）+ 后端 **Render 免费档**。两者都免费；后端休眠时首次访问稍慢，醒来后正常使用。
- **常驻不休眠（付费备选）**：前端 **Cloudflare Pages** + 后端 **Railway**（约 $5/月），适合希望随时秒开、不接受冷启动的场景。
- **单厂商、Cookie 最省心（备选）**：前端 **Cloudflare Pages** + 后端 **Cloudflare Containers**，但需 **Workers Paid 付费**，且较新、状态持久化成熟度略低。
- **预算敏感**：可用 **Render** 替代 Railway（免费档即可；本项目连接为「按需建连」而非长空闲连接，休眠唤醒的冷启动可接受）。
- **不推荐 Fly.io**：多区域基础设施能力超出本项目所需，配置更重，性价比不高。

#### 2.0 推荐路径：Cloudflare Pages + Cloudflare Containers（同域部署）

> ⚠️ **Cloudflare Containers 需要 Workers Paid 付费计划**，常驻会产生按量费用。本仓库采用 **Cloudflare Pages + Render 免费档**（零成本，但免费档会休眠、冷启动约 30 秒）；若需常驻不休眠，改用 **Railway**（见 §2.3，约 $5/月）。

前后端都放在 Cloudflare、使用同一注册域的两个子域，Cookie 同站、部署与运维最省心：

```
app.yourdomain.com   ── Cloudflare Pages        （静态前端，构建时注入 VITE_API_BASE）
api.yourdomain.com   ── Cloudflare Containers    （Docker 后端，持久卷挂 /app/data）
       两者同属 yourdomain.com → same-site，会话 Cookie 可正常跨子域发送
```

**① 前端（Pages）**
1. Cloudflare 控制台 → Workers & Pages → 创建 **Pages** 项目 → 连接 GitHub 仓库 `JACKHU0006/HousePlusMail`。
2. 构建设置：构建目录 `web`；构建命令 `npm install && npx vite build --outDir dist`；输出目录 `dist`；环境变量 `VITE_API_BASE=https://api.yourdomain.com/api/v1`。
3. 部署后在「自定义域」绑定 `app.yourdomain.com`。

**② 后端（Containers）**
> Cloudflare Containers 目前为 Beta，控制台流程可能变化，以下为要点，具体以 Cloudflare 当前文档为准。

1. Cloudflare 控制台 → **Containers** → 新建容器，选择本仓库根目录的 `Dockerfile`。
2. 配置：监听端口 `8080`（Dockerfile 已 `EXPOSE 8080`）；挂持久卷到 `/app/data`（存放 `store.json` 与 `vault.key`）；环境变量：
   - `HPM_BIND=0.0.0.0:8080`
   - `HPM_BOOTSTRAP_ADMIN_USERNAME` / `HPM_BOOTSTRAP_ADMIN_PASSWORD`（请改强密码）
   - `HPM_CORS_ORIGIN=https://app.yourdomain.com`
3. 部署后在「自定义域」绑定 `api.yourdomain.com`。

示意 `wrangler.toml`（以 Cloudflare 当前文档为准）：

```toml
name = "houseplusmail"
pages_build = { dir = "web/dist" }
[[containers]]
name = "hpm-backend"
image = { dockerfile = "Dockerfile" }
port = 8080
volume = { name = "hpm-data", mount = "/app/data" }
```

**③ DNS 与 Cookie**
在 Cloudflare DNS 中为 `app` 与 `api` 各加一条记录指向各自的部署（绑定自定义域时通常会自动配置 CNAME）。两个子域同属 `yourdomain.com`，`sameSite=lax` 的会话 Cookie 即可在前后端间正常发送，多设备登录无碍。

#### 2.1 前端 → Vercel（备选）

在 Vercel 导入本仓库，设置：
- **Root Directory**：`web`
- **Build Command**：`npm install && npx vite build --outDir dist`
- **Output Directory**：`dist`
- **Environment Variable**：`VITE_API_BASE=https://<你的后端地址>/api/v1`

#### 2.2 前端 → Cloudflare Pages

在 Cloudflare Pages 创建项目并连接本仓库，设置：
- **构建目录（根目录）**：`web`
- **构建命令**：`npm install && npx vite build --outDir dist`
- **构建输出目录**：`dist`
- **环境变量**：`VITE_API_BASE=https://<你的后端地址>/api/v1`

#### 2.3 后端 → Railway

1. 新建 Project → Deploy from GitHub repo `JACKHU0006/HousePlusMail`（或你自己的 fork）。
2. 选择 **Deploy a Dockerfile**（仓库根目录已包含）。
3. Variables 中添加：
   - `HPM_BIND=0.0.0.0:8080`
   - `HPM_BOOTSTRAP_ADMIN_USERNAME` / `HPM_BOOTSTRAP_ADMIN_PASSWORD`（强密码）
   - `HPM_CORS_ORIGIN=https://<你的前端地址>`
4. 在 Volume 中挂一块持久盘到 `/app/data`（Railway 会自动映射 `HPM_DATA_DIR=/app/data`）。
5. 部署后在 Railway **Settings → Domains** 添加自定义域 `api.ccwu.cc`，并在 `ccwu.cc` 的 DNS（dnshe.org）里把 `api` 的 CNAME 指向 Railway 提供的目标。
6. 本项目采用示例：前端地址 `hpmail.ccwu.cc`，后端地址 `api.ccwu.cc`；故 `VITE_API_BASE=https://api.ccwu.cc/api/v1`，`HPM_CORS_ORIGIN=https://hpmail.ccwu.cc`。

#### 2.4 后端 → Render（免费档，本仓库采用）

> Render 免费档 **会休眠**：15 分钟无访问即停止，下次访问冷启动约 30 秒。对自用、访问不频繁足够；若要常驻不休眠请改用 Railway。

1. Render 控制台 → **New → Web Service** → 连接本仓库 `JACKHU0006/HousePlusMail`。
2. **Runtime** 选 **Docker**（使用仓库根目录 `Dockerfile`）。
3. **Environment** 中添加：
   - `HPM_BIND=0.0.0.0:8080`
   - `HPM_BOOTSTRAP_ADMIN_USERNAME` / `HPM_BOOTSTRAP_ADMIN_PASSWORD`（强密码）
   - `HPM_CORS_ORIGIN=https://hpmail.ccwu.cc`
4. **Disk** 中挂载一块持久盘到 `/app/data`（存 `store.json` 与 `vault.key`）。
5. 部署后生成 `*.onrender.com` 地址；进入 **Settings → Custom Domain** 添加 `api.ccwu.cc`，并在 **`ccwu.cc` 的 DNS（dnshe.org）** 里把 `api` 的 CNAME 指向 Render 提供的目标。
6. 本项目采用示例：前端 `VITE_API_BASE=https://api.ccwu.cc/api/v1`，后端 `HPM_CORS_ORIGIN=https://hpmail.ccwu.cc`。

#### 2.5 后端 → Fly.io / 任意 VPS / Cloudflare Containers

- Fly.io：`fly launch`（自动识别 Dockerfile）→ `fly volumes create hpm_data --size 1` → 在 `fly.toml` 中把 `/app/data` 挂到该卷 → `fly deploy`。
- Cloudflare Containers：直接部署仓库 Dockerfile，挂持久存储到 `/app/data`，对外暴露 8080。
- 自有 VPS：同「单实例部署」的 Docker 命令，前置 Nginx/Caddy 反代并配置 HTTPS 即可。

### 关键环境变量

| 变量 | 用于 | 说明 |
| --- | --- | --- |
| `VITE_API_BASE` | 前端（构建时） | API 基址，含 `/api/v1`；单端口部署留空（默认相对路径） |
| `HPM_CORS_ORIGIN` | 后端 | 拆分部署时允许的前端来源，逗号分隔或 `*` |
| `HPM_BIND` / `HPM_DATA_DIR` | 后端 | 监听地址 / 数据目录（Dockerfile 已设为 `0.0.0.0:8080` / `/app/data`） |
| `HPM_AUTH_MODE` | 后端 | `local`（本版仅实现 local） |
| `HPM_BOOTSTRAP_ADMIN_USERNAME/PASSWORD` | 后端 | 首次启动创建的管理员 |
| `HPM_VAULT_SECRET` | 后端 | 固定保险库密钥（可选，备份时需与数据一起保管） |
| `HPM_INSECURE_TLS` | 后端 | 私有 CA / 自签名证书场景跳过 TLS 校验（可选） |

### 多设备访问与 Cookie 说明

后端一旦在公网可达（公网 IP / 域名），任意设备的浏览器访问前端即可使用，邮件账户数据集中在后端，无需每台设备单独配置。

会话 Cookie 默认 `sameSite=lax` 且仅在反向代理提供 HTTPS 时标记为 `Secure`。**推荐前后端使用同一注册域的不同子域**（例如 `app.example.com` 与 `api.example.com`，二者属 same-site，`lax` Cookie 可正常发送）。若前端与后端分属不同注册域，则 `lax` Cookie 不会被发送——此时应使用同域子域方案，或后续将 Cookie 改为 `sameSite=none; Secure`（本版未实现，建议优先采用同域子域）。

## 相关文档

- **[部署指南](部署指南.md)** —— 一步步把 HousePlusMail 部署上云（推荐组合 B：Cloudflare Pages + Cloudflare Containers，含单实例 Docker 备用方案、环境变量表、排错）。
- **[使用说明](使用说明.md)** —— 面向使用者的完整手册：登录、添加邮件账户（含 Gmail/QQ/163/Outlook 的 IMAP/SMTP 与授权码说明）、收发与回复转发、附件、多设备、安全备份与已知限制。

## 与 meowmail 的差异

为聚焦"多邮件管理器"这一核心目标，HousePlusMail 移除了 meowmail 中的 AI 助手、CalDAV 日历、通讯录、收件规则自动化、MCP 服务、通知推送等模块，仅保留账户管理、IMAP 收发、SMTP 发送与基础会话安全。
