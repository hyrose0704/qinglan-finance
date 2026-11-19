import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, unlink, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { AccountStore } from "../local-assistant/store.mjs";
import { OpenAIAccounts, readResponseStream } from "../local-assistant/openai-account.mjs";
import { createLocalServer } from "../local-assistant/server.mjs";
import { LOCAL_ASSISTANT_ORIGIN } from "../lib/local-protocol.ts";
import { localRequest } from "../lib/local-client.ts";

const issuer = "https://auth.openai.com", origin = "https://hyrose0704.github.io";
const configuration = { issuer, authorization_endpoint: `${issuer}/api/accounts/authorize`, token_endpoint: `${issuer}/api/accounts/oauth/token`, jwks_uri: `${issuer}/.well-known/jwks.json`, revocation_endpoint: `${issuer}/oauth/revoke` };
const json = data => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
const credentials = { access_token: "fixture-access-not-real", refresh_token: "fixture-refresh-not-real", id_token: "fixture-id-not-real", scope: "openid chatgpt.tokens.use.direct", expires_in: 3600 };
function memoryStore(initial = { hostId: "urn:uuid:fixture-host", accounts: [] }) {
  let data = structuredClone(initial); return { read: async () => structuredClone(data), update: async change => { const result = await change(data); return result; } };
}
function fixture() {
  const store = memoryStore(); let nonce = "", calls = [];
  const service = new OpenAIAccounts(store, { fetcher: async (url, init) => { calls.push({ url, init }); return json(url.includes("openid-configuration") ? configuration : credentials); },
    verifyToken: async () => ({ sub: "fixture-subject", email: "test@example.invalid", nonce, chatgpt_plan_type: "pro" }) });
  return { store, service, calls, setNonce: value => { nonce = value; } };
}
async function logIn(value) {
  const auth = new URL((await value.service.startLogin("fixture-session", origin)).authUrl);
  value.setNonce(auth.searchParams.get("nonce"));
  return value.service.callback(new URLSearchParams({ state: auth.searchParams.get("state"), code: "fixture-code", client_id: "oaiapp_fixture_client" }));
}
function stream(frames, step = 7) {
  const bytes = new TextEncoder().encode(frames);
  return new ReadableStream({ start(controller) { for (let offset = 0; offset < bytes.length; offset += step) controller.enqueue(bytes.slice(offset, offset + step)); controller.close(); } });
}

test("account credentials survive restart in protected local storage", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "qinglan-store-test-")), store = new AccountStore(directory);
  try {
    await store.initialize(); const host = (await store.read()).hostId;
    await store.update(data => data.accounts.push({ accessToken: "not-a-real-test-credential" }));
    assert.equal((await new AccountStore(directory).read()).hostId, host);
    assert.equal((await store.read()).accounts[0].accessToken, "not-a-real-test-credential");
    if (process.platform === "win32") assert.ok(!(await readFile(store.file, "utf8")).includes("not-a-real-test-credential"));
    else assert.equal((await stat(store.file)).mode & 0o777, 0o600);
  } finally { await unlink(store.file); await rmdir(directory); }
});

