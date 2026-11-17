import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import * as repo from '@/lib/repo';
import { UserError } from '@/lib/repo';

export const dynamic = 'force-dynamic';

// Every change in the app goes through this one endpoint: { type: '...', ...fields }.
// Each runs in a transaction and is checked against the workflow rules server-side.
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  const a = await req.json().catch(() => ({}));
  const db = await getDb();
  try {
    const result = await db.tx(async (q) => {
      switch (a.type) {
        case 'createEmail':
          return { id: await repo.createEmail(q, a, me.id) };
        case 'updateEmail':
          return repo.updateEmail(q, a.id, a.patch ?? {}, me.id);
        case 'deleteEmail':
          return repo.deleteEmail(q, a.id);
        case 'duplicateEmail':
          return { id: await repo.duplicateEmail(q, a.id, me.id) };
        case 'resetDueDates':
          return repo.resetDueDates(q, a.id, me.id);
        case 'addVersion':
          return { id: await repo.addVersion(q, a.emailId, { name: a.name }, me.id) };
        case 'duplicateVersion':
          return { id: await repo.duplicateVersion(q, a.id, me.id) };
        case 'updateVersion':
          return repo.updateVersion(q, a.id, a.patch ?? {}, me.id);
        case 'deleteVersion':
          return repo.deleteVersion(q, a.id, me.id);
        case 'completeStep':
          return repo.completeStep(q, a.id, me);
        case 'reopenStep':
          return repo.reopenStep(q, a.id, me);
        case 'requestChanges':
          return repo.requestChanges(q, a.id, me, a.comment);
        case 'updateStep':
          return repo.updateStep(q, a.id, a.patch ?? {}, me.id);
        case 'moveVersion':
          return repo.moveVersion(q, a.id, a.stage, me);
        case 'comment':
          return repo.addComment(q, a.emailId, a.versionId ?? null, me.id, a.text);
        case 'reportDelay':
          return { id: await repo.reportDelay(q, a, me) };
        case 'approveReschedule':
          return repo.decideSuggestion(q, a.id, 'approve', me, { date: a.date, note: a.note });
        case 'declineReschedule':
          return repo.decideSuggestion(q, a.id, 'decline', me, { note: a.note });
        case 'savePerson':
          return repo.upsertPerson(q, a.person ?? {}, me);
        default:
          throw new UserError('Unknown action.');
      }
    });
    return NextResponse.json({ ok: true, ...(result ?? {}) });
  } catch (e: any) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e?.code === '23505') return NextResponse.json({ error: 'That email address is already used by someone else.' }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: 'Something went wrong saving that. Please try again.' }, { status: 500 });
  }
}
