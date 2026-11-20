import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { EMPTY_PROFILE } from "../lib/finance.ts";

test("database enforces private accounts, optimistic versions, bounded history and durable restart", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "qinglan-database-test-"));
  let db = new PGlite(directory);
  const first = "11111111-1111-4111-8111-111111111111", second = "22222222-2222-4222-8222-222222222222";
  const personal = { ...EMPTY_PROFILE, cash: 12345, savedAt: "2026-11-20T00:00:00.000Z" };
  let activeId = null;
  const signIn = async id => { activeId = id; await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id || ""]); await db.exec(`set role ${id ? "authenticated" : "anon"}`); };
  const save = (value, revision, expectedUser = activeId) => db.query("select public.qinglan_save_profile($1::jsonb, $2::bigint, $3::uuid) as saved", [JSON.stringify(value), revision, expectedUser]);
  try {
    await db.exec(`create schema auth; create role anon; create role authenticated;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      insert into auth.users values ('${first}'), ('${second}');`);
    await db.exec(await readFile(new URL("../supabase/migrations/202611200001_asset_profiles.sql", import.meta.url), "utf8"));
    await t.test("anonymous access and direct writes are denied", async () => {
      await signIn(null);
      await assert.rejects(db.query("select * from public.qinglan_profiles"), { code: "42501" });
      await assert.rejects(save(personal, 0), { code: "42501" });
      await signIn(first);
      await assert.rejects(db.query("insert into public.qinglan_profiles values ($1,$2,1,now())", [first, JSON.stringify(personal)]), { code: "42501" });
    });
    await t.test("users cannot read or overwrite another account", async () => {
      const saved = await save(personal, 0); assert.equal(saved.rows[0].saved.revision, 1);
      await signIn(second);
      await assert.rejects(save(personal, 0, first), { code: "QF401" });
      assert.equal((await db.query("select * from public.qinglan_profiles")).rows.length, 0);
      assert.equal((await db.query("select * from public.qinglan_profile_versions")).rows.length, 0);
      await save({ ...personal, cash: 500 }, 0);
      assert.equal((await db.query("select profile from public.qinglan_profiles")).rows[0].profile.cash, 500);
      await signIn(first);
      assert.equal((await db.query("select profile from public.qinglan_profiles")).rows[0].profile.cash, 12345);
    });
    await t.test("a stale device cannot overwrite a newly committed version", async () => {
      await save({ ...personal, cash: 13000 }, 1);
      await assert.rejects(save({ ...personal, cash: 9 }, 1), { code: "QF409" });
      assert.equal((await db.query("select profile, revision from public.qinglan_profiles")).rows[0].revision, 2);
      assert.equal((await db.query("select count(*)::int as count from public.qinglan_profile_versions")).rows[0].count, 2);
    });
    await t.test("invalid/demo records and undeclared fields are rejected transactionally", async () => {
      for (const value of [{ ...personal, mode: "demo" }, { ...personal, apiKey: "not-allowed" }, { ...personal, cash: -1 }, { ...personal, income: null }, { ...personal, emergencyMonths: 25 }, { ...personal, useGoldQuote: "true" }]) {
        await assert.rejects(save(value, 2), { code: "QF422" });
      }
      assert.equal((await db.query("select revision from public.qinglan_profiles")).rows[0].revision, 2);
    });
    await t.test("history retains twenty versions; recovery is an additional save", async () => {
      for (let revision = 2; revision < 23; revision++) await save({ ...personal, cash: revision }, revision);
      const history = await db.query("select revision from public.qinglan_profile_versions order by revision");
      assert.equal(history.rows.length, 20); assert.equal(history.rows[0].revision, 4);
      const saved = await save(personal, 23); assert.equal(saved.rows[0].saved.revision, 24);
    });
    await t.test("database restart preserves the latest profile and account isolation", async () => {
      await db.close(); db = new PGlite(directory); await signIn(first);
      const row = (await db.query("select profile,revision from public.qinglan_profiles")).rows[0];
      assert.equal(row.profile.cash, 12345); assert.equal(row.revision, 24);
      await signIn(second); assert.equal((await db.query("select profile from public.qinglan_profiles")).rows[0].profile.cash, 500);
    });
  } finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
});
