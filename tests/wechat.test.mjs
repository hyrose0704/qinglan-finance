import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { buildMorningEdition } from "../lib/morning-brief.ts";
import { buildWeChatProject } from "../scripts/build-wechat.mjs";

const require = createRequire(import.meta.url);
const parent = realpathSync(tmpdir());
const output = mkdtempSync(join(parent, "qinglan-wechat-"));
const runtime = join(output, "miniprogram");
const include = file => require(join(runtime, file));

before(async () => buildWeChatProject(output));
after(() => {
  const resolved = realpathSync(output);
  if (dirname(resolved) === parent && basename(resolved).startsWith("qinglan-wechat-")) {
    rmSync(resolved, { recursive: true, force: true });
  }
});

function sampleArchive() {
  const day = (date, close, change) => ({ date, close, open: close, low: close, high: close, change });
  const edition = buildMorningEdition({
    now: Date.parse("2026-11-20T01:10:00Z"), domestic: null,
    domesticHistory: [day("2026-11-18", 810.79, null), day("2026-11-19", 801.93, -1.09)],
    spot: [], dxy: [], nasdaq: [], news: [], sources: [],
  });
  return { version: 1, editions: [edition] };
}

test("WeChat builds every tab, shares lessons and validates market sources without browser URL or Intl globals", () => {
  const manifest = include("app.json");
  for (const { pagePath } of manifest.tabBar.list) assert.ok(manifest.pages.includes(pagePath));
  for (const page of manifest.pages) {
    for (const ext of ["js", "json", "wxml"]) assert.ok(existsSync(join(runtime, page + "." + ext)));
  }
  const module = { exports: {} };
  const js = readFileSync(join(runtime, "utils/shared.js"), "utf8");
  runInNewContext(js, { module, exports: module.exports, Intl: undefined, URL: undefined });
  const shared = module.exports;
  const archive = sampleArchive();
  const cutoff = Date.parse("2026-11-20T02:00:00Z");
  assert.equal(shared.readBriefArchive(archive, cutoff).editions.length, 1);
  archive.editions[0].movements[0].url = "https://www.sge.com.cn@other.example/";
  assert.equal(shared.readBriefArchive(archive, cutoff).editions.length, 0);
  assert.ok(shared.LESSONS.length >= 21);
  assert.equal(shared.searchKnowledge("QDII 汇率")[0].lessonId, "qdii");
});

test("native brief and editor format matched gold, pending NAV, privacy and explicitly confirmed zero", () => {
  const { editionView, number } = include("utils/view.js");
  const { EMPTY_PROFILE, createProfileDraft, saveProfileDraft } = include("utils/shared.js");
  assert.equal(number(1234.5678, 4), "1,234.5678");
  const edition = sampleArchive().editions[0];
  const empty = createProfileDraft(EMPTY_PROFILE);
  assert.ok(Object.values(empty).every(value => value === ""));
  const partial = saveProfileDraft({ ...empty, goldGrams: "10", fundUnits: "300" }, EMPTY_PROFILE);
  const view = editionView(edition, partial, false);
  assert.equal(view.impact.amount, "−¥88.60");
  assert.equal(view.impact.subtotal, true);
  assert.match(view.impact.rows[0].perUnit, /−8.86 元\/克/);
  assert.equal(view.impact.rows[1].amount, "待补行情");
  assert.equal(editionView(edition, partial, true).impact, null);
  const zero = saveProfileDraft({ ...empty, goldGrams: "10", fundUnits: "0" }, EMPTY_PROFILE);
  assert.equal(editionView(edition, zero, false).impact.subtotal, false);
  assert.equal(createProfileDraft(zero).fundUnits, "0");
});

test("WeChat sync isolates guest and account drafts and requires review of the current cloud revision", async () => {
  const storageMap = new Map();
  const storage = { getItem: key => storageMap.get(key) || null, setItem: (key, value) => storageMap.set(key, value) };
  const { EMPTY_PROFILE } = include("utils/shared.js");
  const { createProfileStore } = include("utils/profile-store.js");
  const id = "65900e69-1868-4016-8c55-970ad766639e";
  const config = { url: "https://demo.supabase.co", publishableKey: "test-public-key" };
  const profile = grams => ({ ...EMPTY_PROFILE, goldGrams: grams, filledFields: ["goldGrams"] });
  const row = (grams, revision) => ({ profile: profile(grams), revision, updated_at: "2026-11-20T01:00:00Z" });
  let remote = row(20, 1);
  let offline = false;
  const writes = [];
  const password = "test-only-private-input";
  const request = async (url, options) => {
    assert.ok(url.startsWith(config.url + "/"));
    if (url.includes("grant_type=password")) {
      assert.equal(options.data.password, password);
      return { user: { id, email: "test@example.com" }, access_token: "fixture-access", refresh_token: "fixture-refresh", expires_in: 3600 };
    }
    assert.equal(options.headers.Authorization, "Bearer fixture-access");
    if (offline) throw Error("离线");
    if (url.includes("/rpc/")) {
      writes.push(options.data);
      assert.equal(options.data.p_expected_user_id, id);
      if (options.data.p_expected_revision !== remote.revision) throw Object.assign(Error("conflict"), { code: "QF409" });
      remote = { ...row(0, remote.revision + 1), profile: options.data.p_profile };
      return remote;
    }
    if (url.includes("/rest/v1/")) return [remote];
    return null;
  };

  const store = createProfileStore(config, storage, request);
  await store.restore();
  const guest = store.editBase();
  assert.ok(await store.save(profile(7), guest));
  assert.ok(await store.signIn("test@example.com", password));
  assert.equal(store.snapshot().profile.goldGrams, 20);
  assert.equal(await store.save(profile(70), guest), false);
  assert.equal(writes.length, 0);
  assert.ok(![...storageMap.values()].some(value => value.includes(password)));

  offline = true;
  assert.ok(await store.save(profile(15), store.editBase()));
  assert.equal(store.snapshot().phase, "offline");
  assert.ok(store.snapshot().hasPending);
  remote = row(30, 2);
  offline = false;
  const restarted = createProfileStore(config, storage, request);
  await restarted.restore();
  assert.equal(restarted.snapshot().phase, "conflict");
  assert.equal(restarted.snapshot().profile.goldGrams, 15);
  assert.equal(restarted.snapshot().remoteRevision, 2);
  remote = row(35, 3);
  await restarted.refresh();
  assert.equal(await restarted.keepLocal(2), false);
  assert.equal(remote.profile.goldGrams, 35);
  assert.ok(await restarted.keepLocal(3));
  assert.equal(remote.revision, 4);
  assert.equal(remote.profile.goldGrams, 15);
  assert.ok(await restarted.signOut());
  assert.equal(restarted.snapshot().profile.goldGrams, 7);
});
