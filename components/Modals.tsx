'use client';

import { useState } from 'react';
import { addDays } from '@/lib/dates';
import { ROLE_LABELS, Role } from '@/lib/types';
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

export function NewEmailModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const { act, now, state } = useApp();
  const [title, setTitle] = useState('');
  const [sendDate, setSendDate] = useState(addDays(now.date, 14));
  const [sendTime, setSendTime] = useState('');
  const [versions, setVersions] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    let r;
    if (copyFrom) {
      // Duplicate an existing email, then rename/re-date the copy.
      r = await act('duplicateEmail', { id: Number(copyFrom) });
      if (r?.id) await act('updateEmail', { id: r.id, patch: { title, sendDate, sendTime: sendTime || null } });
    } else {
      const names = versions
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      r = await act('createEmail', { title, sendDate, sendTime: sendTime || null, versions: (names.length ? names : ['Main']).map((name) => ({ name, ownerId: state.me.id })) });
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
  const { state, act } = useApp();
  const admin = state.me.isAdmin;
  const [draft, setDraft] = useState({ name: '', email: '', role: 'member' as Role });

  const save = (p: Partial<Person> & { id: number }) => act('savePerson', { person: p });

  return (
    <Modal title="People & settings" onClose={onClose} wide>
      <div className="modal-body">
        <p className="muted-text">
          Roles decide who can check approvals: <b>Marketing (Kori)</b> checks Stage 1, <b>Ops</b> checks Stage 2. Admins can check either.
          {!admin && ' Only admins can edit this list.'}
        </p>
        <table className="people">
          <thead>
            <tr>
              <th />
              <th>Name</th>
              <th>Email</th>
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
                  <input key={p.name} defaultValue={p.name} disabled={!admin} onBlur={(e) => e.target.value !== p.name && save({ id: p.id, name: e.target.value })} />
                </td>
                <td>
                  <input key={p.email ?? ''} defaultValue={p.email ?? ''} disabled={!admin} placeholder="name@getresq.com" onBlur={(e) => e.target.value !== (p.email ?? '') && save({ id: p.id, email: e.target.value })} />
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
                  <input type="checkbox" checked={p.isAdmin} disabled={!admin} onChange={(e) => save({ id: p.id, isAdmin: e.target.checked })} />
                </td>
                <td>
                  <input type="checkbox" checked={p.active} disabled={!admin || p.id === state.me.id} onChange={(e) => save({ id: p.id, active: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {admin && (
          <form
            className="add-person"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act('savePerson', { person: draft })) setDraft({ name: '', email: '', role: 'member' });
            }}
          >
            <input required placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input placeholder="Email (optional)" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}>
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <button className="btn btn-primary sm">Add person</button>
          </form>
        )}
      </div>
    </Modal>
  );
}
