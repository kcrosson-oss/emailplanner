import { NextResponse } from 'next/server';
import { allowedDomain, authMode, cookieOptions, makeSessionToken, SESSION_COOKIE } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Step 2 of Google sign-in: Google sends the user back here with a code.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const fail = (msg: string) => NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, req.url));
  if (authMode() !== 'google') return fail('Google sign-in is not enabled.');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = req.headers.get('cookie')?.match(/resq_oauth_state=([a-f0-9]+)/)?.[1];
  if (!code || !state || state !== cookieState) return fail('Sign-in expired, please try again.');

  const origin = process.env.APP_URL || url.origin;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${origin}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return fail('Google sign-in failed.');
  const { access_token } = await tokenRes.json();
  const info = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${access_token}` } })).json();
  const email = String(info.email ?? '').toLowerCase();
  if (!info.email_verified || !email.endsWith('@' + allowedDomain())) return fail(`Please use your @${allowedDomain()} Google account.`);

  const db = await getDb();
  const found = await db.query('SELECT id, active FROM people WHERE LOWER(email) = $1', [email]);
  if (found[0] && !found[0].active) return fail('Your account has been deactivated. Ask an admin.');
  const id = found[0]?.id ?? (await db.query('INSERT INTO people (name, email) VALUES ($1,$2) RETURNING id', [info.name || email.split('@')[0], email]))[0].id;

  const res = NextResponse.redirect(new URL('/', req.url));
  res.cookies.set(SESSION_COOKIE, makeSessionToken(id), cookieOptions);
  res.cookies.set('resq_oauth_state', '', { path: '/', maxAge: 0 });
  return res;
}
