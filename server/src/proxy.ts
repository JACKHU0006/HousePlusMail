import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import { SocksClient } from "socks";
import type { ProxyKind } from "./types.js";

export interface ProxyConfig {
  kind: ProxyKind;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
}

// 自托管场景下允许跳过 TLS 证书校验（如私有 CA / 自签名证书）。
export function insecureTls(): boolean {
  const v = process.env.HPM_INSECURE_TLS;
  return v === "1" || v === "true";
}

export function tlsOptions(): tls.ConnectionOptions {
  return insecureTls() ? { rejectUnauthorized: false } : {};
}

// 建立到目标 host:port 的 TCP 连接，必要时经过代理。
export async function connectTcp(
  host: string,
  port: number,
  proxy?: ProxyConfig,
): Promise<net.Socket> {
  if (!proxy || proxy.kind === "direct") {
    return new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect(port, host, () => resolve(s));
      s.once("error", reject);
    });
  }
  if (proxy.kind === "socks5") {
    const res = await SocksClient.createConnection({
      proxy: {
        host: proxy.host!,
        port: proxy.port!,
        type: 5,
        userId: proxy.username,
        password: proxy.password,
      },
      command: "connect",
      destination: { host, port },
    });
    return res.socket as net.Socket;
  }
  // HTTP CONNECT 代理
  return httpConnect(host, port, proxy);
}

function httpConnect(
  host: string,
  port: number,
  proxy: ProxyConfig,
): Promise<net.Socket> {
  return new Promise<net.Socket>((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (proxy.username && proxy.password) {
      const token = Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64");
      headers["Proxy-Authorization"] = `Basic ${token}`;
    }
    const req = http.request({
      host: proxy.host,
      port: proxy.port,
      method: "CONNECT",
      path: `${host}:${port}`,
      headers,
      timeout: 20000,
    });
    req.on("connect", (res, socket) => {
      if (res.statusCode === 200) resolve(socket as net.Socket);
      else {
        socket.destroy();
        reject(new Error(`HTTP 代理 CONNECT 失败：${res.statusCode}`));
      }
    });
    req.once("error", reject);
    req.end();
  });
}

export function wrapTls(
  socket: net.Socket,
  servername: string,
  options: tls.ConnectionOptions = {},
): tls.TLSSocket {
  return tls.connect({ socket, servername, ...options });
}
