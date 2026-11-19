import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LOCAL_ASSISTANT_ORIGIN, LOCAL_ASSISTANT_PORT, LOCAL_WEB_ORIGINS } from "../lib/local-protocol.ts";
import { AccountStore } from "./store.mjs";
import { LocalAIError, OpenAIAccounts } from "./openai-account.mjs";

const token = () => randomBytes(32).toString("base64url");
const escape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const same = (a, b) => typeof a === "string" && typeof b === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const root = fileURLToPath(new URL("../dist/", import.meta.url));

async function readBody(request) {
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > 500000) throw new LocalAIError("请求内容过大。", 413); chunks.push(chunk); }
  const body = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(body || "{}"); } catch { throw new LocalAIError("请求格式无效。"); }
}

function page(response, title, content, script = "") {
  const nonce = token(); response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
  response.end(`<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{font:16px/1.9 system-ui,'Microsoft YaHei',sans-serif;background:#f1f6f3;color:#294f3b;margin:0;padding:40px 22px}main{max-width:620px;margin:auto;padding:30px;background:white;border:1px solid #d7e5db;border-radius:12px}h1{font-size:25px}button,a{font:inherit;color:#316747}button{background:#316747;color:white;border:0;border-radius:7px;padding:12px 20px;cursor:pointer}small{font-size:14px;color:#5d7465}code{overflow-wrap:anywhere}</style><main><h1>${escape(title)}</h1>${content}</main>${script ? `<script nonce="${nonce}">${script}</script>` : ""}</html>`);
}

