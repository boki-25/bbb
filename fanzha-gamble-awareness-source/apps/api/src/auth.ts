import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import { query } from './db.js';

const scrypt = promisify(scryptCallback);

export type AuthedRequest = Request & {
  user?: { id: number; username: string; role: 'resident' | 'admin' };
};

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(':');
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(userId: number) {
  const token = randomBytes(32).toString('base64url');
  const days = Math.max(1, Math.min(30, Number(process.env.SESSION_DAYS || 7)));
  await query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 day'))`,
    [userId, digest(token), days],
  );
  return { token, maxAge: days * 24 * 60 * 60 * 1000 };
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.fanzha_session;
  if (!token) return res.status(401).json({ error: '请先登录' });
  const result = await query<{ id: string; username: string; role: 'resident' | 'admin' }>(
    `SELECT u.id, u.username, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [digest(token)],
  );
  const user = result.rows[0];
  if (!user) return res.status(401).json({ error: '登录已过期，请重新登录' });
  req.user = { ...user, id: Number(user.id) };
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: '无管理员权限' });
  next();
}

export async function destroySession(token?: string) {
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [digest(token)]);
}
