

import { useEffect, useState } from 'react';
import type { Activity, Email, Link, Step, Version } from '@/lib/types';
import { isWeekend, prettyDate } from '@/lib/dates';
import { tagUrl, topicSlug } from '@/lib/utm';
import { canComplete, emailHealth, hasRole, stepDef, stepHealth, versionHealth } from '@/lib/workflow';
import { pendingSuggestions, SuggestionCard } from './LaunchDelay';
import { Avatar, fmtStamp, HealthDot, HealthPill, personName, ProgressBar, useApp, WeekendFlag } from './ui';

export default function EmailDrawer({ email, initialVersionId, onClose }: { email: Email; initialVersionId?: string; onClose: () => void }) {
  const { state, now, act, openEmail, ask, askText } = useApp();
  const [vid, setVid] = useState<string | undefined>(initialVersionId ?? email.versions[0]?.id);
  const version = email.versions.find((v) => v.id === vid) ?? email.versions[0];
  const health = emailHealth(email.versions, now);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (version) openEmail(email.id, version.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version?.id]);

  const saveEmail = (patch: Record<string, unknown>) => act('updateEmail', { id: email.id, patch });

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={email.title}>
        <div className="drawer-head">
          <div className="drawer-title-row">
            <input
              key={`title-${email.title}`}
              className="title-input"
              defaultValue={email.title}
              onBlur={(e) => e.target.value.trim() !== email.title && saveEmail({ title: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <button className="btn btn-ghost icon" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          <div className="drawer-meta">
            <HealthPill health={health} />
            <label className="field-inline">
              Send
              <input
                key={`sd-${email.sendDate}`}
                type="date"
                defaultValue={email.sendDate}
                onBlur={(e) => e.target.value && e.target.value !== email.sendDate && saveEmail({ sendDate: e.target.value })}
              />
              <input
                key={`st-${email.sendTime}`}
                type="time"
                defaultValue={email.sendTime ?? ''}
                onBlur={(e) => (e.target.value || null) !== email.sendTime && saveEmail({ sendTime: e.target.value || null })}
              />
              <span className="muted-text">ET</span>
            </label>
            {isWeekend(email.sendDate) && <WeekendFlag />}
            <label className={`launch-toggle ${email.isLaunch ? 'on' : ''}`} title="Launch emails get rescheduled when Ops reports a city launch delay">
              <input type="checkbox" checked={email.isLaunch} onChange={(e) => saveEmail({ isLaunch: e.target.checked })} /> Launch email
            </label>
            <span className="utm-slug" title="UTM campaign (same for all versions)">
              campaign: <code>{topicSlug(email.title)}</code>
            </span>
            <div className="spacer" />
            <button className="btn btn-ghost sm" onClick={async () => {
              const r = await act('duplicateEmail', { id: email.id });
              if (r?.id) openEmail(r.id);
            }}>
              Duplicate email
            </button>
            <button className="btn btn-ghost sm" title="Recalculate every step’s due date from the send date" onClick={async () => (await ask('Reset all due dates on this email to the defaults?', { confirm: 'Reset' })) && act('resetDueDates', { id: email.id })}>
              Reset due dates
            </button>
            <button
              className="btn btn-ghost sm danger"
              onClick={async () => {
                if (await ask(`Delete “${email.title}” and all its versions? This can’t be undone.`, { confirm: 'Delete', danger: true })) {
                  await act('deleteEmail', { id: email.id });
                  onClose();
                }
              }}
            >
              Delete
            </button>
          </div>

          <div className="vtabs">
            {email.versions.map((v) => (
              <button key={v.id} className={`vtab ${v.id === version?.id ? 'on' : ''}`} onClick={() => setVid(v.id)}>
                <HealthDot health={versionHealth(v.steps, now)} />
                {v.name}
                <span className="vtab-count">
                  {v.steps.filter((s) => s.completedAt).length}/{v.steps.length}
                </span>
              </button>
            ))}
            <button
              className="vtab add"
              onClick={async () => {
                const name = await askText('Name for the new version (e.g. a city or audience):', 'e.g. Chicago');
                if (name?.trim()) {
                  const r = await act('addVersion', { emailId: email.id, name: name.trim() });
                  if (r?.id) setVid(r.id);
                }
              }}
            >
              + Version
            </button>
          </div>
        </div>

        {version && (
          <div className="drawer-body">
            {pendingSuggestions(state.delays)
              .filter((p) => p.s.emailId === email.id)
              .map(({ s, delay }) => (
                <SuggestionCard key={s.id} s={s} delay={delay} />
              ))}
            <BriefPanel email={email} />
            <VersionPanel email={email} version={version} onSwitch={setVid} />
            <ActivityPanel email={email} />
          </div>
        )}
      </aside>
    </>
  );
}

function VersionPanel({ email, version, onSwitch }: { email: Email; version: Version; onSwitch: (id: string) => void }) {
  const { state, now, act, ask } = useApp();
  const vh = versionHealth(version.steps, now);
  const save = (patch: Partial<Version>) => act('updateVersion', { id: version.id, patch });

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>
            Approval steps <span className="muted-text">· {version.name}</span>
          </h3>
          <ProgressBar steps={version.steps} health={vh} wide />
        </div>
        <div className="steps">
          {version.steps.map((s) => (
            <StepRow key={s.id} step={s} version={version} />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Version details</h3>
          <div className="toolbar-group">
            <button
              className="btn btn-ghost sm"
              onClick={async () => {
                const r = await act('duplicateVersion', { id: version.id });
                if (r?.id) onSwitch(r.id);
              }}
            >
              Duplicate version
            </button>
            <button
              className="btn btn-ghost sm danger"
              disabled={email.versions.length < 2}
              title={email.versions.length < 2 ? 'An email needs at least one version' : ''}
              onClick={async () => (await ask(`Remove the “${version.name}” version?`, { confirm: 'Remove', danger: true })) && act('deleteVersion', { id: version.id })}
            >
              Remove version
            </button>
          </div>
        </div>
        <div className="form-grid">
          <Field label="Version name" value={version.name} onSave={(v) => save({ name: v })} />
          <label className="field">
            <span>Owner</span>
            <select value={version.ownerId ?? ''} onChange={(e) => save({ ownerId: e.target.value || null })}>
              <option value="">—</option>
              {state.people.filter((p) => p.active || p.id === version.ownerId).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {email.isLaunch && (
            <Field label="Launch city (for launch delays)" value={version.city} onSave={(v) => save({ city: v })} wide placeholder="e.g. Chicago" />
          )}
          <Field label="Audience / segment" value={version.audience} onSave={(v) => save({ audience: v })} wide />
          <Field label="Exclusions — audience brief, noted by Ops (one per line)" value={version.exclusions} onSave={(v) => save({ exclusions: v })} multiline wide />
          <Field label="Subject line" value={version.subject} onSave={(v) => save({ subject: v })} wide placeholder="Not written yet" />
          <Field label="Preheader" value={version.preheader} onSave={(v) => save({ preheader: v })} wide />
          <Field label="Preview link" value={version.previewUrl} onSave={(v) => save({ previewUrl: v })} wide placeholder="https://…" link />
          <Field label="Notes" value={version.notes} onSave={(v) => save({ notes: v })} multiline wide />
        </div>
      </section>

      <LinksPanel email={email} version={version} />
    </>
  );
}

function BriefPanel({ email }: { email: Email }) {
  const { act } = useApp();
  const b = email.brief;
  const filled = [b.goal, b.keyMessage, b.cta, b.notes, b.link].some((x) => x.trim());
  const [open, setOpen] = useState(!filled);
  const save = (k: keyof typeof b) => (v: string) => act('updateEmail', { id: email.id, patch: { brief: { [k]: v } } });
  const briefStep = email.versions[0]?.steps.find((s) => s.key === 'creative_brief');
  return (
    <section className="panel brief">
      <div className="panel-head">
        <h3>
          Creative brief <span className="muted-text">· shared by all versions</span>
        </h3>
        <div className="toolbar-group">
          {briefStep?.completedAt ? <span className="tag ok">Submitted</span> : <span className="tag warn">Not submitted yet</span>}
          <button className="btn btn-ghost sm" onClick={() => setOpen((o) => !o)}>
            {open ? 'Collapse' : filled ? 'View / edit' : 'Write brief'}
          </button>
        </div>
      </div>
      {!open && filled && (
        <p className="brief-summary">
          {b.goal && <><b>Goal:</b> {b.goal} </>}
          {b.keyMessage && <><b>Message:</b> {b.keyMessage}</>}
        </p>
      )}
      {open && (
        <div className="form-grid">
          <Field label="Goal — what should this email achieve?" value={b.goal} onSave={save('goal')} wide multiline placeholder="e.g. Get Houston restaurants to book a free systems check" />
          <Field label="Key message" value={b.keyMessage} onSave={save('keyMessage')} wide multiline placeholder="The one thing readers should remember" />
          <Field label="Call to action / offer" value={b.cta} onSave={save('cta')} wide placeholder="e.g. Book your free systems check" />
          <Field label="Notes for design (tone, imagery, must-haves)" value={b.notes} onSave={save('notes')} wide multiline />
          <Field label="Brief doc link (optional)" value={b.link} onSave={save('link')} wide placeholder="https://docs.google.com/…" link />
          <p className="small muted-text wide-note">When it’s ready, check “Creative Brief Submitted” in each version’s steps below.</p>
        </div>
      )}
    </section>
  );
}

function Field({ label, value, onSave, multiline, wide, placeholder, link }: { label: string; value: string; onSave: (v: string) => void; multiline?: boolean; wide?: boolean; placeholder?: string; link?: boolean }) {
  const common = {
    defaultValue: value,
    placeholder,
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => e.target.value !== value && onSave(e.target.value),
  };
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span>
        {label}
        {link && value && (
          <a href={value} target="_blank" rel="noreferrer" className="open-link">
            Open ↗
          </a>
        )}
      </span>
      {multiline ? <textarea key={value} rows={Math.max(2, value.split('\n').length)} {...common} /> : <input key={value} {...common} />}
    </label>
  );
}

function StepRow({ step, version }: { step: Step; version: Version }) {
  const { state, now, act, toast } = useApp();
  const def = stepDef(step.key);
  const h = stepHealth(step, now);
  const check = step.completedAt ? hasRole(step.key, state.me) : canComplete(step.key, version.steps, state.me);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');

  const toggle = () => {
    if (!check.ok) return toast(check.reason ?? 'Not allowed');
    act(step.completedAt ? 'reopenStep' : 'completeStep', { id: step.id });
  };

  return (
    <div className={`step ${step.completedAt ? 'is-done' : ''} h-border-${h}`}>
      <div className="step-main">
        <input type="checkbox" className={check.ok ? '' : 'blocked'} checked={!!step.completedAt} onChange={toggle} title={check.ok ? '' : check.reason} />
        <div className="step-text">
          <div className="step-label">
            {def.label}
            {def.hint && <span className="hint">{def.hint}</span>}
          </div>
          {step.completedAt ? (
            <div className="step-done">
              ✓ {personName(state.people, step.completedById)} · {fmtStamp(step.completedAt)}
            </div>
          ) : (
            !check.ok && <div className="step-blocked">{check.reason}</div>
          )}
          {step.changesRequested && (
            <div className="changes">
              <b>Changes requested:</b> {step.changesNote}
            </div>
          )}
        </div>
        <div className="step-controls">
          <select
            className="assignee"
            value={step.assigneeId ?? ''}
            onChange={(e) => act('updateStep', { id: step.id, patch: { assigneeId: e.target.value || null } })}
            title="Assignee"
          >
            <option value="">Unassigned</option>
            {state.people.filter((p) => p.active || p.id === step.assigneeId).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className={`due h-text-${h}`}>
            <input
              key={`d-${step.dueDate}`}
              type="date"
              defaultValue={step.dueDate}
              title={prettyDate(step.dueDate)}
              onBlur={(e) => e.target.value && e.target.value !== step.dueDate && act('updateStep', { id: step.id, patch: { dueDate: e.target.value } })}
            />
            <input
              key={`t-${step.dueTime}`}
              type="time"
              defaultValue={step.dueTime ?? ''}
              onBlur={(e) => (e.target.value || null) !== step.dueTime && act('updateStep', { id: step.id, patch: { dueTime: e.target.value || null } })}
            />
          </div>
          <div className="step-flags">
            {!step.completedAt && <HealthDot health={h} />}
            {isWeekend(step.dueDate) && <WeekendFlag />}
            {def.kind === 'approve' && (
              <button className="link-btn" onClick={() => setAsking((a) => !a)}>
                Request changes
              </button>
            )}
          </div>
        </div>
      </div>
      {asking && (
        <div className="request">
          <textarea autoFocus rows={2} placeholder={`What needs to change? This re-opens “${def.track === 'design' ? 'Design Submitted' : 'Audiences Submitted'}”.`} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="request-actions">
            <button className="btn btn-ghost sm" onClick={() => setAsking(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary sm"
              disabled={!note.trim()}
              onClick={async () => {
                const r = await act('requestChanges', { id: step.id, comment: note });
                if (r) {
                  setAsking(false);
                  setNote('');
                }
              }}
            >
              Send back for changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LinksPanel({ email, version }: { email: Email; version: Version }) {
  const { act, toast } = useApp();
  const [links, setLinks] = useState<Link[]>(version.links);
  const serialized = JSON.stringify(version.links);
  useEffect(() => setLinks(JSON.parse(serialized)), [serialized]);

  const commit = (next: Link[]) => {
    const clean = next.filter((l) => l.label.trim() || l.url.trim());
    if (JSON.stringify(clean) !== serialized) act('updateVersion', { id: version.id, patch: { links: clean } });
  };
  const copy = async (text: string, what = 'Link') => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied`, 'ok');
    } catch {
      toast('Your browser blocked copying — select the link and copy it by hand.');
    }
  };
  const tagged = links.filter((l) => l.url.trim()).map((l) => ({ ...l, tagged: tagUrl(l.url, email.sendDate, email.title) }));

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Links with UTM tags</h3>
        <div className="toolbar-group">
          {tagged.length > 1 && (
            <button className="btn btn-ghost sm" onClick={() => copy(tagged.map((l) => `${l.label}: ${l.tagged}`).join('\n'), 'All links')}>
              Copy all
            </button>
          )}
          <button className="btn btn-ghost sm" onClick={() => setLinks([...links, { label: '', url: '' }])}>
            + Link
          </button>
        </div>
      </div>
      <div className="links">
        {links.map((l, i) => {
          const t = l.url.trim() ? tagUrl(l.url, email.sendDate, email.title) : '';
          const upd = (patch: Partial<Link>) => setLinks(links.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <div key={i} className="link-row">
              <div className="link-inputs">
                <input className="link-label" placeholder="Label" value={l.label} onChange={(e) => upd({ label: e.target.value })} onBlur={() => commit(links)} />
                <input className="link-url" placeholder="https://…" value={l.url} onChange={(e) => upd({ url: e.target.value })} onBlur={() => commit(links)} />
                <button className="btn btn-ghost icon sm" title="Remove link" onClick={() => {
                  const next = links.filter((_, j) => j !== i);
                  setLinks(next);
                  commit(next);
                }}>
                  ✕
                </button>
              </div>
              {t && (
                <div className="tagged">
                  <code title={t}>{t}</code>
                  <button className="btn btn-accent sm" onClick={() => copy(t)}>
                    Copy
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {!links.length && <div className="muted-text">No links yet.</div>}
      </div>
    </section>
  );
}

function ActivityPanel({ email }: { email: Email }) {
  const { state, act, watchActivity } = useApp();
  const [items, setItems] = useState<Activity[]>([]);
  const [text, setText] = useState('');

  useEffect(() => watchActivity(email.id, setItems), [email.id, watchActivity]);
  const load = () => {};

  const versionName = (id: string | null) => email.versions.find((v) => v.id === id)?.name;

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Comments & activity</h3>
      </div>
      <form
        className="comment-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          if (await act('comment', { emailId: email.id, text })) {
            setText('');
            load();
          }
        }}
      >
        <Avatar person={state.me} size={28} />
        <input placeholder="Write a comment…" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-primary sm" disabled={!text.trim()}>
          Post
        </button>
      </form>
      <ul className="activity">
        {items.map((a) => {
          const p = state.people.find((x) => x.id === a.personId);
          return (
            <li key={a.id} className={`act act-${a.kind}`}>
              <Avatar person={p} size={24} />
              <div>
                {a.kind === 'comment' ? (
                  <>
                    <b>{p?.name ?? 'Someone'}</b> <span className="muted-text">{fmtStamp(a.createdAt)}</span>
                    {a.versionId && versionName(a.versionId) && <span className="tag sm">{versionName(a.versionId)}</span>}
                    <div className="comment-body">{a.message}</div>
                  </>
                ) : (
                  <>
                    <b>{p?.name ?? 'Someone'}</b> {a.message} <span className="muted-text">· {fmtStamp(a.createdAt)}</span>
                  </>
                )}
              </div>
            </li>
          );
        })}
        {!items.length && <li className="muted-text">No activity yet.</li>}
      </ul>
    </section>
  );
}
