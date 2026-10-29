import { Router } from "express";
import { randomBytes } from "node:crypto";
import { dateInTimezone, db, deletePhoto, isoNow, localDateTimeToUtc, readPhoto, savePhoto } from "../lib/storage";
import { createSession, hashPassword, isMember, requireUser, userSpaces, verifyPassword, uuid, type UserRequest } from "../lib/auth";
import { comparablePrice, resolveMeasurement } from "../lib/measure";

const router = Router();
const cleanEmail = (value: unknown) => String(value ?? "").trim().toLowerCase();
const localDate = (value: unknown) => {
  const date = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  return new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) === date ? date : "";
};
const timezoneValid = (timezone: string) => { try { new Intl.DateTimeFormat("en", { timeZone: timezone }); return true; } catch { return false; } };
const phoneLinkExpired = "The link no longer works. Please try again with a new QR Code.";

router.post("/receipts/phone-upload-sessions", requireUser, (req: UserRequest, res) => {
  const spaceId = String(req.body?.spaceId ?? "");
  if (!isMember(spaceId, req.userId!)) { res.status(403).json({ error: "You are not a member of this space." }); return; }
  db.prepare("DELETE FROM phone_upload_sessions WHERE expires_at<=? OR consumed_at IS NOT NULL").run(isoNow());
  db.prepare("DELETE FROM phone_upload_sessions WHERE user_id=? AND space_id=?").run(req.userId!, spaceId);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  db.prepare("INSERT INTO phone_upload_sessions(token,user_id,space_id,expires_at) VALUES(?,?,?,?)").run(token, req.userId!, spaceId, expiresAt);
  res.status(201).json({ token, expiresAt });
});

router.get("/receipts/phone-upload-sessions/:token", (req, res) => {
  const session = db.prepare("SELECT expires_at,uploaded_at,consumed_at FROM phone_upload_sessions WHERE token=?").get(String(req.params.token)) as any;
  if (!session || session.expires_at <= isoNow() || session.consumed_at) { res.status(410).json({ error: phoneLinkExpired }); return; }
  res.json({ status: session.uploaded_at ? "uploaded" : "waiting", expiresAt: session.expires_at });
});

router.post("/receipts/phone-upload-sessions/:token/upload", (req, res) => {
  const token = String(req.params.token), session = db.prepare("SELECT expires_at,uploaded_at,consumed_at FROM phone_upload_sessions WHERE token=?").get(token) as any;
  if (!session || session.expires_at <= isoNow() || session.consumed_at) { res.status(410).json({ error: phoneLinkExpired }); return; }
  if (session.uploaded_at) { res.status(409).json({ error: "This link has already been used. Please scan a new QR Code." }); return; }
  const mimeType = String(req.body?.mimeType ?? ""), imageBase64 = String(req.body?.imageBase64 ?? "");
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType) || !/^[a-z0-9+/]+=*$/i.test(imageBase64) || imageBase64.length > 5_592_408) { res.status(400).json({ error: "Choose a JPG, PNG, or WebP receipt photo under 4 MB." }); return; }
  const result = db.prepare("UPDATE phone_upload_sessions SET mime_type=?,image_data=?,uploaded_at=? WHERE token=? AND uploaded_at IS NULL AND consumed_at IS NULL AND expires_at>?").run(mimeType, imageBase64, isoNow(), token, isoNow());
  if (!result.changes) { res.status(410).json({ error: phoneLinkExpired }); return; }
  res.status(201).json({ status: "uploaded" });
});