export function createLocalServer(accounts, { port = LOCAL_ASSISTANT_PORT, staticRoot = root } = {}) {
  const sessions = new Map(), approvals = new Map(); let busy = false;
  const server = http.createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store"); response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    const origin = request.headers.origin, allowed = LOCAL_WEB_ORIGINS.includes(origin);
    const send = (value, status = 200) => { response.statusCode = status; response.setHeader("Content-Type", "application/json; charset=utf-8"); response.end(JSON.stringify(value)); };
    try {
      const expectedHost = `127.0.0.1:${port || server.address()?.port}`;
      if (request.headers.host !== expectedHost) throw new LocalAIError("仅接受本机地址访问。", 403);
      const url = new URL(request.url, LOCAL_ASSISTANT_ORIGIN);
      if (allowed) {
        response.setHeader("Access-Control-Allow-Origin", origin); response.setHeader("Vary", "Origin");
        response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS"); response.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
        response.setHeader("Access-Control-Allow-Private-Network", "true");
      }
      if (request.method === "OPTIONS") { if (!allowed) throw new LocalAIError("来源网站未获允许。", 403); response.statusCode = 204; response.end(); return; }
      if (url.pathname === "/health" && request.method === "GET") { if (origin && !allowed) throw new LocalAIError("来源未获允许。", 403); send({ app: "qinglan-local-assistant", version: 1 }); return; }
      if (url.pathname === "/connect" && request.method === "GET") {
        const targetOrigin = url.searchParams.get("origin"), state = url.searchParams.get("state");
        if (!LOCAL_WEB_ORIGINS.includes(targetOrigin) || !/^[\w-]{20,80}$/.test(state || "")) throw new LocalAIError("连接请求不符合预期。", 403);
        for (const [key, value] of approvals) if (value.expiresAt < Date.now()) approvals.delete(key);
        if (approvals.size >= 20) throw new LocalAIError("连接请求过多，请稍后重试。", 429);
        const nonce = token(); approvals.set(nonce, { origin: targetOrigin, state, expiresAt: Date.now() + 120000 });
        response.setHeader("Set-Cookie", `qinglan_pair=${nonce}; HttpOnly; SameSite=Strict; Path=/connect; Max-Age=120`);
        page(response, "连接青览本机助手", `<p>允许 <code>${escape(targetOrigin)}</code> 在本机发起官方账号授权、查看本机保存的AI账号，并在你点击发送时使用所选账号。</p><p>OpenAI登录凭证保留在本机程序中。网页只接收本次连接凭证与账号显示信息。</p><form method="post" action="/connect/approve"><input type="hidden" name="nonce" value="${nonce}"><button>允许本次连接</button></form><p><small>只连接你信任的青览页面。关闭窗口可取消。</small></p>`); return;
      }
      if (url.pathname === "/connect/approve" && request.method === "POST") {
        if (origin !== LOCAL_ASSISTANT_ORIGIN) throw new LocalAIError("本机连接确认来源无效。", 403);
        let body = ""; for await (const chunk of request) { body += chunk; if (body.length > 1000) throw new LocalAIError("确认请求无效。"); }
        const nonce = new URLSearchParams(body).get("nonce"), cookie = request.headers.cookie?.split(";").map(item => item.trim()).find(item => item.startsWith("qinglan_pair="))?.slice(13);
        const approval = approvals.get(nonce);
        if (!approval || approval.expiresAt < Date.now() || !same(cookie, nonce)) throw new LocalAIError("连接确认已过期，请从青览重新连接。", 403);
        approvals.delete(nonce); const session = token(); sessions.set(session, { origin: approval.origin, expiresAt: Date.now() + 8 * 3600000 });
        const message = JSON.stringify({ type: "qinglan-local-connected", state: approval.state, token: session }).replaceAll("<", "\\u003c");
        page(response, "本机连接已允许", "<p>请返回青览页面，选择账号或继续官方登录。</p>", `if(window.opener){window.opener.postMessage(${message},${JSON.stringify(approval.origin)});window.close();}`); return;
      }
      if (url.pathname === "/auth/callback" && request.method === "GET") {
        const result = await accounts.callback(url.searchParams);
        page(response, result.success ? "账号授权已完成" : "账号授权未完成", `<p>${escape(result.error || "账号已由本机程序保存，请返回青览查看模型和连接状态。")}</p>`,
          `if(window.opener)window.opener.postMessage({type:"qinglan-login-updated"},${JSON.stringify(result.origin)});`); return;
      }
      if (url.pathname.startsWith("/api/")) {
        const authorization = request.headers.authorization || "", sessionToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
        const session = sessions.get(sessionToken);
        if (!allowed || !session || session.origin !== origin || session.expiresAt < Date.now()) throw new LocalAIError("本机连接未建立或已过期，请重新连接本机助手。", 401);
        if (request.method === "GET" && url.pathname === "/api/status") { send(await accounts.status(sessionToken)); return; }
        if (request.method === "GET" && url.pathname === "/api/models") { send({ models: await accounts.listModels(url.searchParams.get("accountId")) }); return; }
        if (request.method !== "POST" || !request.headers["content-type"]?.startsWith("application/json")) throw new LocalAIError("请求方法或类型无效。", 405);
        const body = await readBody(request);
        if (url.pathname === "/api/login") { send(await accounts.startLogin(sessionToken, origin, body.accountId || null)); return; }
        if (url.pathname === "/api/account/disconnect") { send(await accounts.disconnect(body.accountId)); return; }
        if (url.pathname === "/api/session/close") { sessions.delete(sessionToken); send({ closed: true }); return; }
        if (url.pathname === "/api/chat") {
          if (busy) throw new LocalAIError("本机助手正在处理一个问题，请完成后再发送。", 429);
          busy = true; const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 180000);
          response.once("close", () => { if (!response.writableEnded) controller.abort(); });
          try { send(await accounts.respond(body.accountId, body.model, body.messages, controller.signal)); }
          finally { busy = false; clearTimeout(timer); }
          return;
        }
        throw new LocalAIError("未找到该本机操作。", 404);
      }
      if (url.pathname.startsWith("/qinglan-finance/") && request.method === "GET") {
        const relative = url.pathname.slice("/qinglan-finance/".length) || "index.html";
        const file = path.resolve(staticRoot, relative), directory = path.resolve(staticRoot) + path.sep;
        if (!file.startsWith(directory) || relative.includes("..")) throw new LocalAIError("文件路径无效。", 403);
        const extension = path.extname(file); if (![".html", ".js", ".css", ".json", ".svg", ".png", ".ico"].includes(extension)) throw new LocalAIError("文件类型不可用。", 404);
        const data = await readFile(file); response.setHeader("Content-Type", ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" })[extension]); response.end(data); return;
      }
      page(response, "青览本机助手正在运行", `<p>回到青览网站，在“个人中心”点击“连接本机助手”，确认连接后再进行官方登录。</p><p>也可以<a href="/qinglan-finance/">打开本机版青览</a>。本机版与在线版的浏览器档案分别保存。</p><p><small>本程序只监听127.0.0.1，不向局域网或公网提供账号服务。</small></p>`);
    } catch (error) {
      if (response.headersSent) { response.end(); return; }
      const message = error instanceof LocalAIError ? error.message : error.code === "ENOENT" ? "本机网页尚未构建，请先运行 npm run build。" : "本机操作暂未完成，请稍后重试或重新授权。";
      send({ error: message }, error instanceof LocalAIError ? error.status : 500);
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const store = new AccountStore(); await store.initialize();
  const server = createLocalServer(new OpenAIAccounts(store));
  server.on("error", error => { console.error(error.code === "EADDRINUSE" ? "青览本机助手端口已被占用，请先检查是否已启动。" : "本机助手未能启动。"); process.exitCode = 1; });
  server.listen(LOCAL_ASSISTANT_PORT, "127.0.0.1", () => console.log(`青览本机助手已启动：${LOCAL_ASSISTANT_ORIGIN}\n请在青览个人中心连接并完成官方登录。关闭此进程可停止本机连接。`));
}
