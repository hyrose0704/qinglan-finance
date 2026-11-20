import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_PROFILE } from "../lib/finance.ts";
import { PROFILE_KEY, localHistory, readProfileCopy, writeProfileCopy } from "../lib/profile-storage.ts";

const copiedAt = "2026-11-20T01:00:00.000Z";
const profile = { ...EMPTY_PROFILE, cash: 500, filledFields: ["cash"] };
const first = { profile, revision: 1, pending: false, copiedAt };
const second = { ...first, revision: 2 };
const historyKey = PROFILE_KEY + ":history-v1";
function memory() {
  const entries = new Map();
  return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
}

test("reloading a confirmed cloud revision preserves older records and keeps copies in sequence", () => {
  const storage = memory();
  writeProfileCopy(storage, first);
  writeProfileCopy(storage, second);
  const originalSequence = readProfileCopy(storage).copy.sequence;
  for (let read = 0; read < 20; read++) writeProfileCopy(storage, second);
  const rows = localHistory(storage);
  assert.deepEqual(rows.map(row => row.revision), [1, 2]);
  assert.ok(rows[1].sequence >= originalSequence);
  assert.deepEqual(readProfileCopy(storage).copy, rows[1]);
});

test("reloading repairs a damaged primary or history even when the cloud revision is unchanged", () => {
  const storage = memory();
  writeProfileCopy(storage, first);
  writeProfileCopy(storage, second);
  storage.entries.set(PROFILE_KEY, "{broken");
  assert.equal(readProfileCopy(storage).recovered, true);
  writeProfileCopy(storage, second);
  assert.equal(readProfileCopy(storage).recovered, false);
  assert.deepEqual(localHistory(storage).map(row => row.revision), [1, 2]);
  storage.entries.set(historyKey, "{broken");
  writeProfileCopy(storage, second);
  assert.deepEqual(localHistory(storage), [readProfileCopy(storage).copy]);
});

test("explicit pending, different values, new revisions and guest saves retain their history", () => {
  const storage = memory();
  const edited = { ...second, profile: { ...profile, cash: 0, filledFields: ["cash"] } };
  const omitted = { ...edited, profile: { ...edited.profile, filledFields: [] } };
  const records = [first, second, { ...second, pending: true }, second, edited, omitted];
  for (const row of records) writeProfileCopy(storage, row);
  const rows = localHistory(storage);
  assert.equal(rows.length, records.length);
  assert.equal(rows[2].pending, true);
  assert.equal(rows[4].profile.cash, 0);
  assert.deepEqual(rows[5].profile.filledFields, []);

  const guest = memory();
  guest.setItem(PROFILE_KEY, JSON.stringify(profile));
  const original = readProfileCopy(guest).copy;
  assert.equal(original.revision, 0);
  writeProfileCopy(guest, original);
  writeProfileCopy(guest, original);
  assert.equal(localHistory(guest).length, 2);
});
