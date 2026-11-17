import { redirect } from 'next/navigation';
import { allowedDomain, authMode, currentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { listPeople } from '@/lib/repo';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await currentUser()) redirect('/');
  const mode = authMode();
  const db = await getDb();
  const people = mode === 'passcode' ? (await listPeople(db.query)).filter((p) => p.active).map((p) => ({ id: p.id, name: p.name })) : [];
  const { error } = await searchParams;
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <span className="brand-mark">ResQ</span>
          <span className="brand-sub dark">Email Planner</span>
        </div>
        <p className="muted-text">Plan sends and track every approval, together.</p>
        {mode === 'google' ? (
          <>
            {error && <div className="form-error">{error}</div>}
            <a className="btn btn-primary block" href="/api/auth/google">
              Sign in with Google
            </a>
            <p className="muted-text small">Use your @{allowedDomain()} account.</p>
          </>
        ) : (
          <LoginForm people={people} />
        )}
      </div>
    </div>
  );
}
