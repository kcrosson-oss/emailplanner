

import { useEffect, useState } from 'react';
import { addDays } from '@/lib/dates';
import { ROLE_LABELS, Role } from '@/lib/types';
import { CATEGORIES, guessCategory, type Category } from '@/lib/categories';
import type { Person } from '@/lib/types';
import { Avatar, useApp } from './ui';

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function NewEmailModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { act, now, state } = useApp();
  const [title, setTitle] = useState('');
  const [sendDate, setSendDate] = useState(addDays(now.date, 14));
  const [sendTime, setSendTime] = useState('');
  const [versions, setVersions] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [category, setCategory] = useState<Category | ''>('');
  const cat: Category = category || guessCategory(title);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    let r;
    if (copyFrom) {
      // Duplicate an existing email, then rename/re-date the copy.
      r = await act('duplicateEmail', { id: copyFrom });
      if (r?.id) await act('updateEmail', { id: r.id, patch: { title, sendDate, sendTime: sendTime || null, category: cat } });
    } else {
      const names = versions
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      r = await act('createEmail', { title, sendDate, sendTime: sendTime || null, category: cat, versions: (names.length ? names : ['Main']).map((name) => ({ name, ownerId: state.me.id })) });
    }
    setSaving(false);
    if (r?.id) onCreated(r.id);
  };

  return (
    <Modal title="New email" onClose={onClose}>
      <form className="modal-body form-stack" onSubmit={submit}>
        <label className="field">
          <span>Title / topic</span>
          <input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Houston Launch Email" />
        </label>
        <div className="field">
          <span>Category</span>
          <div className="cat-pick">
            {CATEGORIES.map((c) => (
              <button
                type="button"
                key={c.id}
                className={`cat-opt ${cat === c.id ? 'on' : ''}`}
                style={cat === c.id ? { background: c.bg, color: c.color, borderColor: c.bg } : {}}
                onClick={() => setCategory(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div className="row-2">
          <label className="field">
            <span>Send date</span>
            <input type="date" required value={sendDate} onChange={(e) => setSendDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Send time (ET, optional)</span>
            <input type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Start from</span>
          <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">Blank email</option>
            {state.emails.map((e) => (
              <option key={e.id} value={e.id}>
                Copy of “{e.title}” (versions, audiences, links)
              </option>
            ))}
          </select>
        </label>
        {!copyFrom && (
          <label className="field">
            <span>Versions (comma-separated)</span>
            <input value={versions} onChange={(e) => setVersions(e.target.value)} placeholder="e.g. Trades, Facilities — leave blank for one version" />
          </label>
        )}
        <p className="muted-text small">Due dates are filled in automatically from the send date — you can change any of them later.</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={saving || !title.trim()}>
            {saving ? 'Creating…' : 'Create email'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { state, act, searchPeople } = useApp();
  const admin = state.me.isAdmin;
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; name: string; email?: string }[]>([]);
  const [role, setRole] = useState<Role>('ops');

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const r = await searchPeople(q);
      if (live) setHits(r.filter((h) => !state.people.some((p) => p.id === h.id)).slice(0, 6));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, searchPeople, state.people]);

  const save = (p: Partial<Person> & { id: string }) => act('savePerson', { person: p });

  return (
    <Modal title="People & roles" onClose={onClose} wide>
      <div className="modal-body">
        <p className="muted-text">
          Roles decide who can check what: <b>Marketing (Kori)</b> submits the creative brief and checks Stage 1; <b>Ops</b> notes the audience brief, checks Stage 2 and reports launch delays; <b>Brand (Fran)</b> or Kori signs off the test send. Admins can do anything.
          Anyone who opens the planner shows up here as a team member.
          {!admin && ' Only admins can change roles.'}
        </p>
        <table className="people">
          <thead>
            <tr>
              <th />
              <th>Name</th>
              <th>Role</th>
              <th>Admin</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {state.people.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'inactive'}>
                <td>
                  <Avatar person={p} />
                </td>
                <td>
                  {p.name}
                  {p.id === state.me.id && <span className="muted-text"> (you)</span>}
                  {p.email && <div className="small muted-text">{p.email}</div>}
                </td>
                <td>
                  <select value={p.role} disabled={!admin} onChange={(e) => save({ id: p.id, role: e.target.value as Role })}>
                    {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input type="checkbox" checked={p.isAdmin} disabled={!admin || p.id === state.me.id} onChange={(e) => save({ id: p.id, isAdmin: e.target.checked })} />
                </td>
                <td>
                  <input type="checkbox" checked={p.active} disabled={!admin || p.id === state.me.id} onChange={(e) => save({ id: p.id, active: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {admin && (
          <div className="add-person-box">
            <div className="field">
              <span>Add a teammate before they’ve opened the planner</span>
              <div className="add-person">
                <input placeholder="Search ResQ people by name…" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setQ((x) => x)} />
                <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {hits.map((h) => (
              <div key={h.id} className="hit">
                <span>
                  <b>{h.name}</b> {h.email && <span className="muted-text">· {h.email}</span>}
                </span>
                <button className="btn btn-primary sm" onClick={() => save({ id: h.id, role, label: h.name } as any)}>
                  Add as {ROLE_LABELS[role]}
                </button>
              </div>
            ))}
            {q && !hits.length && <div className="small muted-text">No one found. They can also just open the planner link, then you set their role here.</div>}
          </div>
        )}
      </div>
    </Modal>
  );
}
