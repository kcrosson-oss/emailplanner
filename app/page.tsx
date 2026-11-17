import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { listDelays, listEmails, listPeople } from '@/lib/repo';
import App from '@/components/App';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const me = await currentUser();
  if (!me) redirect('/login');
  const db = await getDb();
  const [people, emails, delays] = await Promise.all([listPeople(db.query), listEmails(db.query), listDelays(db.query)]);
  return <App initial={{ me, people, emails, delays, serverTime: new Date().toISOString() }} />;
}
