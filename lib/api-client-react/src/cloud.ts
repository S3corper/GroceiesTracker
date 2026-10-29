import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { setApiTransport, type CustomFetchOptions } from "./custom-fetch";
import { resolveMeasurement } from "./receipt-measure";

type Storage = {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
};
type Scan = (body: any) => Promise<unknown>;
let client: SupabaseClient | null = null;
let scanner: Scan | null = null;
let subscriptionGeneration = 0;
let subscribedUser: string | null = null;
const listeners = new Set<() => void>();
export const cloudEnabled = () => client !== null;
export function setDeviceScanner(scan: Scan) {
  scanner = scan;
}
export function onCloudChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function refreshCloud() {
  for (const listener of listeners) listener();
}
export function configureCloud(
  url: string | undefined,
  key: string | undefined,
  storage?: Storage,
) {
  if (!url || !key) return false;
  if (client) return true;
  client = createClient(url, key, {
    auth: {
      storage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  setApiTransport(cloudRequest);
  client.auth.onAuthStateChange((event, session) => {
    if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session && subscribedUser !== session.user.id) {
      subscribedUser = session.user.id;
      const generation = ++subscriptionGeneration;
      // Keep a single subscription across initial-session and sign-in events.
      // Disconnecting and immediately joining can strand the socket mid-close.
      void client!.realtime.setAuth(session.access_token).then(() => {
        if (generation !== subscriptionGeneration) return;
        client!.channel('grocery-workspaces')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'grocery_spaces' }, refreshCloud)
          .subscribe(status => { if (status === 'SUBSCRIBED') refreshCloud(); });
      });
    }
    if (event === 'SIGNED_OUT') {
      subscribedUser = null; subscriptionGeneration++;
      void client!.removeAllChannels();
    }
  });
  return true;
}
export async function cloudSignOut() {
  if (client) {
    subscriptionGeneration++;
    await client.auth.signOut({ scope: "local" });
    await client.removeAllChannels();
  }
}
export async function cloudSessionToken() {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}
export function cloudAutoRefresh(active: boolean) {
  if (client) {
    if (active) client.auth.startAutoRefresh();
    else client.auth.stopAutoRefresh();
  }
}
function failure(
  error: { message: string; code?: string } | null,
): asserts error is null {
  if (error)
    throw Object.assign(new Error(error.message), {
      status: error.code === "42501" ? 403 : 400,
    });
}
async function rpc(
  method: string,
  path: string,
  query: Record<string, string> = {},
  payload: any = {},
) {
  const { data, error } = await client!.rpc("grocery_api", {
    method,
    path,
    query,
    payload,
  });
  failure(error);
  return data;
}
function prepareItems(items: any[]) {
  return items.map((item) => {
    const text = `${item.name ?? ""} ${item.variant ?? ""}`;
    const measured = resolveMeasurement(
      String(item.name ?? ""),
      String(item.variant ?? ""),
      item.measureAmount,
      item.measureUnit,
    );
    const eggs = /\beggs?\b/i.test(text);
    const count = text.match(/\b(\d{1,3})\s*(?:ct|count|eggs?|pack)\b/i);
    return {
      ...item,
      quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
      ...(measured
        ? { measureAmount: measured.amount, measureUnit: measured.unit }
        : {}),
      ...(eggs && (count || /\bdozen\b/i.test(text))
        ? { packCount: count ? Number(count[1]) : 12 }
        : {}),
    };
  });
}
async function uploadPhoto(
  spaceId: string,
  base64: string,
  mime = "image/jpeg",
) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime))
    throw new Error("Choose a JPG, PNG or WebP image.");
  if (base64.length > 7_000_000)
    throw new Error("Receipt photos must be smaller than 5 MB.");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  // Supabase storage supplies a random upload id only after upload; use UUID v4 here.
  const uuid = "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (
      Number(c) ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))
    ).toString(16),
  );
  const path = `${spaceId}/${uuid}.${mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"}`;
  const { error } = await client!.storage
    .from("grocery-photos")
    .upload(path, bytes.buffer, { contentType: mime, upsert: false });
  failure(error);
  return path;
}
async function cleanPhotos() {
  const { data: paths, error } = await client!.rpc("grocery_cleanup");
  if (error || !paths?.length) return;
  const { error: removeError } = await client!.storage
    .from("grocery-photos")
    .remove(paths);
  if (!removeError) await client!.rpc("grocery_cleanup", { done: paths });
}
async function photoBlob(path: string) {
  const { data, error } = await client!.storage
    .from("grocery-photos")
    .download(path);
  failure(error);
  return data!;
}
async function blobBase64(blob: Blob): Promise<string> {
  if (typeof FileReader !== "undefined")
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(value);
}
async function cloudRequest(input: string, options: CustomFetchOptions) {
  const url = new URL(input, "https://groceries.invalid");
  const path = url.pathname,
    method = options.method?.toUpperCase() ?? "GET";
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  let body = typeof options.body === "string" ? JSON.parse(options.body) : {};
  if (path === "/api/healthz") return { status: "ok" };
  if (path === "/api/auth/register" || path === "/api/auth/login") {
    if (String(body.password ?? "").length < 10 && path.endsWith("register"))
      throw new Error("Use a password with at least 10 characters.");
    const { data, error } = path.endsWith("register")
      ? await client!.auth.signUp({
          email: body.email.trim(),
          password: body.password,
          options: {
            data: { displayName: body.displayName, household: body.name },
          },
        })
      : await client!.auth.signInWithPassword({
          email: body.email.trim(),
          password: body.password,
        });
    failure(error);
    if (!data.session)
      throw new Error("Account created. Confirm your email before signing in.");
    return {
      token: data.session.access_token,
      user: await rpc("GET", "/api/auth/me"),
      spaces: await rpc("GET", "/api/spaces"),
    };
  }
  if (path === "/api/receipts/scan") {
    if (body.provider === "gemini")
      throw new Error(
        "This free cloud edition uses on-device OCR. No paid AI service is required.",
      );
    if (!scanner)
      throw new Error("Receipt scanner is still loading. Please try again.");
    return scanner(body);
  }
  const phoneSession = path.match(/^\/api\/receipts\/phone-upload-sessions(?:\/([^/]+)(?:\/(upload|result))?)?$/);
  if (phoneSession) {
    const [, token, action] = phoneSession;
    const operation = !token ? "create" : action === "upload" ? "upload" : action === "result" ? "consume" : "status";
    if (operation !== "upload" && !(await cloudSessionToken()) && operation !== "status")
      throw Object.assign(new Error("Sign in to access your household."), { status: 401 });
    return phoneRpc(operation, token, body.spaceId, body.mimeType, body.imageBase64);
  }
  if (path === "/api/receipts/gemini-key-test")
    throw new Error("The free cloud edition uses on-device OCR.");
  if (!(await cloudSessionToken()))
    throw Object.assign(new Error("Sign in to your household."), {
      status: 401,
    });
  if (path.endsWith("/photo") && method === "GET") {
    const receipt = await rpc("GET", path);
    if (!receipt.photoPath) throw new Error("Receipt has no photo.");
    return photoBlob(receipt.photoPath);
  }
  if (path === "/api/summaries" || path === "/api/items/history") {
    const rows = await rpc("GET", "/api/receipts", { spaceId: query.spaceId });
    const spaces = await rpc("GET", "/api/spaces");
    const timezone =
      spaces.find((s: any) => s.id === query.spaceId)?.timezone ??
      "America/New_York";
    const dayOf = (row: any) =>
      row.purchaseInstant
        ? new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date(row.purchaseInstant))
        : row.purchaseDate;
    if (path.endsWith("history"))
      return rows
        .flatMap((r: any) =>
          r.items
            .filter(
              (i: any) =>
                i.name.toLowerCase() === (query.name ?? "").toLowerCase() &&
                (i.variant ?? "").toLowerCase() ===
                  (query.variant ?? "").toLowerCase() &&
                i.unitPriceAvailable,
            )
            .map((i: any) => ({
              date: dayOf(r),
              time: r.purchaseTime,
              timezone: r.timezone,
              merchant: r.merchant,
              variant: i.variant,
              linePrice: i.linePrice,
              unitPrice: i.unitPrice,
              unit: i.unitPriceUnit,
              packCount: i.packCount,
              receiptId: r.id,
            })),
        )
        .sort((a: any, b: any) => a.date.localeCompare(b.date));
    const totals: Record<string, number> = {};
    for (const r of rows) {
      let period = dayOf(r).slice(0, 7);
      if (query.period === "week") {
        const day = new Date(`${dayOf(r)}T12:00:00Z`);
        day.setUTCDate(day.getUTCDate() - day.getUTCDay());
        period = day.toISOString().slice(0, 10);
      }
      totals[period] = (totals[period] ?? 0) + r.total;
    }
    return Object.entries(totals)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periodStart, total]) => ({ periodStart, total }));
  }
  if (path === "/api/backup" && method === "GET") {
    const backup = await rpc(method, path, query);
    for (const row of backup.receipts) {
      if (row.photoPath) {
        const blob = await photoBlob(row.photoPath);
        row.imageBase64 = await blobBase64(blob);
        row.imageMimeType = blob.type;
      }
      delete row.photoPath;
    }
    return backup;
  }
  const uploaded: string[] = [];
  try {
    if (Array.isArray(body.items))
      body = { ...body, items: prepareItems(body.items) };
    if (path === "/api/receipts" && method === "POST" && body.imageBase64) {
      const photoPath = await uploadPhoto(
        body.spaceId,
        body.imageBase64,
        body.mimeType,
      );
      uploaded.push(photoPath);
      body = { ...body, photoPath };
      delete body.imageBase64;
    }
    if (path === "/api/backup/restore" && method === "POST") {
      if (
        body.format !== "groceries-tracker-backup-v1" ||
        !Array.isArray(body.receipts)
      )
        throw new Error("Unsupported backup file.");
      body = { ...body, receipts: [] };
      const original = JSON.parse(options.body as string);
      for (const row of original.receipts) {
        const copy = { ...row, items: prepareItems(row.items ?? []) };
        delete copy.photoPath;
        if (copy.imageBase64) {
          copy.photoPath = await uploadPhoto(
            body.spaceId,
            copy.imageBase64,
            copy.imageMimeType,
          );
          uploaded.push(copy.photoPath);
        }
        delete copy.imageBase64;
        body.receipts.push(copy);
      }
    }
    const result = await rpc(method, path, query, body);
    if (path === '/api/receipts' && method === 'GET') {
      const paths = result.filter((row: any) => row.photoPath).map((row: any) => row.photoPath);
      if (paths.length) {
        const { data, error } = await client!.storage.from('grocery-photos').createSignedUrls(paths, 3600);
        failure(error);
        const urls = new Map(data?.map(photo => [photo.path, photo.signedUrl]));
        for (const row of result) if (row.photoPath) row.photoUrl = urls.get(row.photoPath) ?? null;
      }
    }
    uploaded.length = 0; // Data committed; cleanup failures must never remove saved photos.
    if (method !== "GET") {
      refreshCloud();
      await cleanPhotos().catch(() => undefined);
    }
    return result;
  } catch (error) {
    if (uploaded.length)
      await client!.storage.from("grocery-photos").remove(uploaded);
    throw error;
  }
}

async function phoneRpc(operation: string, token?: string, spaceId?: string, mimeType?: string, imageBase64?: string) {
  const { data, error } = await client!.rpc("grocery_phone_upload", {
    p_operation: operation,
    p_token: token ?? null,
    p_space_id: spaceId ?? null,
    p_mime_type: mimeType ?? null,
    p_image_base64: imageBase64 ?? null,
  });
  failure(error);
  return data;
}
