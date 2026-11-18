import { describe, expect, it } from 'vitest';
import { affectedVersions, canApproveReschedule, canReportDelay, reschedulePlan, shiftDate, suggestSendDate } from '@/lib/launch';

const v = (id: string, city: string, sent = false) => ({ id, city, steps: [{ key: 'email_sent', completedAt: sent ? 'x' : null }] });

describe('launch delays', () => {
  it('finds unsent versions for the city on launch emails only', () => {
    const email = { isLaunch: true, versions: [v('1', 'Boston'), v('2', ' chicago '), v('3', 'Chicago', true)] };
    expect(affectedVersions(email, 'Chicago').map((x) => x.id)).toEqual(['2']);
    expect(affectedVersions({ ...email, isLaunch: false }, 'Chicago')).toEqual([]);
    expect(affectedVersions(email, 'Houston')).toEqual([]);
  });

  it('shifts the send by the length of the delay', () => {
    // Launch moved Nov 4 → Nov 18 (2 weeks): Wed Nov 4 send → Wed Nov 18
    expect(suggestSendDate('2026-11-04', '2026-11-04', '2026-11-18')).toEqual({ date: '2026-11-18', movedOffWeekend: false });
    // A teaser 2 days before launch keeps its 2-day lead
    expect(suggestSendDate('2026-11-02', '2026-11-04', '2026-11-18')).toEqual({ date: '2026-11-16', movedOffWeekend: false });
  });

  it('bumps weekend suggestions to Monday', () => {
    expect(suggestSendDate('2026-11-04', '2026-11-04', '2026-11-07')).toEqual({ date: '2026-11-09', movedOffWeekend: true }); // Sat → Mon
    expect(suggestSendDate('2026-11-04', '2026-11-04', '2026-11-08')).toEqual({ date: '2026-11-09', movedOffWeekend: true }); // Sun → Mon
  });

  it('moves the whole email or splits out the delayed city', () => {
    expect(reschedulePlan(2, 2)).toBe('move');
    expect(reschedulePlan(2, 1)).toBe('split');
  });

  it('shifts hand-edited due dates by the same amount', () => {
    expect(shiftDate('2026-10-30', '2026-11-04', '2026-11-18')).toBe('2026-11-13');
  });

  it('Ops reports, Marketing approves, admins can do both', () => {
    expect(canReportDelay({ role: 'ops', isAdmin: false })).toBe(true);
    expect(canReportDelay({ role: 'marketing', isAdmin: false })).toBe(false);
    expect(canApproveReschedule({ role: 'marketing', isAdmin: false })).toBe(true);
    expect(canApproveReschedule({ role: 'ops', isAdmin: false })).toBe(false);
    expect(canApproveReschedule({ role: 'member', isAdmin: true })).toBe(true);
  });
});
