

import { useMemo, useState } from 'react';
import { addDays, daysBetween, isWeekend, parseDate, shortDate } from '@/lib/dates';
import { emailHealth, stepDef, stepHealth, versionHealth, worst } from '@/lib/workflow';
import type { Step } from '@/lib/types';
import { CategoryBadge, HealthDot, ProgressBar, useApp } from './ui';
import { Legend } from './CalendarView';

const COL = 34;

export default function TimelineView() {
  const { state, now, openEmail } = useApp();
  const [hideSent, setHideSent] = useState(false);

  const emails = state.emails.filter((e) => !(hideSent && emailHealth(e.versions, now) === 'done'));

  const [start, end] = useMemo(() => {
    const dates = [now.date, ...emails.flatMap((e) => [e.sendDate, ...e.versions.flatMap((v) => v.steps.map((s) => s.dueDate))])];
    dates.sort();
    return [addDays(dates[0], -2), addDays(dates[dates.length - 1], 3)];
  }, [emails, now.date]);

  const days = Array.from({ length: daysBetween(start, end) + 1 }, (_, i) => addDays(start, i));
  const x = (d: string) => daysBetween(start, d) * COL;
  const width = days.length * COL;

  return (
    <section className="view">
      <div className="view-toolbar">
        <div className="toolbar-group">
          <h2 className="view-title">Timeline</h2>
          <span className="muted-text">Each dot is a step’s due date; the flag is the send.</span>
        </div>
        <div className="toolbar-group">
          <Legend />
          <label className="check-inline">
            <input type="checkbox" checked={hideSent} onChange={(e) => setHideSent(e.target.checked)} /> Hide sent
          </label>
        </div>
      </div>

      <div className="tl">
        <div className="tl-labels">
          <div className="tl-head-label">Email / version</div>
          {emails.map((e) => (
            <div key={e.id}>
              <button className="tl-email-label" onClick={() => openEmail(e.id)}>
                <HealthDot health={emailHealth(e.versions, now)} />
                <span className="tl-title">
                  <CategoryBadge category={e.category} small />
                  <span>{e.title}</span>
                </span>
              </button>
              {e.versions.map((v) => (
                <button key={v.id} className="tl-version-label" onClick={() => openEmail(e.id, v.id)}>
                  <span>{v.name}</span>
                  <ProgressBar steps={v.steps} health={versionHealth(v.steps, now)} />
                </button>
              ))}
            </div>
          ))}
          {!emails.length && <div className="tl-version-label">No emails yet</div>}
        </div>

        <div className="tl-scroll">
          <div className="tl-canvas" style={{ width }}>
            <div className="tl-head">
              {days.map((d) => (
                <div key={d} className={`tl-day ${isWeekend(d) ? 'wk' : ''} ${d === now.date ? 'now' : ''}`} style={{ width: COL }}>
                  {parseDate(d).getUTCDate() === 1 || d === start ? <span className="tl-month">{shortDate(d).split(' ')[0]}</span> : null}
                  <span>{parseDate(d).getUTCDate()}</span>
                  <small>{'SMTWTFS'[parseDate(d).getUTCDay()]}</small>
                </div>
              ))}
            </div>
            <div className="tl-grid">
              {days.map((d) => isWeekend(d) && <div key={d} className="tl-wk-shade" style={{ left: x(d), width: COL }} />)}
              <div className="tl-today" style={{ left: x(now.date) + COL / 2 }}>
                <span>Today</span>
              </div>
              {emails.map((e) => (
                <div key={e.id}>
                  <div className="tl-row tl-row-email" />
                  {e.versions.map((v) => {
                    const first = [...v.steps].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]?.dueDate ?? e.sendDate;
                    const groups = new Map<string, Step[]>();
                    for (const s of v.steps) if (s.key !== 'email_sent') groups.set(s.dueDate, [...(groups.get(s.dueDate) ?? []), s]);
                    const sent = v.steps.find((s) => s.key === 'email_sent');
                    const sentH = sent ? stepHealth(sent, now) : 'ontrack';
                    return (
                      <div key={v.id} className="tl-row" onClick={() => openEmail(e.id, v.id)}>
                        <div className={`tl-bar h-bar-${versionHealth(v.steps, now)}`} style={{ left: x(first) + COL / 2, width: Math.max(0, x(e.sendDate) - x(first)) }} />
                        {[...groups.entries()].map(([d, ss]) => {
                          const h = worst(ss.map((s) => stepHealth(s, now)));
                          const done = ss.filter((s) => s.completedAt).length;
                          return (
                            <span
                              key={d}
                              className={`tl-dot h-${h}`}
                              style={{ left: x(d) + COL / 2 }}
                              title={`${shortDate(d)}${isWeekend(d) ? ' (weekend)' : ''}\n` + ss.map((s) => `${s.completedAt ? '✓' : '○'} ${stepDef(s.key).label}${s.dueTime ? ' by ' + s.dueTime + ' ET' : ''}`).join('\n')}
                            >
                              {ss.length > 1 ? `${done}/${ss.length}` : done ? '✓' : ''}
                            </span>
                          );
                        })}
                        <span className={`tl-flag h-${sentH}`} style={{ left: x(e.sendDate) + COL / 2 }} title={`Send: ${shortDate(e.sendDate)}`}>
                          ✉
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
