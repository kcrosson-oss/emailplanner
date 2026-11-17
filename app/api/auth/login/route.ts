import { NextResponse } from 'next/server';
import { authMode, cookieOptions, makeSessionToken, safeEqual, SESSION_COOKIE, teamPasscode } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getPerson } from '@/lib/repo';

export const dynamic = 'force-dynamic';

// Passcode sign-in: { personId, passcode } or, for someone not on the list yet, { name, email, passcode }.
export async function POST(req: Request) {
  if (authMode() !== 'passcode') return NextResponse.json({ error: 'Passcode sign-in is turned off.' }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  if (!body.passcode || !safeEqual(String(body.passcode), teamPasscode()))
    return NextResponse.json({ error: 'That passcode isn’t right.' }, { status: 401 });
  const db = await getDb();
  let personId: number | null = body.personId ? Number(body.personId) : null;
  if (!personId) {
    const name = String(body.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'Pick your name or add yourself.' }, { status: 400 });
    const email = String(body.email ?? '').trim().toLowerCase() || null;
    const existing = email ? await db.query('SELECT id FROM people WHERE email = $1', [email]) : [];
    personId = existing[0]?.id ?? (await db.query('INSERT INTO people (name, email) VALUES ($1,$2) RETURNING id', [name, email]))[0].id;
  }
  const person = await getPerson(db.query, personId!);
  if (!person || !person.active) return NextResponse.json({ error: 'That person isn’t active.' }, { status: 400 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, makeSessionToken(person.id), cookieOptions);
  return res;
}
