

import { useMemo, useState } from 'react';
import { addDays, isWeekend } from '@/lib/dates';
import { canComplete, stepDef } from '@/lib/workflow';
import { canApproveReschedule } from '@/lib/launch';
import { pendingSuggestions, SuggestionCard } from './LaunchDelay';
import { allTasks, Avatar, CategoryBadge, dueLabel, HealthDot, TaskRow, useApp, WeekendFlag } from './ui';

export default function TasksView() {
  const { state, now } = useApp();
  const [who, setWho] = useState<string>(String(state.me.id));
  const horizon = addDays(now.date, 7);

  const tasks = useMemo(
    () =>
      allTasks(state.emails, now)
        .filter((t) => !t.step.completedAt && t.step.dueDate <= horizon)
        .filter((t) => (who === 'all' ? true : who === 'none' ? !t.step.assigneeId : t.step.assigneeId === who))
        .sort((a, b) => `${a.step.dueDate}${a.step.dueTime ?? '23:59'}`.localeCompare(`${b.step.dueDate}${b.step.dueTime ?? '23:59'}`)),
    [state.emails, now, who, horizon],
  );

  const groups: { title: string; rows: TaskRow[]; cls: string }[] = [
    { title: 'Overdue', cls: 'overdue', rows: tasks.filter((t) => t.health === 'overdue') },
    { title: 'Due today', cls: 'today', rows: tasks.filter((t) => t.health === 'today') },
    { title: 'Next 7 days', cls: 'soon', rows: tasks.filter((t) => t.health === 'soon' || t.health === 'ontrack') },
  ];

  return (
    <section className="view">
      <div className="view-toolbar">
        <div className="toolbar-group">
          <h2 className="view-title">My tasks</h2>
          <span className="muted-text">Overdue and due in the next 7 days</span>
        </div>
        <div className="toolbar-group">
          <label className="field-inline">
            Show tasks for
            <select value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="all">Everyone</option>
              {state.people
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id === state.me.id ? `Me (${p.name})` : p.name}
                  </option>
                ))}
              <option value="none">Unassigned</option>
            </select>
          </label>
        </div>
      </div>

      <div className="tasks">
        {canApproveReschedule(state.me) && pendingSuggestions(state.delays).length > 0 && (
          <div className="task-group">
            <h3 className="task-group-title h-text-today">
              Reschedules to approve <span className="count">{pendingSuggestions(state.delays).length}</span>
            </h3>
            {pendingSuggestions(state.delays).map(({ s, delay }) => (
              <SuggestionCard key={s.id} s={s} delay={delay} />
            ))}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.title} className="task-group">
            <h3 className={`task-group-title h-text-${g.cls}`}>
              {g.title} <span className="count">{g.rows.length}</span>
            </h3>
            {g.rows.length ? g.rows.map((t) => <TaskLine key={t.step.id} t={t} />) : <div className="task-empty">Nothing {g.cls === 'overdue' ? 'overdue' : 'here'} 🎉</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

function TaskLine({ t }: { t: TaskRow }) {
  const { state, now, act, toast, openEmail } = useApp();
  const check = canComplete(t.step.key, t.version.steps, state.me);
  const assignee = state.people.find((p) => p.id === t.step.assigneeId);
  return (
    <div className={`task h-border-${t.health}`}>
      <input
        type="checkbox"
        className={check.ok ? '' : 'blocked'}
        title={check.ok ? 'Mark done' : check.reason}
        checked={false}
        onChange={() => (check.ok ? act('completeStep', { id: t.step.id }) : toast(check.reason ?? 'Not allowed'))}
      />
      <button className="task-main" onClick={() => openEmail(t.email.id, t.version.id)}>
        <span className="task-label">
          {stepDef(t.step.key).label}
          {t.step.changesRequested && <span className="flag-mini">Changes requested</span>}
          {!check.ok && check.reason?.includes('first') && <span className="waiting">Waiting on earlier step</span>}
        </span>
        <span className="task-sub">
          <CategoryBadge category={t.email.category} small /> {t.email.title} · {t.version.name}
        </span>
      </button>
      <span className={`task-due h-text-${t.health}`}>
        <HealthDot health={t.health} /> {dueLabel(t.step, now)}
        {isWeekend(t.step.dueDate) && <WeekendFlag />}
      </span>
      <Avatar person={assignee} />
    </div>
  );
}
