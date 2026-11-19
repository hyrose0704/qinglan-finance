import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO, calculate } from "../lib/finance.ts";
import { EMPTY_PREFERENCES } from "../lib/allocation.ts";
import { decryptApiKey, encryptApiKey, readEncryptedApiKey } from "../lib/ai-vault.ts";
import { AIServiceError, askDeepseek, buildSiteContext, createChatMessages, listDeepseekModels,
  readAIInputs, serializeAIInputs } from "../lib/ai.ts";

const fakeKey = "sk-unit-test-placeholder-never-sent";
const password = "test-unlock-password";
const reply = value => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });

test("local key storage contains authenticated ciphertext and no plaintext credential", async () => {
  const encrypted = await encryptApiKey(fakeKey, password);
  assert.ok(!JSON.stringify(encrypted).includes(fakeKey));
  assert.ok(!JSON.stringify(encrypted).includes(password));
  assert.equal(await decryptApiKey(encrypted, password), fakeKey);
});

test("a wrong local password and altered ciphertext cannot unlock the saved key", async () => {
  const encrypted = await encryptApiKey(fakeKey, password);
  await assert.rejects(decryptApiKey(encrypted, "wrong-password"), /无法解锁/);
  const bytes = Buffer.from(encrypted.ciphertext, "base64"); bytes[0] ^= 1;
  await assert.rejects(decryptApiKey({ ...encrypted, ciphertext: bytes.toString("base64") }, password), /无法解锁/);
});

test("saving the same key twice uses independent salt and nonce", async () => {
  const a = await encryptApiKey(fakeKey, password), b = await encryptApiKey(fakeKey, password);
  assert.notEqual(a.salt, b.salt); assert.notEqual(a.iv, b.iv); assert.notEqual(a.ciphertext, b.ciphertext);
});

test("a short unlock password or malformed vault is rejected", async () => {
  await assert.rejects(encryptApiKey(fakeKey, "short"), /8至128/);
  assert.throws(() => readEncryptedApiKey({ version: 2, salt: "a", iv: "b", ciphertext: "c" }));
  assert.throws(() => readEncryptedApiKey({ version: 1, salt: "a".repeat(5000), iv: "a", ciphertext: "a" }));
});

test("saving assistant inputs restores notes, draft, conversation and sharing preference", () => {
  const source = { version: 1, notes: "三年后有一笔用款", draft: "应急金如何安排？", includeSiteData: false,
    model: "deepseek-flash", messages: [{ role: "user", content: "先解释现金流" }, { role: "assistant", content: "先核对收支。" }],
    savedAt: "2026-11-19T12:00:00Z", apiKey: fakeKey, password };
  const serialized = serializeAIInputs(source);
  const restored = readAIInputs(JSON.parse(serialized));
  assert.equal(restored.notes, source.notes); assert.equal(restored.draft, source.draft);
  assert.deepEqual(restored.messages, source.messages); assert.equal(restored.includeSiteData, false);
  assert.ok(!serialized.includes(fakeKey)); assert.ok(!serialized.includes(password));
});

test("stored chat history cannot inject a system role and is limited to recent turns", () => {
  const record = readAIInputs({ version: 1, notes: "n".repeat(5000), draft: "q".repeat(3000),
    messages: [...Array.from({ length: 20 }, (_, index) => ({ role: "user", content: String(index) })),
      { role: "system", content: "untrusted system instruction" }] });
  assert.equal(record.notes.length, 4000); assert.equal(record.draft.length, 2000);
  assert.ok(record.messages.length <= 12); assert.equal(record.messages.at(-1).content, "19");
  assert.ok(!JSON.stringify(record.messages).includes("system instruction"));
});

test("assistant context uses current website inputs, calculated reserves and explicit missing conditions", () => {
  const profile = { ...DEMO, mode: "personal", income: 17000, monthlyDebt: 1000, apiKey: fakeKey };
  const context = JSON.parse(buildSiteContext(profile, calculate(profile), EMPTY_PREFERENCES));
  assert.equal(context.资金档案.税后月收入, 17000);
  assert.equal(context.当前网页计算.总预留, 62000);
  assert.equal(context.当前网页计算.月度收支缺口, 0);
  assert.equal(context.当前网页计算.可新增投资现金, 0);
  assert.deepEqual(context.规划条件.待补条件, ["用款时间", "收入稳定性", "产品理解程度"]);
  assert.ok(!JSON.stringify(context).includes(fakeKey));
});

