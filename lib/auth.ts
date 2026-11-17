// Team sign-in. Two pluggable modes, chosen with the AUTH_MODE environment variable:
//
//   AUTH_MODE=passcode (default) — everyone picks their name and types the shared TEAM_PASSCODE.
//   AUTH_MODE=google             — "Sign in with Google", limited to ALLOWED_DOMAIN (e.g. getresq.com).
//                                  Needs GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET. See README.
//
// Either way the result is the same signed session cookie, so the rest of the app doesn't care.

import crypto from 'crypto';
import { cookies } from 'next/headers';
import { getDb } from './db';
import { getPerson } from './repo';
import type { Person } from './types';

export const SESSION_COOKIE = 'resq_session';
const MAX_AGE_DAYS = 30;

export type AuthMode = 'passcode' | 'google';
export const authMode = (): AuthMode => (process.env.AUTH_MODE === 'google' ? 'google' : 'passcode');
export const teamPasscode = () => process.env.TEAM_PASSCODE || 'resq-local';
export const allowedDomain = () => (process.env.ALLOWED_DOMAIN || 'getresq.com').toLowerCase();

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL) throw new Error('SESSION_SECRET must be set in production.');
  return 'local-dev-secret-change-me';
}

const sign = (payload: string) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

export function makeSessionToken(personId: number): string {
  const exp = Date.now() + MAX_AGE_DAYS * 86400000;
  const payload = `${personId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function readSessionToken(token: string | undefined): number | null {
  if (!token) return null;
  const [id, exp, sig] = token.split('.');
  if (!id || !exp || !sig) return null;
  const expected = sign(`${id}.${exp}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  return Number(id);
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: MAX_AGE_DAYS * 86400,
};

export function safeEqual(a: string, b: string) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** The signed-in person, or null. */
export async function currentUser(): Promise<Person | null> {
  const jar = await cookies();
  const id = readSessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!id) return null;
  const db = await getDb();
  const p = await getPerson(db.query, id);
  return p && p.active ? p : null;
}