router.get("/receipts/phone-upload-sessions/:token/result", requireUser, (req: UserRequest, res) => {
  const session = db.prepare("SELECT user_id,space_id,expires_at,mime_type,image_data,uploaded_at,consumed_at FROM phone_upload_sessions WHERE token=?").get(String(req.params.token)) as any;
  if (!session || session.user_id !== req.userId || session.expires_at <= isoNow() || session.consumed_at) { res.status(410).json({ error: phoneLinkExpired }); return; }
  if (!session.uploaded_at) { res.status(404).json({ error: "No receipt photo has been uploaded yet." }); return; }
  db.prepare("UPDATE phone_upload_sessions SET consumed_at=?,image_data=NULL WHERE token=?").run(isoNow(), String(req.params.token));
  res.json({ mimeType: session.mime_type, imageBase64: session.image_data });
});
function computeUnit(item: any) {
  const name = String(item.name ?? "").trim();
  const variant = String(item.variant ?? "").trim();
  const price = Number(item.linePrice ?? item.price);
  const explicitPack = Number(item.packCount);
  const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
  const eggs = /\beggs?\b/i.test(`${name} ${variant}`);
  const eggCountMatch = `${name} ${variant}`.match(/\b(\d{1,3})\s*(?:ct|count|eggs?|pack)\b/i);
  const eggCount = eggCountMatch ? Number(eggCountMatch[1]) : /\bdozen\b/i.test(`${name} ${variant}`) ? 12 : explicitPack >= 2 ? explicitPack : undefined;
  if (eggs && eggCount && eggCount > 1) return { unitPrice: price / (eggCount * quantity), unitPriceUnit: "egg", available: true, packCount: eggCount, quantity };
  const measurement = resolveMeasurement(name, variant, item.measureAmount, item.measureUnit);
  if (measurement) {
    const comparable = comparablePrice(price, quantity, measurement.amount, measurement.unit);
    if (comparable) return { ...comparable, available: true, packCount: Number.isFinite(explicitPack) && explicitPack > 0 ? explicitPack : null, quantity, measurement };
  }
  return { unitPrice: null, unitPriceUnit: null, available: false, packCount: Number.isFinite(explicitPack) && explicitPack > 0 ? explicitPack : null, quantity };
}
function itemFromRow(row: any) {
  return { id: row.id, name: row.name, variant: row.variant, category: row.category, linePrice: row.line_price, quantity: row.quantity, packCount: row.pack_count, measureAmount: row.measure_amount, measureUnit: row.measure_unit, unitPrice: row.unit_price, unitPriceUnit: row.unit_price_unit, unitPriceAvailable: Boolean(row.unit_price_available) };
}
function getReceipt(id: string) {
  const receipt = db.prepare("SELECT * FROM receipts WHERE id=?").get(id) as any;
  if (!receipt) return null;
  const items = db.prepare("SELECT * FROM items WHERE receipt_id=? ORDER BY rowid").all(id).map(itemFromRow);
  return { id: receipt.id, spaceId: receipt.space_id, merchant: receipt.merchant, total: receipt.total, purchaseDate: receipt.purchase_date, purchaseTime: receipt.purchase_time, timezone: receipt.timezone, purchaseInstant: receipt.purchase_timestamp, photoUrl: receipt.photo_name ? `/api/receipts/${receipt.id}/photo` : null, createdAt: receipt.created_at, items };
}
function saveItems(receiptId: string, items: any[]) {
  db.prepare("DELETE FROM items WHERE receipt_id=?").run(receiptId);
  for (const raw of items) {
    const item = { ...raw, name: String(raw.name ?? "").trim() };
    if (!item.name) continue;
    const computed = computeUnit(item);
    const measurement = "measurement" in computed ? computed.measurement : null;
    db.prepare(`INSERT INTO items(id,receipt_id,name,variant,category,line_price,quantity,pack_count,measure_amount,measure_unit,unit_price,unit_price_unit,unit_price_available) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      uuid(), receiptId, item.name, String(item.variant ?? "").trim(), String(item.category ?? "Other"), Number(item.linePrice ?? item.price) || 0,
      computed.quantity, computed.packCount ?? null, measurement?.amount ?? null, measurement?.unit ?? null, computed.unitPrice, computed.unitPriceUnit, computed.available ? 1 : 0,
    );
  }
}

router.post("/auth/register", (req, res) => {
  const email = cleanEmail(req.body?.email), password = String(req.body?.password ?? ""), name = String(req.body?.name ?? "My household").trim() || "My household", displayName = String(req.body?.displayName ?? "").trim() || cleanEmail(req.body?.email).split("@")[0];
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 10) { res.status(400).json({ error: "Enter a valid email and a password with at least 10 characters." }); return; }
  if (!displayName || displayName.length > 60) { res.status(400).json({ error: "Display name must be between 1 and 60 characters." }); return; }
  if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email)) { res.status(409).json({ error: "That account already exists on this host." }); return; }
  const userId = uuid(), now = isoNow();
  const insertUser = db.prepare("INSERT INTO users(id,email,password_hash,created_at,display_name) VALUES(?,?,?,?,?)");
  insertUser.run(userId, email, hashPassword(password), now, displayName);
  const createSpace = db.prepare("INSERT INTO spaces(id,name,kind,timezone,owner_id) VALUES(?,?,?,?,?)");
  const addMember = db.prepare("INSERT INTO memberships(space_id,user_id,role) VALUES(?,?,?)");
  const privateId = uuid(), householdId = uuid();
  createSpace.run(privateId, "Personal", "private", "America/New_York", userId); addMember.run(privateId, userId, "owner");
  createSpace.run(householdId, name, "household", "America/New_York", userId); addMember.run(householdId, userId, "owner");
  res.status(201).json({ token: createSession(userId), user: { id: userId, email, displayName, profileImage: "" }, spaces: userSpaces(userId) });
});
router.post("/auth/login", (req, res) => {
  const email = cleanEmail(req.body?.email), password = String(req.body?.password ?? "");
  const user = db.prepare("SELECT id,email,password_hash,display_name,profile_image FROM users WHERE email=?").get(email) as any;
  if (!user || !verifyPassword(password, user.password_hash)) { res.status(401).json({ error: "Email or password is incorrect." }); return; }
  res.json({ token: createSession(user.id), user: { id: user.id, email, displayName: user.display_name, profileImage: user.profile_image ?? "" }, spaces: userSpaces(user.id) });
});
router.use(requireUser);
router.get("/auth/me", (req: UserRequest, res) => {
  const user = db.prepare("SELECT id,email,display_name AS displayName,profile_image AS profileImage FROM users WHERE id=?").get(req.userId!) as { id: string; email: string; displayName: string; profileImage: string } | undefined;
  if (!user) { res.status(404).json({ error: "Account not found on this host." }); return; }
  res.json(user);
});
router.patch("/auth/me", (req: UserRequest, res) => {
  const existing = db.prepare("SELECT display_name,profile_image FROM users WHERE id=?").get(req.userId!) as { display_name: string; profile_image: string } | undefined;
  if (!existing) { res.status(404).json({ error: "Account not found on this host." }); return; }
  const displayName = String(req.body?.displayName ?? existing.display_name).trim();
  const profileImage = String(req.body?.profileImage ?? existing.profile_image ?? "");
  if (!displayName || displayName.length > 60) { res.status(400).json({ error: "Display name must be between 1 and 60 characters." }); return; }
  if (profileImage.length > 1_400_000 || (profileImage && !/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+=*$/i.test(profileImage))) { res.status(400).json({ error: "Choose a JPG, PNG, or WebP profile photo under 1 MB." }); return; }
  db.prepare("UPDATE users SET display_name=?,profile_image=? WHERE id=?").run(displayName, profileImage, req.userId!);
  res.json(db.prepare("SELECT id,email,display_name AS displayName,profile_image AS profileImage FROM users WHERE id=?").get(req.userId!));
});

router.delete("/auth/me", (req: UserRequest, res) => {
  if (req.body?.confirmation !== "DELETE ACCOUNT") { res.status(400).json({ error: "Type DELETE ACCOUNT to confirm account deletion." }); return; }
  const userId = req.userId!;
  const ownedSpaces = db.prepare("SELECT id,kind FROM spaces WHERE owner_id=?").all(userId) as Array<{ id: string; kind: string }>;
  const removedPhotos: string[] = [];
  try {
    db.exec("BEGIN");
    for (const owned of ownedSpaces) {
      const otherMembers = db.prepare("SELECT m.user_id FROM memberships m WHERE m.space_id=? AND m.user_id<>? ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,m.rowid").all(owned.id, userId) as Array<{ user_id: string }>;
      if (owned.kind === "household" && otherMembers.length) {
        const successor = otherMembers[0].user_id;
        db.prepare("UPDATE spaces SET owner_id=? WHERE id=?").run(successor, owned.id);
        db.prepare("UPDATE memberships SET role='owner' WHERE space_id=? AND user_id=?").run(owned.id, successor);
      } else {
        removedPhotos.push(...(db.prepare("SELECT photo_name FROM receipts WHERE space_id=? AND photo_name IS NOT NULL").all(owned.id) as Array<{ photo_name: string }>).map((photo) => photo.photo_name));
        db.prepare("DELETE FROM spaces WHERE id=?").run(owned.id);
      }
    }
    db.prepare("DELETE FROM users WHERE id=?").run(userId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  removedPhotos.forEach(deletePhoto);
  res.status(204).end();
});

router.get("/spaces", (req: UserRequest, res) => res.json(userSpaces(req.userId!)));
router.post("/spaces", (req: UserRequest, res) => {
  const name = String(req.body?.name ?? "").trim(), kind = String(req.body?.kind ?? "");
  if (!name || name.length > 60) { res.status(400).json({ error: "Space name must be between 1 and 60 characters." }); return; }
  if (kind !== "private" && kind !== "household") { res.status(400).json({ error: "Choose Personal or Household." }); return; }
  const id = uuid();
  try {
    db.exec("BEGIN");
    db.prepare("INSERT INTO spaces(id,name,kind,timezone,owner_id) VALUES(?,?,?,?,?)").run(id, name, kind, "America/New_York", req.userId!);
    db.prepare("INSERT INTO memberships(space_id,user_id,role) VALUES(?,?,'owner')").run(id, req.userId!);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  res.status(201).json(db.prepare("SELECT s.id,s.name,s.kind,s.timezone,m.role FROM spaces s JOIN memberships m ON m.space_id=s.id WHERE s.id=? AND m.user_id=?").get(id, req.userId!));
});
router.get("/spaces/:id/members", (req: UserRequest, res) => {
  const spaceId = String(req.params.id);
  if (!isMember(spaceId, req.userId!)) { res.status(403).json({ error: "You are not a member of this space." }); return; }
  const space = db.prepare("SELECT id,name,kind FROM spaces WHERE id=?").get(spaceId);
  const members = db.prepare("SELECT u.id,u.display_name AS displayName,u.profile_image AS profileImage,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.space_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,u.display_name COLLATE NOCASE").all(spaceId);
  res.json({ space, count: members.length, members });
});
router.patch("/spaces/:id", (req: UserRequest, res) => {
  const spaceId = String(req.params.id);
  const space = db.prepare("SELECT * FROM spaces WHERE id=? AND owner_id=?").get(spaceId, req.userId!) as any;
  if (!space) { res.status(404).json({ error: "Space not found or owner access required." }); return; }
  const timezone = String(req.body?.timezone ?? space.timezone);
  if (!timezoneValid(timezone)) { res.status(400).json({ error: "Enter a valid IANA timezone." }); return; }
  const name = String(req.body?.name ?? space.name).trim() || space.name;
  db.prepare("UPDATE spaces SET timezone=?,name=? WHERE id=?").run(timezone, name, space.id);
  res.json({ id: space.id, name, kind: space.kind, timezone });
});
router.delete("/spaces/:id", (req: UserRequest, res) => {
  const spaceId = String(req.params.id);
  const space = db.prepare("SELECT id,name FROM spaces WHERE id=? AND owner_id=?").get(spaceId, req.userId!) as { id: string; name: string } | undefined;
  if (!space) { res.status(404).json({ error: "Workspace not found or owner access required." }); return; }
  if (req.body?.confirmation !== space.name) { res.status(400).json({ error: "Type the workspace name exactly to confirm deletion." }); return; }
  const membershipCount = (db.prepare("SELECT count(*) AS count FROM memberships WHERE user_id=?").get(req.userId!) as { count: number }).count;
  if (membershipCount <= 1) { res.status(409).json({ error: "Create another workspace before deleting your last one." }); return; }
  const photos = db.prepare("SELECT photo_name FROM receipts WHERE space_id=? AND photo_name IS NOT NULL").all(spaceId) as Array<{ photo_name: string }>;
  db.prepare("DELETE FROM spaces WHERE id=?").run(spaceId);
  photos.forEach((photo) => deletePhoto(photo.photo_name));
  res.status(204).end();
});
router.post("/spaces/:id/invitations", (req: UserRequest, res) => {
  const spaceId = String(req.params.id);
  const space = db.prepare("SELECT id FROM spaces WHERE id=? AND owner_id=? AND kind='household'").get(spaceId, req.userId!);
  if (!space) { res.status(404).json({ error: "Only a household owner can invite members." }); return; }
  const token = randomBytes(24).toString("base64url"), now = Date.now();
  db.prepare("INSERT INTO invitations(token,space_id,created_at,expires_at) VALUES(?,?,?,?)").run(token, spaceId, new Date(now).toISOString(), new Date(now + 7 * 86400000).toISOString());
  res.status(201).json({ token, inviteUrl: `${req.protocol}://${req.get("host")}/?invite=${token}`, expiresAt: new Date(now + 7 * 86400000).toISOString() });
});
router.post("/invitations/:token/accept", (req: UserRequest, res) => {
  const invite = db.prepare("SELECT * FROM invitations WHERE token=? AND expires_at>? ").get(String(req.params.token), isoNow()) as any;
  if (!invite) { res.status(404).json({ error: "Invitation has expired or is invalid." }); return; }
  db.prepare("INSERT OR IGNORE INTO memberships(space_id,user_id,role) VALUES(?,?,'member')").run(invite.space_id, req.userId!);
  res.json(userSpaces(req.userId!));
});
router.get("/receipts", (req: UserRequest, res) => {
  const spaceId = String(req.query.spaceId ?? "");
  if (!isMember(spaceId, req.userId!)) { res.status(403).json({ error: "You are not a member of this space." }); return; }
  const ids = db.prepare("SELECT id FROM receipts WHERE space_id=? ORDER BY purchase_date DESC,purchase_time DESC,created_at DESC").all(spaceId) as any[];
  res.json(ids.map(({ id }) => getReceipt(id)));
});
router.post("/receipts", (req: UserRequest, res) => {
  const body = req.body ?? {}, spaceId = String(body.spaceId ?? "");
  if (!isMember(spaceId, req.userId!)) { res.status(403).json({ error: "You are not a member of this space." }); return; }
  const date = localDate(body.purchaseDate ?? body.date);
  const total = Number(body.total ?? body.amount);
  if (!date || !Number.isFinite(total) || total < 0) { res.status(400).json({ error: "A purchase date and valid receipt total are required." }); return; }
  const space = db.prepare("SELECT timezone FROM spaces WHERE id=?").get(spaceId) as any;
  const id = uuid(), now = isoNow();
  const photoName = typeof body.imageBase64 === "string" ? savePhoto(body.imageBase64, String(body.mimeType ?? "image/jpeg")) : null;
  const purchaseTime = body.purchaseTime ? String(body.purchaseTime) : null;
  const purchaseTimezone = purchaseTime ? String(body.timezone ?? space.timezone) : null;
  if (purchaseTime && !/^\d{2}:\d{2}$/.test(purchaseTime)) { res.status(400).json({ error: "Enter a valid purchase time in HH:mm format." }); return; }
  if (purchaseTimezone && !timezoneValid(purchaseTimezone)) { res.status(400).json({ error: "Enter a valid IANA timezone." }); return; }
  const purchaseTimestamp = purchaseTime && purchaseTimezone ? localDateTimeToUtc(date, purchaseTime, purchaseTimezone) : null;
  db.prepare("INSERT INTO receipts(id,space_id,merchant,total,purchase_date,purchase_time,timezone,purchase_timestamp,photo_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(id, spaceId, String(body.merchant ?? body.store ?? "Unknown store"), total, date, purchaseTime, purchaseTimezone, purchaseTimestamp, photoName, now, now);
  saveItems(id, Array.isArray(body.items) ? body.items : []);
  res.status(201).json(getReceipt(id));
});
router.patch("/receipts/:id", (req: UserRequest, res) => {
  const receiptId = String(req.params.id);
  const existing = db.prepare("SELECT r.*,s.timezone AS space_timezone FROM receipts r JOIN spaces s ON s.id=r.space_id WHERE r.id=?").get(receiptId) as any;
  if (!existing || !isMember(existing.space_id, req.userId!)) { res.status(404).json({ error: "Receipt not found in a space you can access." }); return; }
  const body = req.body ?? {}, date = localDate(body.purchaseDate ?? existing.purchase_date), total = Number(body.total ?? existing.total);
  if (!date || !Number.isFinite(total) || total < 0) { res.status(400).json({ error: "A valid purchase date and total are required." }); return; }
  const purchaseTime = body.purchaseTime === undefined ? existing.purchase_time : String(body.purchaseTime || "") || null;
  if (purchaseTime && !/^\d{2}:\d{2}$/.test(purchaseTime)) { res.status(400).json({ error: "Enter a valid purchase time in HH:mm format." }); return; }
  const purchaseTimezone = purchaseTime ? String(body.timezone ?? existing.timezone ?? existing.space_timezone) : null;
  if (purchaseTimezone && !timezoneValid(purchaseTimezone)) { res.status(400).json({ error: "Enter a valid IANA timezone." }); return; }
  const purchaseTimestamp = purchaseTime && purchaseTimezone ? localDateTimeToUtc(date, purchaseTime, purchaseTimezone) : null;
  db.prepare("UPDATE receipts SET merchant=?,total=?,purchase_date=?,purchase_time=?,timezone=?,purchase_timestamp=?,updated_at=? WHERE id=?").run(String(body.merchant ?? existing.merchant), total, date, purchaseTime, purchaseTimezone, purchaseTimestamp, isoNow(), existing.id);
  if (Array.isArray(body.items)) saveItems(existing.id, body.items);
  res.json(getReceipt(existing.id));
});
router.delete("/receipts/:id", (req: UserRequest, res) => {
  const receiptId = String(req.params.id);
  const existing = db.prepare("SELECT space_id,photo_name FROM receipts WHERE id=?").get(receiptId) as { space_id: string; photo_name: string | null } | undefined;
  if (!existing || !isMember(existing.space_id, req.userId!)) { res.status(404).json({ error: "Receipt not found in a space you can access." }); return; }
  db.prepare("DELETE FROM receipts WHERE id=?").run(receiptId);
  if (existing.photo_name) deletePhoto(existing.photo_name);
  res.status(204).end();
});
router.get("/receipts/:id/photo", (req: UserRequest, res) => {
  const row = db.prepare("SELECT space_id,photo_name FROM receipts WHERE id=?").get(String(req.params.id)) as any;
  if (!row || !isMember(row.space_id, req.userId!) || !row.photo_name) { res.status(404).json({ error: "Photo not found." }); return; }
  const photo = readPhoto(row.photo_name); if (!photo) { res.status(404).json({ error: "Photo is unavailable." }); return; }
  const type = row.photo_name.endsWith(".png") ? "image/png" : row.photo_name.endsWith(".webp") ? "image/webp" : "image/jpeg";
  res.type(type).send(photo);
});
router.get("/items/history", (req: UserRequest, res) => {
  const spaceId = String(req.query.spaceId ?? ""), product = String(req.query.name ?? ""), variant = String(req.query.variant ?? "");
  if (!isMember(spaceId, req.userId!)) { res.status(403).json({ error: "You are not a member of this space." }); return; }
  const space = db.prepare("SELECT timezone FROM spaces WHERE id=?").get(spaceId) as { timezone: string };
  const rows = db.prepare(`SELECT i.*,r.purchase_date,r.purchase_time,r.timezone,r.purchase_timestamp,r.merchant FROM items i JOIN receipts r ON r.id=i.receipt_id WHERE r.space_id=? AND lower(i.name)=lower(?) AND lower(i.variant)=lower(?) AND i.unit_price_available=1 ORDER BY COALESCE(r.purchase_timestamp,r.purchase_date),r.purchase_time`).all(spaceId, product, variant) as any[];
  res.json(rows.map((r) => ({ date: r.purchase_timestamp ? dateInTimezone(r.purchase_timestamp, space.timezone) : r.purchase_date, time: r.purchase_time, timezone: r.timezone, merchant: r.merchant, variant: r.variant, linePrice: r.line_price, unitPrice: r.unit_price, unit: r.unit_price_unit, packCount: r.pack_count, receiptId: r.receipt_id })));
});
router.get("/summaries", (req: UserRequest, res) => {
  const spaceId = String(req.query.spaceId ?? ""), period = String(req.query.period ?? "month");
  if (!isMember(spaceId, req.userId!)) { res.status(403).json({ error: "You are not a member of this space." }); return; }
  const space = db.prepare("SELECT timezone FROM spaces WHERE id=?").get(spaceId) as { timezone: string };
  const rows = db.prepare("SELECT purchase_date,purchase_timestamp,total FROM receipts WHERE space_id=? ORDER BY COALESCE(purchase_timestamp,purchase_date)").all(spaceId) as any[];
  const values: Record<string, number> = {};
  for (const row of rows) {
    const periodDate = row.purchase_timestamp ? dateInTimezone(row.purchase_timestamp, space.timezone) : row.purchase_date;
    const date = new Date(`${periodDate}T12:00:00Z`);
    if (period === "week") { const start = new Date(date); start.setUTCDate(start.getUTCDate() - start.getUTCDay()); values[start.toISOString().slice(0, 10)] = (values[start.toISOString().slice(0, 10)] ?? 0) + row.total; }
    else { const key = periodDate.slice(0, 7); values[key] = (values[key] ?? 0) + row.total; }
  }
  res.json(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([periodStart, total]) => ({ periodStart, total })));
});
router.get("/backup", (req: UserRequest, res) => {
  const spaceId = String(req.query.spaceId ?? "");
  const owner = db.prepare("SELECT 1 FROM spaces WHERE id=? AND owner_id=?").get(spaceId, req.userId!);
  if (!owner) { res.status(403).json({ error: "Only the space owner can export a backup." }); return; }
  const receipts = db.prepare("SELECT * FROM receipts WHERE space_id=?").all(spaceId) as any[];
  res.json({ format: "groceries-tracker-backup-v1", space: db.prepare("SELECT * FROM spaces WHERE id=?").get(spaceId), receipts: receipts.map((row) => ({ ...getReceipt(row.id), imageMimeType: row.photo_name?.endsWith(".png") ? "image/png" : row.photo_name?.endsWith(".webp") ? "image/webp" : "image/jpeg", imageBase64: row.photo_name && readPhoto(row.photo_name) ? readPhoto(row.photo_name)!.toString("base64") : null, items: db.prepare("SELECT * FROM items WHERE receipt_id=?").all(row.id).map(itemFromRow) })) });
});
router.post("/backup/restore", (req: UserRequest, res) => {
  const body = req.body ?? {}, spaceId = String(body.spaceId ?? "");
  if (!db.prepare("SELECT 1 FROM spaces WHERE id=? AND owner_id=?").get(spaceId, req.userId!)) { res.status(403).json({ error: "Only the space owner can restore a backup." }); return; }
  if (body.format !== "groceries-tracker-backup-v1" || !Array.isArray(body.receipts)) { res.status(400).json({ error: "Unsupported backup file." }); return; }
  for (const row of body.receipts) {
    const photoName = typeof row.imageBase64 === "string" ? savePhoto(row.imageBase64, String(row.imageMimeType ?? "image/jpeg")) : null, id = uuid(), now = isoNow();
    const purchaseDate = localDate(row.purchaseDate) || new Date().toISOString().slice(0, 10), purchaseTime = row.purchaseTime || null, timezone = purchaseTime ? String(row.timezone ?? "America/New_York") : null;
    const purchaseTimestamp = purchaseTime && timezone ? localDateTimeToUtc(purchaseDate, String(purchaseTime), timezone) : null;
    db.prepare("INSERT INTO receipts(id,space_id,merchant,total,purchase_date,purchase_time,timezone,purchase_timestamp,photo_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(id, spaceId, row.merchant, Number(row.total) || 0, purchaseDate, purchaseTime, timezone, purchaseTimestamp, photoName, now, now);
    saveItems(id, row.items ?? []);
  }
  res.json({ restored: body.receipts.length });
});
export default router;
