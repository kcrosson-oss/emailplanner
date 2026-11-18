

import { useMemo, useState } from 'react';
import { addDays, dayOfWeek, DOW_SHORT, monthLabel, parseDate, prettyDate, shortDate } from '@/lib/dates';
import { emailHealth, HEALTH_LABEL, Health, stepDef, worst } from '@/lib/workflow';
import type { Email } from '@/lib/types';
import { allTasks, HealthDot, sendLabel, TaskRow, useApp } from './ui';
import { pendingSuggestions } from './LaunchDelay';

function startOfMonthGrid(anchor: string) {
  const first = anchor.slice(0, 8) + '01';
  return addDays(first, -dayOfWeek(first));
}

export default function CalendarView() {
  const { state, now, openEmail } = useApp();
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [anchor, setAnchor] = useState(now.date);

  const byDate = useMemo(() => {
    const m = new Map<string, Email[]>();
    for (const e of state.emails) m.set(e.sendDate, [...(m.get(e.sendDate) ?? []), e]);
    return m;
  }, [state.emails]);

  const dueBy = useMemo(() => {
    const m = new Map<string, TaskRow[]>();
    for (const t of allTasks(state.emails, now)) {
      if (t.step.completedAt || t.step.key === 'email_sent') continue;
      m.set(t.step.dueDate, [...(m.get(t.step.dueDate) ?? []), t]);
    }
    return m;
  }, [state.emails, now]);

  const ghosts = useMemo(() => {
    const m = new Map<string, ReturnType<typeof pendingSuggestions>>();
    for (const p of pendingSuggestions(state.delays)) m.set(p.s.suggestedDate, [...(m.get(p.s.suggestedDate) ?? []), p]);
    return m;
  }, [state.delays]);

  const move = (dir: number) => {
    if (mode === 'week') setAnchor(addDays(anchor, dir * 7));
    else {
      const d = parseDate(anchor);
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + dir);
      setAnchor(d.toISOString().slice(0, 10));
    }
  };

  const weekStart = addDays(anchor, -dayOfWeek(anchor));
  const days =
    mode === 'month'
      ? (() => {
          const start = startOfMonthGrid(anchor);
          const lastOfMonth = (() => {
            const d = parseDate(anchor);
            d.setUTCMonth(d.getUTCMonth() + 1, 0);
            return d.toISOString().slice(0, 10);
          })();
          const out: string[] = [];
          for (let d = start; out.length < 42; d = addDays(d, 1)) {
            if (out.length % 7 === 0 && d > lastOfMonth) break;
            out.push(d);
          }
          return out;
        })()
      : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const title = mode === 'month' ? monthLabel(anchor) : `${shortDate(weekStart)} – ${shortDate(addDays(weekStart, 6))}, ${weekStart.slice(0, 4)}`;
  const curMonth = anchor.slice(0, 7);

  return (
    <section className="view">
      <div className="view-toolbar">
        <div className="toolbar-group">
          <button className="btn btn-ghost icon" onClick={() => move(-1)} aria-label="Previous">
            ‹
          </button>
          <button className="btn btn-ghost" onClick={() => setAnchor(now.date)}>
            Today
          </button>
          <button className="btn btn-ghost icon" onClick={() => move(1)} aria-label="Next">
            ›
          </button>
          <h2 className="view-title">{title}</h2>
        </div>
        <div className="toolbar-group">
          <Legend />
          <div className="seg">
            <button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>
              Month
            </button>
            <button className={mode === 'week' ? 'on' : ''} onClick={() => setMode('week')}>
              Week
            </button>
          </div>
        </div>
      </div>

      <div className={`cal cal-${mode}`}>
        {DOW_SHORT.map((d) => (
          <div key={d} className="cal-dow">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const sends = byDate.get(d) ?? [];
          const due = dueBy.get(d) ?? [];
          const dueHealth: Health = due.length ? worst(due.map((t) => t.health)) : 'ontrack';
          const weekend = dayOfWeek(d) === 0 || dayOfWeek(d) === 6;
          return (
            <div key={d} className={`cal-cell ${d.slice(0, 7) !== curMonth && mode === 'month' ? 'muted' : ''} ${d === now.date ? 'today' : ''} ${weekend ? 'wkend' : ''}`}>
              <div className="cal-date">
                <span>{mode === 'week' ? prettyDate(d) : Number(d.slice(8))}</span>
              </div>
              {sends.map((e) => (
                <SendChip key={e.id} email={e} big={mode === 'week'} />
              ))}
              {(ghosts.get(d) ?? []).map(({ s }) => (
                <button key={`g${s.id}`} className="chip ghost" onClick={() => s.emailId && openEmail(s.emailId, s.versionIds[0])} title="Suggested new send date — waiting for approval">
                  <span className="chip-title">⏱ {s.emailTitle}</span>
                  <span className="chip-meta">Suggested · {s.versionNames.join(', ')}</span>
                </button>
              ))}
              {mode === 'month' && due.length > 0 && (
                <button className="cal-due" onClick={() => openEmail(due[0].email.id, due[0].version.id)} title={due.map((t) => `${t.email.title} · ${t.version.name}: ${stepDef(t.step.key).label}`).join('\n')}>
                  <HealthDot health={dueHealth} /> {due.length} step{due.length > 1 ? 's' : ''} due
                </button>
              )}
              {mode === 'week' &&
                due.map((t) => (
                  <button key={t.step.id} className={`cal-task h-border-${t.health}`} onClick={() => openEmail(t.email.id, t.version.id)}>
                    <HealthDot health={t.health} />
                    <span>
                      <b>{stepDef(t.step.key).short}</b>
                      <small>
                        {t.email.title} · {t.version.name}
                      </small>
                    </span>
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SendChip({ email, big }: { email: Email; big?: boolean }) {
  const { now, openEmail } = useApp();
  const h = emailHealth(email.versions, now);
  return (
    <button className={`chip h-chip-${h}`} onClick={() => openEmail(email.id)} title={`${email.title} — ${HEALTH_LABEL[h]}`}>
      <span className="chip-title">
        <span className="chip-send">✉</span> {email.title}
        {email.isLaunch && <span className="launch-tag">Launch</span>}
      </span>
      {email.versions.length > 0 && <TotalProgress email={email} health={h} />}
      {big && <span className="chip-meta">{sendLabel(email)}</span>}
      <span className="chip-versions">
        {email.versions.map((v) => (
          <span key={v.id}>
            {v.name} {v.steps.filter((s) => s.completedAt).length}/{v.steps.length}
          </span>
        ))}
      </span>
    </button>
  );
}

/** Steps done across all versions, e.g. 8/14 for a two-version email. */
function TotalProgress({ email, health }: { email: Email; health: Health }) {
  const all = email.versions.flatMap((v) => v.steps);
  const done = all.filter((s) => s.completedAt).length;
  return (
    <span className="progress wide" title={`${done} of ${all.length} steps done across ${email.versions.length} version(s)`}>
      <span className="progress-track">
        <span className={`progress-fill h-${health}`} style={{ width: `${all.length ? (done / all.length) * 100 : 0}%` }} />
      </span>
      <span className="progress-text">
        {done}/{all.length} steps
      </span>
    </span>
  );
}

export function Legend() {
  return (
    <span className="legend">
      {(['overdue', 'today', 'soon', 'ontrack', 'done'] as Health[]).map((h) => (
        <span key={h}>
          <span className={`dot h-${h}`} /> {HEALTH_LABEL[h]}
        </span>
      ))}
    </span>
  );
}
