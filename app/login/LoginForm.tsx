'use client';

import { useState } from 'react';

export default function LoginForm({ people }: { people: { id: number; name: string }[] }) {
  const [personId, setPersonId] = useState(people[0] ? String(people[0].id) : 'new');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = personId === 'new' ? { name, email, passcode } : { personId: Number(personId), passcode };
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) window.location.href = '/';
    else {
      setError((await res.json().catch(() => ({}))).error || 'Sign-in failed.');
      setBusy(false);
    }
  };

  return (
    <form className="form-stack" onSubmit={submit}>
      <label className="field">
        <span>Who are you?</span>
        <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="new">I’m not on the list…</option>
        </select>
      </label>
      {personId === 'new' && (
        <>
          <label className="field">
            <span>Your name</span>
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Work email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@getresq.com" />
          </label>
        </>
      )}
      <label className="field">
        <span>Team passcode</span>
        <input type="password" required value={passcode} onChange={(e) => setPasscode(e.target.value)} autoFocus />
      </label>
      {error && <div className="form-error">{error}</div>}
      <button className="btn btn-primary block" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