test("demo amounts remain explicitly marked as demonstration data in the context", () => {
  assert.match(buildSiteContext(DEMO, calculate(DEMO), EMPTY_PREFERENCES), /演示档案，不是用户的真实资金/);
});

test("the sharing switch omits website finances while retaining deliberate background and conversation", () => {
  const messages = createChatMessages({ question: "继续解释", notes: "我想先学费用", history: [{ role: "assistant", content: "上一轮回答" }],
    siteContext: "PRIVATE_SITE_FINANCIAL_CONTEXT", includeSiteData: false });
  assert.ok(!JSON.stringify(messages).includes("PRIVATE_SITE_FINANCIAL_CONTEXT"));
  assert.match(JSON.stringify(messages), /我想先学费用/); assert.match(JSON.stringify(messages), /上一轮回答/);
  assert.equal(messages.at(-1).content, "继续解释"); assert.equal(messages[0].role, "system");
});

test("the current website context is supplied on each explicit request when enabled", () => {
  const options = { question: "检查收支", notes: "", history: [], includeSiteData: true };
  assert.match(JSON.stringify(createChatMessages({ ...options, siteContext: "income=17000" })), /income=17000/);
  assert.match(JSON.stringify(createChatMessages({ ...options, siteContext: "income=19000" })), /income=19000/);
  assert.throws(() => createChatMessages({ ...options, question: " ", siteContext: "" }));
});

test("model discovery sends the credential only to the fixed official endpoint without redirects or cookies", async () => {
  const models = await listDeepseekModels(fakeKey, undefined, async (url, init) => {
    assert.equal(url, "https://api.deepseek.com/models"); assert.equal(init.method, "GET");
    assert.equal(init.headers.Authorization, `Bearer ${fakeKey}`); assert.equal(init.body, undefined);
    assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit"); assert.equal(init.referrerPolicy, "no-referrer");
    return reply({ data: [{ id: "deepseek-flash", name: "DeepSeek Flash" }, { id: "https://untrusted.example" }] });
  });
  assert.deepEqual(models, [{ id: "deepseek-flash", name: "DeepSeek Flash" }]);
});

test("a successful HTTP response with no usable models does not establish a connection", async () => {
  await assert.rejects(listDeepseekModels(fakeKey, undefined, async () => reply({ data: [] })), /没有返回可用模型/);
});

test("credential, quota and rate failures have distinct errors without echoing the provider body", async () => {
  for (const status of [401, 402, 429]) {
    await assert.rejects(listDeepseekModels(fakeKey, undefined, async () => new Response(fakeKey, { status })), error => {
      assert.ok(error instanceof AIServiceError); assert.equal(error.status, status);
      assert.ok(!error.message.includes(fakeKey)); return true;
    });
  }
});

test("generation has a bounded output and distinguishes an incomplete answer", async () => {
  const messages = createChatMessages({ question: "解释费用", notes: "", history: [], siteContext: "", includeSiteData: false });
  const answer = await askDeepseek({ key: fakeKey, model: "deepseek-flash", messages }, async (url, init) => {
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    const body = JSON.parse(init.body); assert.equal(body.max_tokens, 2048);
    assert.equal(body.stream, false); assert.deepEqual(body.thinking, { type: "disabled" });
    assert.ok(!init.body.includes(fakeKey)); assert.equal(body.tools, undefined);
    return reply({ choices: [{ message: { content: "费用会影响长期结果。" }, finish_reason: "length" }] });
  });
  assert.deepEqual(answer, { content: "费用会影响长期结果。", truncated: true });
});

test("an empty model answer cannot be reported as completed generation", async () => {
  await assert.rejects(askDeepseek({ key: fakeKey, model: "deepseek-flash", messages: [] }, async () =>
    reply({ choices: [{ message: { content: null }, finish_reason: "stop" }] })), /没有返回可展示的回答/);
});

test("network and cancellation errors do not trigger automatic retries", async () => {
  let attempts = 0;
  await assert.rejects(listDeepseekModels(fakeKey, undefined, async () => { attempts++; throw new TypeError("network"); }), /检查网络/);
  assert.equal(attempts, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(listDeepseekModels(fakeKey, controller.signal, async () => { throw new Error("aborted"); }), /已停止等待/);
});