test("local registration uses fresh state, nonce and S256 PKCE with the exact loopback callback", async () => {
  const value = fixture(), a = new URL((await value.service.startLogin("a", origin)).authUrl), b = new URL((await value.service.startLogin("b", origin)).authUrl);
  assert.equal(a.origin, issuer); assert.equal(a.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(a.searchParams.get("redirect_uri"), `${LOCAL_ASSISTANT_ORIGIN}/auth/callback`);
  assert.equal(a.searchParams.get("code_challenge_method"), "S256"); assert.notEqual(a.searchParams.get("state"), b.searchParams.get("state"));
  assert.notEqual(a.searchParams.get("nonce"), b.searchParams.get("nonce")); assert.ok(!a.searchParams.has("client_secret"));
});

test("validated login stores credentials locally but exposes only account metadata", async () => {
  const value = fixture(); assert.equal((await logIn(value)).success, true);
  const result = await value.service.status("fixture-session"); assert.equal(result.accounts[0].plan, "pro"); assert.equal(result.accounts[0].sharing, true);
  const exposed = JSON.stringify(result); assert.ok(!exposed.includes(credentials.access_token)); assert.ok(!exposed.includes(credentials.refresh_token));
  const exchange = value.calls.find(call => call.url === configuration.token_endpoint);
  assert.equal(exchange.init.body.get("client_id"), "oaiapp_fixture_client"); assert.ok(exchange.init.body.get("code_verifier"));
});

test("a replayed, expired or incorrect authorization state is rejected before token exchange", async () => {
  const value = fixture(); await logIn(value); const count = value.calls.length;
  await assert.rejects(value.service.callback(new URLSearchParams({ state: "wrong-state", code: "fixture-code" })), /回调已过期或不匹配/);
  assert.equal(value.calls.length, count);
  const auth = new URL((await value.service.startLogin("later", origin)).authUrl);
  value.service.pending.get(auth.searchParams.get("state")).expiresAt = 0;
  await assert.rejects(value.service.callback(new URLSearchParams({ state: auth.searchParams.get("state") })), /回调已过期/);
});

test("a mismatched nonce never establishes an authenticated account", async () => {
  const value = fixture(), auth = new URL((await value.service.startLogin("a", origin)).authUrl);
  value.setNonce("incorrect-nonce");
  const result = await value.service.callback(new URLSearchParams({ state: auth.searchParams.get("state"), code: "fixture-code", client_id: "oaiapp_fixture_client" }));
  assert.equal(result.success, false); assert.ok((await value.store.read()).accounts.every(account => !account.accessToken));
});

test("reauthorization reuses a saved client ID and rejects another returned registration", async () => {
  const value = fixture(); await logIn(value); const account = (await value.store.read()).accounts[0];
  const auth = new URL((await value.service.startLogin("again", origin, account.id)).authUrl);
  assert.equal(auth.searchParams.get("client_id"), "oaiapp_fixture_client"); assert.ok(!auth.searchParams.has("agent_name_hint"));
  const result = await value.service.callback(new URLSearchParams({ state: auth.searchParams.get("state"), code: "fixture-code", client_id: "oaiapp_other_client" }));
  assert.equal(result.success, false); assert.equal((await value.store.read()).accounts[0].accessToken, credentials.access_token);
});

test("rotating refresh tokens are updated together and concurrent refreshes are serialized", async () => {
  const store = memoryStore({ hostId: "host", accounts: [{ id: "a", clientId: "client", subject: "user", accessToken: "old", refreshToken: "old-refresh", expiresAt: 0, scopes: ["chatgpt.tokens.use.direct"] }] });
  let refreshes = 0;
  const service = new OpenAIAccounts(store, { fetcher: async (url, init) => {
    if (url.includes("openid-configuration")) return json(configuration);
    refreshes++; assert.equal(init.body.get("refresh_token"), "old-refresh");
    await new Promise(resolve => setTimeout(resolve, 10));
    return json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 });
  } });
  await Promise.all([service.access("a"), service.access("a")]);
  assert.equal(refreshes, 1); const account = (await store.read()).accounts[0];
  assert.equal(account.accessToken, "new-access"); assert.equal(account.refreshToken, "new-refresh");
});

test("Responses streaming supports fragmented Chinese text and CRLF frames", async () => {
  const frames = `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "连接正常。" })}\r\n\r\ndata: ${JSON.stringify({ type: "response.completed" })}\r\n\r\n`;
  assert.equal(await readResponseStream(stream(frames, 1)), "连接正常。");
});

test("partial output, usage-limit failures and incomplete turns are not reported as success", async () => {
  const partial = `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "部分" })}\n\n`;
  await assert.rejects(readResponseStream(stream(partial)), /没有收到完整回答/);
  await assert.rejects(readResponseStream(stream(partial + `data: ${JSON.stringify({ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } })}\n\n`)), /套餐使用受限/);
  await assert.rejects(readResponseStream(stream(`data: {"type":"response.incomplete"}\n\n`)), /未完整结束/);
});

