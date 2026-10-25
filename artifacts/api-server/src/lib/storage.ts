import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { comparablePrice, printedMeasurement } from "./measure";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(moduleDir, path.basename(moduleDir) === "dist" ? "../data" : "../../data");
const dataDir = path.resolve(process.env.GROCERIES_DATA_DIR ?? defaultDataDir);
const photoDir = path.join(dataDir, "photos");
mkdirSync(photoDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, "groceries.sqlite"));
db.exec(`PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('private','household')), timezone TEXT NOT NULL DEFAULT 'America/New_York', owner_id TEXT NOT NULL REFERENCES users(id));
CREATE TABLE IF NOT EXISTS memberships (space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'member', PRIMARY KEY(space_id,user_id));
CREATE TABLE IF NOT EXISTS invitations (token TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, merchant TEXT NOT NULL, total REAL NOT NULL, purchase_date TEXT NOT NULL, purchase_time TEXT, timezone TEXT, purchase_timestamp TEXT, photo_name TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE, name TEXT NOT NULL, variant TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'Other', line_price REAL NOT NULL, quantity REAL NOT NULL DEFAULT 1, pack_count REAL, measure_amount REAL, measure_unit TEXT, unit_price REAL, unit_price_unit TEXT, unit_price_available INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS receipts_space_date ON receipts(space_id,purchase_date);
CREATE INDEX IF NOT EXISTS items_name ON items(name,variant);`);
const itemColumns = new Set((db.prepare("PRAGMA table_info(items)").all() as Array<{ name: string }>).map((column) => column.name));
if (!itemColumns.has("quantity")) db.exec("ALTER TABLE items ADD COLUMN quantity REAL NOT NULL DEFAULT 1");
const userColumns = new Set((db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map((column) => column.name));
if (!userColumns.has("display_name")) db.exec("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
if (!userColumns.has("profile_icon")) db.exec("ALTER TABLE users ADD COLUMN profile_icon TEXT NOT NULL DEFAULT ''");
if (!userColumns.has("profile_image")) db.exec("ALTER TABLE users ADD COLUMN profile_image TEXT NOT NULL DEFAULT ''");
db.exec("UPDATE users SET display_name=substr(email,1,instr(email,'@')-1) WHERE trim(display_name)='' OR lower(trim(display_name)) IN ('undefined','null')");
const receiptColumns = new Set((db.prepare("PRAGMA table_info(receipts)").all() as Array<{ name: string }>).map((column) => column.name));
if (!receiptColumns.has("purchase_timestamp")) db.exec("ALTER TABLE receipts ADD COLUMN purchase_timestamp TEXT");

// Earlier builds stored weight prices per gram. Keep existing histories comparable per pound.
db.exec("UPDATE items SET unit_price=unit_price*453.59237, unit_price_unit='lb' WHERE unit_price_available=1 AND unit_price_unit='g'");
db.exec("UPDATE items SET unit_price=unit_price*1000, unit_price_unit='l' WHERE unit_price_available=1 AND unit_price_unit='ml'");
const itemsWithPrintedSizes = db.prepare("SELECT id,name,variant,measure_amount,measure_unit,line_price,quantity FROM items").all() as Array<{ id: string; name: string; variant: string; measure_amount: number | null; measure_unit: string | null; line_price: number; quantity: number }>;
const repairPrintedSize = db.prepare("UPDATE items SET measure_amount=?,measure_unit=?,unit_price=?,unit_price_unit=?,unit_price_available=1 WHERE id=?");
for (const item of itemsWithPrintedSizes) {
  const printed = printedMeasurement(item.name) ?? printedMeasurement(item.variant);
  if (!printed || (item.measure_amount === printed.amount && item.measure_unit === printed.unit)) continue;
  const comparable = comparablePrice(item.line_price, item.quantity || 1, printed.amount, printed.unit);
  if (comparable) repairPrintedSize.run(printed.amount, printed.unit, comparable.unitPrice, comparable.unitPriceUnit, item.id);
}

export function localDateTimeToUtc(date: string, time: string, timezone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite) || hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new Error("Invalid local date or time");
  const desiredLocalEpoch = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(desiredLocalEpoch));
  const fields = Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]));
  const displayedEpoch = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute);
  return new Date(desiredLocalEpoch - (displayedEpoch - desiredLocalEpoch)).toISOString();
}

export function dateInTimezone(instant: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export function savePhoto(base64: string, mimeType: string) {
  const ext = mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : ".jpg";
  const name = `${randomUUID()}${ext}`;
  writeFileSync(path.join(photoDir, name), Buffer.from(base64, "base64"), { mode: 0o600 });
  return name;
}

export function readPhoto(name: string) {
  if (!/^[a-z0-9-]+\.(jpg|png|webp)$/i.test(name)) return null;
  try { return readFileSync(path.join(photoDir, name)); } catch { return null; }
}

export function deletePhoto(name: string) {
  if (!/^[a-z0-9-]+\.(jpg|png|webp)$/i.test(name)) return;
  try { unlinkSync(path.join(photoDir, name)); } catch { /* missing photo files do not block record deletion */ }
}

export const isoNow = () => new Date().toISOString();
