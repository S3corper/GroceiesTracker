import type { NextFunction, Request, Response } from "express";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { db, isoNow } from "./storage";

export type UserRequest = Request & { userId?: string };
export const hashPassword = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};
export function verifyPassword(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}
export function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(createHash("sha256").update(token).digest("hex"), userId, new Date(Date.now() + 30 * 86400000).toISOString());
  return token;
}
export function requireUser(req: UserRequest, res: Response, next: NextFunction) {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const session = token ? db.prepare("SELECT user_id,expires_at FROM sessions WHERE token_hash=?").get(createHash("sha256").update(token).digest("hex")) as { user_id: string; expires_at: string } | undefined : undefined;
  const userId = session && session.expires_at > new Date().toISOString() ? session.user_id : undefined;
  if (!userId) { res.status(401).json({ error: "Sign in to access this local household." }); return; }
  req.userId = userId;
  next();
}
export function userSpaces(userId: string) {
  return db.prepare(`SELECT s.id,s.name,s.kind,s.timezone,m.role FROM spaces s JOIN memberships m ON m.space_id=s.id WHERE m.user_id=? ORDER BY s.kind DESC,s.name`).all(userId);
}
export function isMember(spaceId: string, userId: string) {
  return Boolean(db.prepare("SELECT 1 FROM memberships WHERE space_id=? AND user_id=?").get(spaceId, userId));
}
export const uuid = randomUUID;
export { isoNow };