test("local inference uses only the official Responses endpoint without filesystem or tool access", async () => {
  const value = fixture(); await logIn(value); const account = (await value.store.read()).accounts[0];
  value.service.fetcher = async (url, init) => {
    assert.ok(!url.includes("backend-api"));
    if (url.endsWith("/models")) return json({ models: [{ slug: "fixture-model", display_name: "Fixture", visibility: "list" }, { slug: "hidden", visibility: "hidden" }] });
    assert.equal(url, "https://api.openai.com/v1/responses"); const body = JSON.parse(init.body);
    assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.instructions, "教育解释");
    assert.ok(body.input.every(item => item.role !== "system")); assert.equal(body.tools, undefined);
    return new Response(stream('data: {"type":"response.output_text.delta","delta":"已连接"}\n\ndata: {"type":"response.completed"}\n\n'));
  };
  const result = await value.service.respond(account.id, "fixture-model", [{ role: "system", content: "教育解释" }, { role: "user", content: "你好" }]);
  assert.equal(result.content, "已连接"); assert.ok((await value.store.read()).accounts[0].lastCompletedAt);
});

test("the loopback server requires explicit pairing and rejects unrelated web origins", async () => {
  const server = createLocalServer({ status: async () => ({ accounts: [] }) }, { port: 0 });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const unauth = await fetch(`${base}/api/status`, { headers: { Origin: origin } }); assert.equal(unauth.status, 401);
    const forbidden = await fetch(`${base}/health`, { method: "OPTIONS", headers: { Origin: "https://unrelated.example" } });
    assert.equal(forbidden.status, 403); assert.equal(forbidden.headers.get("access-control-allow-origin"), null);
    const opened = await fetch(`${base}/connect?origin=${encodeURIComponent(origin)}&state=fixture-state-1234567890`);
    const html = await opened.text(), nonce = html.match(/name="nonce" value="([^"]+)"/)[1];
    const claimRequest = source => fetch(`${base}/connect/claim`, { method: "POST", headers: { Origin: source, "Content-Type": "application/json" }, body: JSON.stringify({ state: new URL(opened.url).searchParams.get("state") }) });
    assert.deepEqual(await (await claimRequest(origin)).json(), { pending: true });
    const approval = await fetch(`${base}/connect/approve`, { method: "POST", headers: { Origin: LOCAL_ASSISTANT_ORIGIN, Cookie: `qinglan_pair=${nonce}`, "Content-Type": "application/x-www-form-urlencoded" }, body: `nonce=${nonce}` });
    const confirmation = await approval.text(), session = confirmation.match(/"token":"([^"]+)"/)[1];
    assert.equal((await claimRequest("https://unrelated.example")).status, 403);
    assert.equal((await (await claimRequest(origin)).json()).token, session);
    assert.deepEqual(await (await claimRequest(origin)).json(), { pending: true });
    const allowed = await fetch(`${base}/api/status`, { headers: { Origin: origin, Authorization: `Bearer ${session}` } });
    assert.equal(allowed.status, 200); assert.deepEqual(await allowed.json(), { accounts: [] });
    const repeated = await fetch(`${base}/connect/approve`, { method: "POST", headers: { Origin: LOCAL_ASSISTANT_ORIGIN, Cookie: `qinglan_pair=${nonce}` }, body: `nonce=${nonce}` }); assert.equal(repeated.status, 403);
    const wrongHost = await new Promise(resolve => { const req = http.get(`${base}/health`, { headers: { Host: "unrelated.example" } }, response => { response.resume(); resolve(response.statusCode); }); req.on("error", () => resolve(0)); });
    assert.equal(wrongHost, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("browser requests use only the fixed loopback address and do not persist provider tokens", async () => {
  const result = await localRequest("fixture-local-connection", "/api/status", undefined, undefined, async (url, init) => {
    assert.equal(url, `${LOCAL_ASSISTANT_ORIGIN}/api/status`); assert.equal(init.headers.Authorization, "Bearer fixture-local-connection");
    assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error"); return json({ accounts: [] });
  });
  assert.deepEqual(result, { accounts: [] });
  await assert.rejects(localRequest("fixture", "https://unrelated.example/"), /地址无效/);
});
