import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  configureCloud,
  customFetch,
  cloudSignOut,
} from "../lib/api-client-react/src/index";
const require = createRequire(
  new URL("../lib/api-client-react/package.json", import.meta.url),
);
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(
  readFileSync(
    new URL("../artifacts/groceries-tracker/.env.local", import.meta.url),
    "utf8",
  )
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split("=")),
);
const url = env.VITE_SUPABASE_URL,
  key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
configureCloud(url, key);
const stamp = Date.now();
const accounts: Array<any> = [];
async function register(label: string) {
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await c.auth.signUp({
    email: `grocery-qa-${label}-${stamp}@example.com`,
    password: `Receipt-QA-${stamp}!`,
    options: { data: { displayName: `QA ${label}` } },
  });
  if (error) throw error;
  assert.ok(data.session);
  accounts.push(c);
  return c;
}
async function api(
  c: any,
  method: string,
  path: string,
  query = {},
  payload = {},
) {
  const { data, error } = await c.rpc("grocery_api", {
    method,
    path,
    query,
    payload,
  });
  if (error) throw new Error(error.message);
  return data;
}
try {
  const alice = await register("alice"),
    bob = await register("bob"),
    eve = await register("eve");
  const spaces = await api(alice, "GET", "/api/spaces");
  const home = spaces.find((s: any) => s.kind === "household");
  const invitation = await api(
    alice,
    "POST",
    `/api/spaces/${home.id}/invitations`,
  );
  assert.equal(
    (await api(bob, "POST", `/api/invitations/${invitation.token}/accept`))[0]
      .id,
    home.id,
  );
  await assert.rejects(api(eve, "GET", "/api/receipts", { spaceId: home.id }));
  let resolveEvent: () => void = () => {};
  const event = new Promise<void>((resolve) => {
    resolveEvent = resolve;
  });
  await bob.realtime.setAuth((await bob.auth.getSession()).data.session.access_token);
  const channel = bob
    .channel("qa-sync")
    .on("system",{},(message:any)=>console.log("Realtime system:",JSON.stringify(message)))
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "grocery_spaces",
        filter: `id=eq.${home.id}`,
      },
      () => resolveEvent(),
    );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Realtime subscription timeout")),
      15000,
    );
    channel.subscribe((status: string) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  await api(
    alice,
    "POST",
    `/api/spaces/${home.id}/list`,
    {},
    { name: "Shared apples" },
  );
  let timer: ReturnType<typeof setTimeout>;
  await Promise.race([
    event,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Realtime update timeout")),
        15000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  assert.equal(
    (await api(bob, "GET", `/api/spaces/${home.id}/list`))[0].name,
    "Shared apples",
  );
  await bob.removeChannel(channel);
  const password = `Receipt-QA-${stamp}!`;
  await customFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: `grocery-qa-alice-${stamp}@example.com`,
      password,
    }),
  });
  const imageBase64 = readFileSync(
    process.env.QA_RECEIPT_IMAGE ?? new URL("./fixtures/receipt.png",import.meta.url),
  ).toString("base64");
  const saved: any = await customFetch("/api/receipts", {
    method: "POST",
    body: JSON.stringify({
      spaceId: home.id,
      merchant: "QA Store",
      purchaseDate: "2026-10-25",
      total: 9,
      imageBase64,
      mimeType: "image/png",
      items: [
        { name: "Milk 1L", quantity: 2, linePrice: 4, category: "Dairy" },
        { name: "Eggs 12ct", linePrice: 5, quantity: 1, category: "Dairy" },
      ],
    }),
  });
  assert.equal(saved.items[0].unitPrice, 2);
  const photo: Blob = await customFetch(`/api/receipts/${saved.id}/photo`, {
    responseType: "blob",
  });
  assert.ok(photo.size > 0);
  const unauthorized = await eve.storage
    .from("grocery-photos")
    .download(saved.photoPath);
  assert.ok(unauthorized.error);
  const summary: any = await customFetch(`/api/summaries?spaceId=${home.id}`);
  assert.equal(summary[0].total, 9);
  const history: any = await customFetch(
    `/api/items/history?spaceId=${home.id}&name=Milk%201L&variant=`,
  );
  assert.equal(history[0].unitPrice, 2);
  const backup: any = await customFetch(`/api/backup?spaceId=${home.id}`);
  assert.equal(backup.receipts[0].imageBase64, imageBase64);
  const personal = spaces.find((s: any) => s.kind === "private");
  const restored: any = await customFetch("/api/backup/restore", {
    method: "POST",
    body: JSON.stringify({ ...backup, spaceId: personal.id }),
  });
  assert.equal(restored.restored, 1);
  await customFetch(`/api/receipts/${saved.id}`, { method: "DELETE" });
  assert.ok(
    (await alice.storage.from("grocery-photos").download(saved.photoPath))
      .error,
  );
  await cloudSignOut();
  console.log(
    "PASS: live sign-up/login, household permissions, Realtime across accounts, shared lists, photo upload/private download/deletion, summaries, unit prices, full photo backup/restore.",
  );
} finally {
  const cleanupErrors: unknown[] = [];
  for (const c of accounts.reverse()) {
    try {
      await api(
        c,
        "DELETE",
        "/api/auth/me",
        {},
        { confirmation: "DELETE ACCOUNT" },
      );
      const { data: paths } = await c.rpc("grocery_cleanup");
      if (paths?.length) {
        const { error } = await c.storage.from("grocery-photos").remove(paths);
        if (error) throw error;
        const result = await c.rpc("grocery_cleanup", { done: paths });
        if (result.error) throw result.error;
        assert.deepEqual(result.data, [], 'Account deletion must remove actual storage objects');
      }
    } catch (error) {
      cleanupErrors.push(error);
      console.error("QA cleanup failed:", error);
    }
    await c.auth.signOut();
    await c.removeAllChannels();
  }
  await cloudSignOut();
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'QA account cleanup failed');
}
