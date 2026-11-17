'use client';

import { createContext, useContext } from 'react';
import type { AppState, Email, Person, Step, Version } from '@/lib/types';
import { Health, HEALTH_LABEL, Now, progress, stepHealth } from '@/lib/workflow';
import { addDays, prettyDate, prettyTime, shortDate } from '@/lib/dates';

export type Act = (type: string, payload?: Record<string, unknown>) => Promise<any>;

export interface Ctx {
  state: AppState;
  now: Now;
  act: Act;
  openEmail: (id: number, versionId?: number) => void;
  toast: (msg: string, kind?: 'error' | 'ok') => void;
}
export const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

export function personName(people: Person[], id: number | null | undefined) {
  if (!id) return 'Unassigned';
  return people.find((p) => p.id === id)?.name ?? 'Unknown';
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

const AVATAR_COLORS = ['#2E7C8A', '#FF4801', '#163A40', '#C6A15B', '#2463A6', '#237A52', '#C33449'];
export function Avatar({ person, size = 22 }: { person?: Person | null; size?: number }) {
  if (!person) return <span className="avatar avatar-empty" style={{ width: size, height: size }} title="Unassigned">?</span>;
  return (
    <span className="avatar" title={person.name} style={{ width: size, height: size, fontSize: size * 0.42, background: AVATAR_COLORS[person.id % AVATAR_COLORS.length] }}>
      {initials(person.name)}
    </span>
  );
}

export function HealthDot({ health, title }: { health: Health; title?: string }) {
  return <span className={`dot h-${health}`} title={title ?? HEALTH_LABEL[health]} />;
}

export function HealthPill({ health }: { health: Health }) {
  return <span className={`pill h-${health}`}>{HEALTH_LABEL[health]}</span>;
}

export function ProgressBar({ steps, health, wide }: { steps: Step[]; health: Health; wide?: boolean }) {
  const p = progress(steps);
  return (
    <span className={`progress ${wide ? 'wide' : ''}`} title={`${p.done} of ${p.total} steps done`}>
      <span className="progress-track">
        <span className={`progress-fill h-${health}`} style={{ width: `${(p.done / p.total) * 100}%` }} />
      </span>
      <span className="progress-text">
        {p.done}/{p.total}
      </span>
    </span>
  );
}

export function WeekendFlag() {
  return (
    <span className="weekend" title="This deadline falls on a weekend">
      Weekend
    </span>
  );
}

export function dueLabel(step: Pick<Step, 'dueDate' | 'dueTime'>, now?: Now) {
  let d = prettyDate(step.dueDate);
  if (now) {
    if (step.dueDate === now.date) d = 'Today';
    else if (step.dueDate === addDays(now.date, 1)) d = 'Tomorrow';
    else if (step.dueDate === addDays(now.date, -1)) d = 'Yesterday';
  }
  return step.dueTime ? `${d} · ${prettyTime(step.dueTime)} ET` : d;
}

export function sendLabel(e: Email) {
  return `${prettyDate(e.sendDate)}${e.sendTime ? ' · ' + prettyTime(e.sendTime) + ' ET' : ''}`;
}

export interface TaskRow {
  email: Email;
  version: Version;
  step: Step;
  health: Health;
}

export function allTasks(emails: Email[], now: Now): TaskRow[] {
  const out: TaskRow[] = [];
  for (const email of emails)
    for (const version of email.versions) for (const step of version.steps) out.push({ email, version, step, health: stepHealth(step, now) });
  return out;
}

export function fmtStamp(isoStr: string) {
  const d = new Date(isoStr);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export { shortDate };
