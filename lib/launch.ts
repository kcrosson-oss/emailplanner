// Launch delays: when a city launch slips, Ops reports it, and every launch email for
// that city gets a suggested new send date for the email planner to approve.
// Pure functions — no database — so they're easy to test.

import { addDays, daysBetween, dayOfWeek } from './dates';
import type { Person } from './types';

export const normCity = (c: string) => c.trim().toLowerCase().replace(/\s+/g, ' ');

/** Versions of a launch email that go to this city and haven't been sent yet. */
export function affectedVersions<V extends { id: number; city: string; steps: { key: string; completedAt: string | null }[] }>(
  email: { isLaunch: boolean; versions: V[] },
  city: string,
): V[] {
  if (!email.isLaunch || !normCity(city)) return [];
  return email.versions.filter(
    (v) => normCity(v.city) === normCity(city) && !v.steps.find((s) => s.key === 'email_sent')?.completedAt,
  );
}

/**
 * Suggested new send date: shift the send date by however long the launch slipped,
 * then bump a weekend send to the following Monday.
 */
export function suggestSendDate(sendDate: string, oldLaunch: string, newLaunch: string): { date: string; movedOffWeekend: boolean } {
  let date = addDays(sendDate, daysBetween(oldLaunch, newLaunch));
  const w = dayOfWeek(date);
  if (w === 6) return { date: addDays(date, 2), movedOffWeekend: true };
  if (w === 0) return { date: addDays(date, 1), movedOffWeekend: true };
  return { date, movedOffWeekend: false };
}

/** Move the whole email if every version is affected; otherwise split the city's versions into their own email. */
export function reschedulePlan(totalVersions: number, affected: number): 'move' | 'split' {
  return affected >= totalVersions ? 'move' : 'split';
}

export const canReportDelay = (u: Pick<Person, 'role' | 'isAdmin'>) => u.isAdmin || u.role === 'ops';
export const canApproveReschedule = (u: Pick<Person, 'role' | 'isAdmin'>) => u.isAdmin || u.role === 'marketing';

/** Shift a hand-edited due date by the same number of days the send moved. */
export const shiftDate = (d: string, fromSend: string, toSend: string) => addDays(d, daysBetween(fromSend, toSend));
