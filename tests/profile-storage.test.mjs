import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_PROFILE, DEMO } from "../lib/finance.ts";
import { PROFILE_KEY, draftRevision, localHistory, personalProfile, profileScope, readProfileCopy, reconcileProfiles, writeProfileCopy } from "../lib/profile-storage.ts";
import { emailConfirmationReturn, parseCloudConfig, readCloudRow } from "../lib/cloud-profile.ts";

const profile = { ...EMPTY_PROFILE, cash: 12345, savedAt: "2026-11-20T00:00:00.000Z" };
const copy = { profile, revision: 3, pending: true, copiedAt: profile.savedAt };
test("an open draft retains its own expected revision and cannot move to another account", () => {
  const opened = { key: "account-a", revision: 3 };
  assert.equal(draftRevision({ key: "account-a", revision: 5 }, opened), 3);
  assert.throws(() => draftRevision({ key: "account-b", revision: 3 }, opened));
  assert.throws(() => draftRevision({ key: PROFILE_KEY, revision: 0 }, opened));
});
test("email confirmation removes auth parameters, preserving the Pages path and unrelated navigation", () => {
  const site = "https://example.github.io/qinglan-finance/";
  assert.equal(emailConfirmationReturn(site + "?lesson=gold#intro"), null);
  assert.deepEqual(emailConfirmationReturn(site + "?code=sample&lesson=gold#intro"), {
    code: "sample", isError: false, cleanUrl: "/qinglan-finance/?lesson=gold#intro",
  });
  for (const suffix of ["#error=access_denied&error_code=otp_expired", "?error_description=expired", "?code=sample#error=denied"]) {
    assert.deepEqual(emailConfirmationReturn(site + suffix), { code: null, isError: true, cleanUrl: "/qinglan-finance/" });
  }
  assert.deepEqual(emailConfirmationReturn(site + "#access_token=sample&refresh_token=sample"), { code: null, isError: false, cleanUrl: "/qinglan-finance/" });
});
function memory(fail = () => false) {
  const values = new Map();
  return { getItem: key => values.get(key) || null, setItem: (key, value) => { if (fail(key)) throw new Error("Storage full"); values.set(key, value); }, values };
}

test("an unchanged storage key migrates the old saved profile without inheriting demonstration amounts", () => {
  const storage = memory(); storage.setItem(PROFILE_KEY, JSON.stringify(profile));
  const loaded = readProfileCopy(storage).copy;
  assert.equal(loaded.profile.cash, 12345); assert.equal(loaded.profile.income, 0); assert.equal(loaded.pending, false);
  writeProfileCopy(storage, { ...loaded, profile: { ...loaded.profile, cash: 999 } });
  assert.equal(readProfileCopy(storage).copy.profile.cash, 999);
});
test("a damaged or missing primary record recovers the latest valid historical copy", () => {
  const storage = memory(); writeProfileCopy(storage, copy);
  storage.setItem(PROFILE_KEY, "{damaged");
  const loaded = readProfileCopy(storage); assert.equal(loaded.recovered, true); assert.equal(loaded.copy.profile.cash, 12345);
  storage.values.delete(PROFILE_KEY); assert.equal(readProfileCopy(storage).recovered, true);
});
test("a partial write is recoverable, and a completely failed write never reports success", () => {
  const backupOnly = memory(key => key === PROFILE_KEY), mainOnly = memory(key => key.includes(":history-v1")), failed = memory(() => true);
  assert.equal(writeProfileCopy(backupOnly, copy).saved, true); assert.equal(readProfileCopy(backupOnly).copy.profile.cash, 12345);
  assert.equal(writeProfileCopy(mainOnly, copy).saved, true); assert.equal(readProfileCopy(mainOnly).copy.revision, 3);
  assert.equal(writeProfileCopy(failed, copy).saved, false);
});
test("a successful new backup wins over an old primary after a partial write, even if the clock moves backwards", () => {
  let blocked = false;
  const storage = memory(key => blocked && key === PROFILE_KEY);
  writeProfileCopy(storage, copy); blocked = true;
  const next = { ...copy, profile: { ...profile, cash: 67890 }, copiedAt: "2026-11-19T00:00:00.000Z" };
  assert.equal(writeProfileCopy(storage, next).saved, true);
  assert.equal(readProfileCopy(storage).copy.profile.cash, 67890);
  assert.equal(readProfileCopy(storage).recovered, true);
});
test("account caches and guest data are separate, history keeps ten copies, and explicit zero survives", () => {
  const storage = memory(), one = profileScope("https://one.supabase.co", "account-one"), two = profileScope("https://one.supabase.co", "account-two");
  for (let revision = 0; revision < 15; revision++) writeProfileCopy(storage, { ...copy, revision }, one);
  assert.equal(localHistory(storage, one).length, 10); assert.equal(readProfileCopy(storage, two).copy, null);
  assert.equal(readProfileCopy(storage).copy, null);
  writeProfileCopy(storage, { ...copy, profile: { ...EMPTY_PROFILE, cash: 0, filledFields: ["cash"] } }, two);
  assert.deepEqual(readProfileCopy(storage, two).copy.profile.filledFields, ["cash"]);
});
test("reconciliation preserves offline edits, detects another device, and recognizes a committed response lost in transit", () => {
  const remote = { profile: { ...profile, cash: 5678 }, revision: 3, updatedAt: profile.savedAt };
  assert.equal(reconcileProfiles(copy, remote).action, "pending");
  assert.equal(reconcileProfiles(copy, { ...remote, revision: 4 }).action, "conflict");
  assert.equal(reconcileProfiles(copy, { ...remote, profile, revision: 4 }).action, "remote");
  assert.equal(reconcileProfiles({ ...copy, pending: false }, remote).action, "remote");
  assert.equal(reconcileProfiles(null, null).remote, null);
});
test("demo data, invalid values, unsupported remote rows, and server secret keys cannot enter the profile store", () => {
  assert.throws(() => personalProfile(DEMO));
  for (const cash of [-1, NaN, Infinity, "123", 1e12]) assert.throws(() => personalProfile({ ...profile, cash }));
  const cleaned = personalProfile({ ...profile, apiKey: "must-not-be-copied", password: "must-not-be-copied" });
  assert.equal(cleaned.apiKey, undefined); assert.equal(cleaned.password, undefined);
  assert.throws(() => readCloudRow({ profile, revision: 0, updated_at: profile.savedAt }));
  assert.throws(() => parseCloudConfig({ url: "https://project.supabase.co", publishableKey: "sb_secret_private" }));
  assert.throws(() => parseCloudConfig({ url: "https://wrong.example.com", publishableKey: "sb_publishable_01234567890123456789" }));
  const encoded = part => Buffer.from(JSON.stringify(part)).toString("base64url");
  assert.throws(() => parseCloudConfig({ url: "https://project.supabase.co", publishableKey: `${encoded({})}.${encoded({ role: "service_role" })}.signature` }));
});
