import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { allowedDomain, authMode } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Step 1 of Google sign-in: send the browser to Google's consent screen.
export async function GET(req: Request) {
  if (authMode() !== 'google' || !process.env.GOOGLE_CLIENT_ID) return NextResponse.redirect(new URL('/login', req.url));
  const origin = process.env.APP_URL || new URL(req.url).origin;
  const state = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${origin}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    hd: allowedDomain(),
    prompt: 'select_account',
    state,
  });
  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  res.cookies.set('resq_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 600 });
  return res;
}
