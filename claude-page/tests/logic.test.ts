import { describe, expect, it } from 'vitest';
import { addDays, isWeekend, nowInTZ, daysBetween } from '@/lib/dates';
import { tagUrl, topicSlug, utmParams } from '@/lib/utm';
import {
  canComplete,
  defaultDue,
  emailHealth,
  movePlan,
  progress,
  reopenPlan,
  requestChangesPlan,
  stageOf,
  stepHealth,
  STEP_KEYS,
  versionHealth,
} from '@/lib/workflow';
import type { Step, StepKey } from '@/lib/types';

const kori = { role: 'marketing' as const, isAdmin: false };
const ops = { role: 'ops' as const, isAdmin: false };
const member = { role: 'member' as const, isAdmin: false };
const admin = { role: 'member' as const, isAdmin: true };

function steps(done: StepKey[], due: Partial<Record<StepKey, [string, string | null]>> = {}): Step[] {
  return STEP_KEYS.map((key, i) => ({
    id: String(i + 1),
    versionId: '1',
    key,
    assigneeId: null,
    dueDate: due[key]?.[0] ?? '2026-11-20',
    dueTime: due[key]?.[1] ?? null,
    dueOverridden: false,
    completedById: done.includes(key) ? '1' : null,
    completedAt: done.includes(key) ? '2026-11-01T12:00:00Z' : null,
    changesRequested: false,
    changesNote: null,
  }));
}

describe('UTM tagging', () => {
  it('slugs the topic', () => {
    expect(topicSlug('MCP Email')).toBe('mcp_email');
    expect(topicSlug('  Launch Email — Boston & Chicago! ')).toBe('launch_email_boston_chicago');
  });

  it('builds params from the send date', () => {
    expect(utmParams('2026-11-02', 'MCP Email')).toBe('utm_source=email&utm_medium=marketing_20261102&utm_campaign=mcp_email');
  });

  it('inserts the query before a #fragment', () => {
    expect(tagUrl('https://api.getresq.com/rest/docs/mcp/#openai', '2026-11-02', 'MCP Email')).toBe(
      'https://api.getresq.com/rest/docs/mcp/?utm_source=email&utm_medium=marketing_20261102&utm_campaign=mcp_email#openai',
    );
  });

  it('uses & when the URL already has a query', () => {
    expect(tagUrl('https://x.com/a?ref=1#top', '2026-11-04', 'Launch Email')).toBe(
      'https://x.com/a?ref=1&utm_source=email&utm_medium=marketing_20261104&utm_campaign=launch_email#top',
    );
  });

  it('plain URL with no query or fragment', () => {
    expect(tagUrl('https://app.getresq.com/~/resq-services', '2026-11-04', 'Launch Email')).toBe(
      'https://app.getresq.com/~/resq-services?utm_source=email&utm_medium=marketing_20261104&utm_campaign=launch_email',
    );
  });

  it('replaces old UTM values instead of duplicating them', () => {
    const once = tagUrl('https://x.com/p', '2026-11-02', 'Old Topic');
    const twice = tagUrl(once, '2026-11-09', 'New Topic');
    expect(twice).toBe('https://x.com/p?utm_source=email&utm_medium=marketing_20261109&utm_campaign=new_topic');
  });

  it('returns empty for an empty URL', () => {
    expect(tagUrl('  ', '2026-11-02', 'x')).toBe('');
  });
});

describe('dates & default due dates', () => {
  it('adds days across month boundaries', () => {
    expect(addDays('2026-11-02', -3)).toBe('2026-10-30');
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3);
  });

  it('MCP Email (Mon Nov 2) defaults', () => {
    expect(defaultDue('design_submitted', '2026-11-02', null)).toEqual({ dueDate: '2026-10-30', dueTime: null });
    expect(defaultDue('design_approved_2', '2026-11-02', null)).toEqual({ dueDate: '2026-10-30', dueTime: null });
    expect(defaultDue('audience_approved_2', '2026-11-02', null)).toEqual({ dueDate: '2026-11-01', dueTime: '12:00' });
    expect(defaultDue('email_sent', '2026-11-02', '10:00')).toEqual({ dueDate: '2026-11-02', dueTime: '10:00' });
  });

  it('flags weekend due dates', () => {
    expect(isWeekend('2026-11-01')).toBe(true); // Sunday — MCP list upload deadline
    expect(isWeekend('2026-10-31')).toBe(true); // Saturday
    expect(isWeekend('2026-10-30')).toBe(false); // Friday
    expect(isWeekend(defaultDue('design_submitted', '2026-11-04', null).dueDate)).toBe(true); // Launch: Sun Nov 1
  });

  it('reads the clock in Eastern time', () => {
    // 03:30 UTC on Nov 18 is still Nov 17 in New York
    expect(nowInTZ(new Date('2026-11-18T03:30:00Z'))).toEqual({ date: '2026-11-17', time: '22:30' });
  });
});

