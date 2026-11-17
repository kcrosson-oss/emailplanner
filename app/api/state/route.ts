import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { previewDelay, listActivity, listDelays, listEmails, listPeople } from '@/lib/repo';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const db = await getDb();
  const activityFor = new URL(req.url).searchParams.get('activity');
  const preview = new URL(req.url).searchParams;
  if (preview.get('previewDelay'))
    return NextResponse.json({ items: await previewDelay(db.query, preview.get('city') ?? '', preview.get('old') ?? '', preview.get('new') ?? '') });
  if (activityFor) return NextResponse.json({ activity: await listActivity(db.query, Number(activityFor)) });
  const [people, emails, delays] = await Promise.all([listPeople(db.query), listEmails(db.query), listDelays(db.query)]);
  return NextResponse.json({ me, people, emails, delays, serverTime: new Date().toISOString() });
}
