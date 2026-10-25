import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,storage to authenticated;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
grant select,insert,delete on storage.objects to authenticated;
create publication supabase_realtime;
`);
const migrations = new URL('../supabase/migrations/', import.meta.url);
for (const file of (await readdir(migrations)).filter(file => file.endsWith('.sql')).sort()) {
  await db.exec(await readFile(new URL(file, migrations), 'utf8'));
}
const alice = "00000000-0000-4000-8000-000000000001",
  bob = "00000000-0000-4000-8000-000000000002",
  eve = "00000000-0000-4000-8000-000000000003";
for (const [id, name] of [
  [alice, "Alice"],
  [bob, "Bob"],
  [eve, "Eve"],
])
  await db.query(
    "insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",
    [id, `${name.toLowerCase()}@example.test`, { displayName: name }],
  );
async function as(id) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function api(method, path, query = {}, payload = {}) {
  return (
    await db.query("select public.grocery_api($1,$2,$3,$4) as value", [
      method,
      path,
      query,
      payload,
    ])
  ).rows[0].value;
}
await as(alice);
const spaces = await api("GET", "/api/spaces");
assert.equal(spaces.length, 2);
const household = spaces.find((s) => s.kind === "household"),
  personal = spaces.find((s) => s.kind === "private");
const receipt = await api(
  "POST",
  "/api/receipts",
  {},
  {
    spaceId: household.id,
    merchant: "QA Store",
    total: 9,
    purchaseDate: "2026-10-25",
    purchaseTime: "23:45",
    timezone: "America/New_York",
    items: [
      {
        name: "Milk",
        linePrice: 4,
        quantity: 2,
        measureAmount: 1,
        measureUnit: "l",
      },
      { name: "Eggs", linePrice: 5, quantity: 1, packCount: 12 },
    ],
  },
);
assert.equal(receipt.purchaseInstant, "2026-10-26T03:45:00+00:00");
assert.equal(receipt.items[0].unitPrice, 2);
assert.equal(receipt.items[1].unitPriceUnit, "egg");
const invite = await api("POST", `/api/spaces/${household.id}/invitations`);
await as(eve);
for (const [method, path, query, payload] of [
  ["GET", "/api/receipts", { spaceId: household.id }],
  ["GET", `/api/receipts/${receipt.id}/photo`],
  ["PATCH", `/api/receipts/${receipt.id}`, {}, { total: 1 }],
  ["DELETE", `/api/receipts/${receipt.id}`],
  ["GET", `/api/spaces/${household.id}/members`],
  ["PATCH", `/api/spaces/${household.id}/settings`, {}, { budget: 1 }],
  ["GET", "/api/backup", { spaceId: household.id }],
  [
    "POST",
    "/api/backup/restore",
    {},
    {
      spaceId: household.id,
      format: "groceries-tracker-backup-v1",
      receipts: [],
    },
  ],
])
  await assert.rejects(api(method, path, query, payload));
assert.equal(
  (await db.query("select * from public.grocery_receipts")).rows.length,
  0,
);
assert.equal(
  (
    await db.query("select * from public.grocery_spaces where id=$1", [
      household.id,
    ])
  ).rows.length,
  0,
);
await assert.rejects(
  db.query("update public.grocery_spaces set owner_id=$1 where id=$2", [
    eve,
    household.id,
  ]),
);
await assert.rejects(db.query("select * from public.grocery_profiles"));
await as(bob);
const joined = await api("POST", `/api/invitations/${invite.token}/accept`);
assert.equal(joined[0].id, household.id);
assert.equal(
  (await api("GET", "/api/receipts", { spaceId: household.id })).length,
  1,
);
await api("PATCH", `/api/receipts/${receipt.id}`, {}, { total: 10 });
await assert.rejects(api("GET", "/api/receipts", { spaceId: personal.id }));
await assert.rejects(api("POST", `/api/spaces/${household.id}/invitations`));
await assert.rejects(
  api("PATCH", `/api/spaces/${household.id}`, {}, { name: "stolen" }),
);
await api("POST", `/api/spaces/${household.id}/list`, {}, { name: "Apples" });
await api(
  "PATCH",
  `/api/spaces/${household.id}/settings`,
  {},
  { budget: 500, goal: { name: "Dinner", amount: 40 } },
);
await as(alice);
assert.equal(
  (await api("GET", `/api/spaces/${household.id}/list`))[0].name,
  "Apples",
);
assert.equal(
  (await api("GET", `/api/spaces/${household.id}/settings`)).budget,
  500,
);
const backup = await api("GET", "/api/backup", { spaceId: household.id });
const restored = await api(
  "POST",
  "/api/backup/restore",
  {},
  { ...backup, spaceId: personal.id },
);
assert.equal(restored.restored, 1);
// Restore is atomic: an invalid later receipt rolls back the entire batch.
await assert.rejects(
  api(
    "POST",
    "/api/backup/restore",
    {},
    {
      ...backup,
      spaceId: personal.id,
      receipts: [backup.receipts[0], { ...backup.receipts[0], total: -5 }],
    },
  ),
);
assert.equal(
  (await api("GET", "/api/receipts", { spaceId: personal.id })).length,
  1,
);
const photo = `${household.id}/00000000-0000-4000-8000-000000000005.jpg`;
await db.query(
  "insert into storage.objects(bucket_id,name) values('grocery-photos',$1)",
  [photo],
);
assert.equal((await db.query("select * from storage.objects")).rows.length, 1);
await as(eve);
assert.equal((await db.query("select * from storage.objects")).rows.length, 0);
await assert.rejects(
  db.query(
    "insert into storage.objects(bucket_id,name) values('grocery-photos',$1)",
    [photo],
  ),
);
await as(alice);
await api('POST', '/api/receipts', {}, {spaceId: household.id, photoPath: photo, merchant: 'Cleanup test', total: 1, purchaseDate: '2026-10-25', items: []});
await api("DELETE", "/api/auth/me", {}, { confirmation: "DELETE ACCOUNT" });
await as(bob);
assert.equal(
  (await api("GET", "/api/spaces")).find((s) => s.id === household.id).role,
  "owner",
);
await api(
  "DELETE",
  `/api/spaces/${household.id}`,
  {},
  { confirmation: household.name },
);
assert.equal((await db.query('select * from storage.objects')).rows.length, 1);
assert.deepEqual((await db.query('select public.grocery_cleanup($1) as paths', [[photo]])).rows[0].paths, [photo]);
await db.query('delete from storage.objects where name=$1', [photo]);
assert.deepEqual((await db.query('select public.grocery_cleanup($1) as paths', [[photo]])).rows[0].paths, []);
await db.exec("reset role; set role anon");
await assert.rejects(api("GET", "/api/spaces"));
await db.close();
console.log(
  "PASS: schema, receipt values/timezones, private households, RLS, invitations, owner restrictions, shared lists/settings, atomic backup/restore, photo access, ownership succession, anonymous denial.",
);