describe('who can check what', () => {
  it('Stage 2 only after Stage 1', () => {
    const s = steps(['design_submitted']);
    expect(canComplete('design_approved_2', s, ops).ok).toBe(false);
    expect(canComplete('design_approved_1', s, kori).ok).toBe(true);
    const s2 = steps(['design_submitted', 'design_approved_1']);
    expect(canComplete('design_approved_2', s2, ops).ok).toBe(true);
  });

  it('approvals need the matching submission', () => {
    expect(canComplete('audience_approved_1', steps(['design_submitted']), kori).ok).toBe(false);
  });

  it('roles gate Stage 1 vs Stage 2, admin overrides', () => {
    const s = steps(['design_submitted', 'design_approved_1']);
    expect(canComplete('design_approved_1', steps(['design_submitted']), ops).ok).toBe(false);
    expect(canComplete('design_approved_2', s, kori).ok).toBe(false);
    expect(canComplete('design_approved_2', s, member).ok).toBe(false);
    expect(canComplete('design_approved_2', s, admin).ok).toBe(true);
    // admin can't skip the order, though
    expect(canComplete('design_approved_2', steps(['design_submitted']), admin).ok).toBe(false);
  });

  it('anyone can submit; send requires everything else', () => {
    expect(canComplete('design_submitted', steps([]), member).ok).toBe(true);
    expect(canComplete('email_sent', steps(['design_submitted']), member).ok).toBe(false);
    expect(canComplete('email_sent', steps(STEP_KEYS.filter((k) => k !== 'email_sent')), member).ok).toBe(true);
  });

  it('un-checking cascades to dependents', () => {
    const s = steps(['design_submitted', 'design_approved_1', 'design_approved_2']);
    expect(reopenPlan('design_submitted', s)).toEqual(['design_submitted', 'design_approved_1', 'design_approved_2']);
    expect(reopenPlan('design_approved_1', s)).toEqual(['design_approved_1', 'design_approved_2']);
  });

  it('request changes reopens the matching Submitted step', () => {
    expect(requestChangesPlan('audience_approved_2')).toEqual({
      reopen: ['audiences_submitted', 'audience_approved_1', 'audience_approved_2'],
      flag: 'audiences_submitted',
    });
    expect(requestChangesPlan('design_approved_1').flag).toBe('design_submitted');
    expect(() => requestChangesPlan('design_submitted')).toThrow();
  });
});

describe('board stages', () => {
  it('maps progress to columns', () => {
    expect(stageOf(steps([]))).toBe('design');
    expect(stageOf(steps(['audiences_submitted']))).toBe('design');
    expect(stageOf(steps(['design_submitted']))).toBe('audience');
    expect(stageOf(steps(['design_submitted', 'audiences_submitted', 'design_approved_1']))).toBe('kori');
    expect(stageOf(steps(['design_submitted', 'audiences_submitted', 'design_approved_1', 'audience_approved_1']))).toBe('ops');
    expect(stageOf(steps(STEP_KEYS.filter((k) => k !== 'email_sent')))).toBe('ready');
    expect(stageOf(steps(STEP_KEYS))).toBe('sent');
  });

  it('plans a drag forward and backward', () => {
    expect(movePlan('kori', steps([]))).toEqual({ complete: ['design_submitted', 'audiences_submitted'], reopen: [] });
    expect(movePlan('audience', steps(['design_submitted', 'audiences_submitted', 'design_approved_1']))).toEqual({
      complete: [],
      reopen: ['audiences_submitted', 'design_approved_1'],
    });
  });

  it('counts progress', () => {
    expect(progress(steps(['design_submitted', 'audiences_submitted', 'design_approved_1', 'audience_approved_1']))).toEqual({ done: 4, total: 7 });
  });
});

describe('health colors', () => {
  const now = { date: '2026-11-17', time: '09:00' };
  const one = (dueDate: string, dueTime: string | null = null, done = false) =>
    stepHealth({ dueDate, dueTime, completedAt: done ? 'x' : null }, now);

  it('classifies a step', () => {
    expect(one('2026-11-16')).toBe('overdue');
    expect(one('2026-11-17', '08:00')).toBe('overdue'); // earlier today, past the time
    expect(one('2026-11-17', '12:00')).toBe('today');
    expect(one('2026-11-17')).toBe('today');
    expect(one('2026-11-19')).toBe('soon');
    expect(one('2026-11-20')).toBe('ontrack');
    expect(one('2026-11-01', null, true)).toBe('done');
  });

  it('version & email take the worst open step; sent = done', () => {
    const v1 = steps(['design_submitted'], { audiences_submitted: ['2026-11-16', null] });
    expect(versionHealth(v1, now)).toBe('overdue');
    const v2 = steps(STEP_KEYS, { audiences_submitted: ['2026-11-01', null] });
    expect(versionHealth(v2, now)).toBe('done');
    expect(emailHealth([{ steps: v1 }, { steps: v2 }], now)).toBe('overdue');
    expect(emailHealth([{ steps: v2 }], now)).toBe('done');
  });
});
