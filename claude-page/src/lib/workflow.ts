// The approval workflow: step definitions, default due dates, who can check what,
// board stages and health colors. Pure functions — no database — so they're easy to test.

import { addDays, daysBetween, nowInTZ } from './dates';
import type { Person, Role, Step, StepKey } from './types';

export interface StepDef {
  key: StepKey;
  label: string;
  short: string;
  track: 'design' | 'audience' | 'send';
  kind: 'brief' | 'submit' | 'approve' | 'test' | 'send';
  stage?: 1 | 2;
  role?: Role; // role allowed to check this step (admins can always override)
  roles?: Role[]; // several roles allowed (e.g. Kori or Fran for the test send)
  hint?: string;
}

export const STEP_DEFS: StepDef[] = [
  { key: 'creative_brief', label: 'Creative Brief Submitted (Kori)', short: 'Creative brief', track: 'design', kind: 'brief', role: 'marketing', hint: 'Fill in the brief above' },
  { key: 'audience_brief', label: 'Audience Brief Noted (Ops)', short: 'Audience brief', track: 'audience', kind: 'brief', role: 'ops', hint: 'Who to exclude — in version details' },
  { key: 'design_submitted', label: 'Design Submitted', short: 'Design submitted', track: 'design', kind: 'submit' },
  { key: 'audiences_submitted', label: 'Audiences Submitted', short: 'Audiences submitted', track: 'audience', kind: 'submit' },
  { key: 'design_approved_1', label: 'Design Approved – Stage 1 (Kori)', short: 'Design ✓ Kori', track: 'design', kind: 'approve', stage: 1, role: 'marketing' },
  { key: 'design_approved_2', label: 'Design Approved – Stage 2 (Ops)', short: 'Design ✓ Ops', track: 'design', kind: 'approve', stage: 2, role: 'ops' },
  { key: 'audience_approved_1', label: 'Audience Approved – Stage 1 (Kori)', short: 'Audience ✓ Kori', track: 'audience', kind: 'approve', stage: 1, role: 'marketing' },
  { key: 'audience_approved_2', label: 'Audience Approved – Stage 2 (Ops)', short: 'Audience ✓ Ops', track: 'audience', kind: 'approve', stage: 2, role: 'ops', hint: 'List upload final' },
  { key: 'test_send', label: 'Test Send Signed Off (Kori or Fran)', short: 'Test send ✓', track: 'send', kind: 'test', roles: ['marketing', 'brand'] },
  { key: 'email_sent', label: 'Email Sent', short: 'Sent', track: 'send', kind: 'send' },
];

export const STEP_KEYS = STEP_DEFS.map((d) => d.key);
export const TOTAL_STEPS = STEP_DEFS.length;
export const stepDef = (key: StepKey) => STEP_DEFS.find((d) => d.key === key)!;

/**
 * Default deadlines, relative to the send date (all editable per step):
 *  - Creative brief (Kori): 10 days before send; audience brief (Ops): 7 days before send
 *  - Design + audiences submitted, and the design/audience approvals: 3 days before send
 *  - Test send signed off (Kori or Fran): 2 days before send
 *  - Audience Stage 2 (Ops) = final list upload: the day before send, by 12:00 PM ET
 *  - Email Sent: the send date (at the send time, if one is set)
 */
export const DEFAULT_OFFSETS: Record<StepKey, { days: number; time: string | null | 'send' }> = {
  creative_brief: { days: -10, time: null },
  audience_brief: { days: -7, time: null },
  design_submitted: { days: -3, time: null },
  audiences_submitted: { days: -3, time: null },
  design_approved_1: { days: -3, time: null },
  design_approved_2: { days: -3, time: null },
  audience_approved_1: { days: -3, time: null },
  audience_approved_2: { days: -1, time: '12:00' },
  test_send: { days: -2, time: null },
  email_sent: { days: 0, time: 'send' },
};

export function defaultDue(key: StepKey, sendDate: string, sendTime: string | null): { dueDate: string; dueTime: string | null } {
  const o = DEFAULT_OFFSETS[key];
  return { dueDate: addDays(sendDate, o.days), dueTime: o.time === 'send' ? sendTime || null : o.time };
}

/** Default assignee for a step: submits/sends → version owner; Stage 1 → Marketing; Stage 2 → Ops. */
export function defaultAssignee(key: StepKey, people: Person[], ownerId: string | null): string | null {
  const def = stepDef(key);
  const active = people.filter((p) => p.active);
  const roles = allowedRoles(key);
  if (roles.length) {
    for (const r of roles) {
      const hit = active.find((p) => p.role === r);
      if (hit) return hit.id;
    }
    return null;
  }
  return ownerId ?? active.find((p) => p.role === 'marketing')?.id ?? null;
}

type Done = Pick<Step, 'key' | 'completedAt'>;
const isDone = (steps: Done[], key: StepKey) => !!steps.find((s) => s.key === key)?.completedAt;

const SUBMIT_FOR: Record<'design' | 'audience', StepKey> = { design: 'design_submitted', audience: 'audiences_submitted' };
const STAGE1_FOR: Record<'design' | 'audience', StepKey> = { design: 'design_approved_1', audience: 'audience_approved_1' };
const STAGE2_FOR: Record<'design' | 'audience', StepKey> = { design: 'design_approved_2', audience: 'audience_approved_2' };

export interface Check {
  ok: boolean;
  reason?: string;
}

export const allowedRoles = (key: StepKey): Role[] => {
  const d = stepDef(key);
  return d.roles ?? (d.role ? [d.role] : []);
};

const ROLE_NAMES: Record<Role, string> = { marketing: 'Marketing (Kori)', ops: 'Ops', brand: 'Brand (Fran)', member: 'Team member' };

/** Role rule only: can this person check this step? */
type Who = Pick<Person, 'role' | 'isAdmin'> & { canBrief?: boolean };

export const isBriefStep = (key: StepKey) => key === 'creative_brief' || key === 'audience_brief';

export function hasRole(key: StepKey, user: Who): Check {
  const def = stepDef(key);
  const roles = allowedRoles(key);
  if (!roles.length || user.isAdmin || roles.includes(user.role)) return { ok: true };
  if (isBriefStep(key) && user.canBrief) return { ok: true };
  const who = roles.map((r) => ROLE_NAMES[r]).join(' or ');
  const what = def.kind === 'approve' ? `Stage ${def.stage} approvals` : `“${def.short}”`;
  return { ok: false, reason: `Only ${who} can check ${what} (an admin can override).` };
}

/** Order rule only: are the earlier steps this one depends on done? */
export function prerequisitesMet(key: StepKey, steps: Done[]): Check {
  const def = stepDef(key);
  if (def.kind === 'approve') {
    const track = def.track as 'design' | 'audience';
    if (!isDone(steps, SUBMIT_FOR[track])) return { ok: false, reason: `${stepDef(SUBMIT_FOR[track]).label} has to be checked first.` };
    if (def.stage === 2 && !isDone(steps, STAGE1_FOR[track]))
      return { ok: false, reason: `Stage 2 can only be checked after ${stepDef(STAGE1_FOR[track]).label}.` };
  }
  if (key === 'design_submitted' && !isDone(steps, 'creative_brief')) return { ok: false, reason: 'The creative brief has to be submitted first.' };
  if (key === 'audiences_submitted' && !isDone(steps, 'audience_brief')) return { ok: false, reason: 'Ops has to note the audience brief first.' };
  if (def.kind === 'test') {
    const missing = APPROVALS.filter((k) => !isDone(steps, k));
    if (missing.length) return { ok: false, reason: `Finish the approvals before signing off the test send (${missing.length} left).` };
  }
  if (def.kind === 'send') {
    const missing = STEP_DEFS.filter((d) => d.kind !== 'send' && !isDone(steps, d.key));
    if (missing.length) return { ok: false, reason: `Finish the earlier steps first (${missing.length} step${missing.length > 1 ? 's' : ''} left).` };
  }
  return { ok: true };
}

export function canComplete(key: StepKey, steps: Done[], user: Who): Check {
  const order = prerequisitesMet(key, steps);
  if (!order.ok) return order;
  return hasRole(key, user);
}

/** Steps that depend on `key` and must be reopened when `key` is reopened. */
const APPROVALS: StepKey[] = ['design_approved_1', 'design_approved_2', 'audience_approved_1', 'audience_approved_2'];

export function dependents(key: StepKey): StepKey[] {
  switch (key) {
    case 'creative_brief':
      return ['design_submitted', 'design_approved_1', 'design_approved_2', 'test_send'];
    case 'audience_brief':
      return ['audiences_submitted', 'audience_approved_1', 'audience_approved_2', 'test_send'];
    case 'design_submitted':
      return ['design_approved_1', 'design_approved_2', 'test_send'];
    case 'design_approved_1':
      return ['design_approved_2', 'test_send'];
    case 'audiences_submitted':
      return ['audience_approved_1', 'audience_approved_2', 'test_send'];
    case 'audience_approved_1':
      return ['audience_approved_2', 'test_send'];
    case 'design_approved_2':
    case 'audience_approved_2':
      return ['test_send'];
    default:
      return [];
  }
}

/** Keys to un-check when someone un-checks `key` (itself plus any completed dependents). */
export function reopenPlan(key: StepKey, steps: Done[]): StepKey[] {
  return [key, ...dependents(key)].filter((k) => k === key || isDone(steps, k));
}

/**
 * "Request changes" on an approval step: re-opens the matching Submitted step
 * (and the approvals for that track, since the work will be resubmitted) and flags it.
 */
export function requestChangesPlan(key: StepKey): { reopen: StepKey[]; flag: StepKey } {
  const def = stepDef(key);
  if (def.kind !== 'approve') throw new Error('Changes can only be requested on an approval step.');
  const track = def.track as 'design' | 'audience';
  return { reopen: [SUBMIT_FOR[track], STAGE1_FOR[track], STAGE2_FOR[track], 'test_send'], flag: SUBMIT_FOR[track] };
}

// ---------- Board stages ----------

export type StageId = 'brief' | 'design' | 'audience' | 'kori' | 'ops' | 'test' | 'ready' | 'sent';

const B: StepKey[] = ['creative_brief', 'audience_brief'];
const S1: StepKey[] = [...B, 'design_submitted'];
const S2: StepKey[] = [...S1, 'audiences_submitted'];
const S3: StepKey[] = [...S2, 'design_approved_1', 'audience_approved_1'];
const S4: StepKey[] = [...S3, 'design_approved_2', 'audience_approved_2'];
export const STAGES: { id: StageId; label: string; requires: StepKey[] }[] = [
  { id: 'brief', label: 'Briefs', requires: [] },
  { id: 'design', label: 'Design', requires: B },
  { id: 'audience', label: 'Audience', requires: S1 },
  { id: 'kori', label: 'Kori approval', requires: S2 },
  { id: 'ops', label: 'Ops approval', requires: S3 },
  { id: 'test', label: 'Test send', requires: S4 },
  { id: 'ready', label: 'Ready to send', requires: [...S4, 'test_send'] },
  { id: 'sent', label: 'Sent', requires: STEP_KEYS },
];

export function stageOf(steps: Done[]): StageId {
  let current: StageId = 'design';
  for (const s of STAGES) {
    if (s.requires.every((k) => isDone(steps, k))) current = s.id;
    else break;
  }
  return current;
}

/** What has to change to move a card to `target`: steps to check (in order) and steps to un-check. */
export function movePlan(target: StageId, steps: Done[]): { complete: StepKey[]; reopen: StepKey[] } {
  const req = new Set(STAGES.find((s) => s.id === target)!.requires);
  const complete = STEP_KEYS.filter((k) => req.has(k) && !isDone(steps, k));
  const reopen = STEP_KEYS.filter((k) => !req.has(k) && isDone(steps, k));
  return { complete, reopen };
}

// ---------- Health ----------

export type Health = 'overdue' | 'today' | 'soon' | 'ontrack' | 'done';
export const HEALTH_RANK: Record<Health, number> = { overdue: 4, today: 3, soon: 2, ontrack: 1, done: 0 };
export const HEALTH_LABEL: Record<Health, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  soon: 'Due within 2 days',
  ontrack: 'On track',
  done: 'Done',
};

export type Now = { date: string; time: string };
export const currentNow = (d?: Date): Now => nowInTZ(d);

export function stepHealth(step: Pick<Step, 'dueDate' | 'dueTime' | 'completedAt'>, now: Now): Health {
  if (step.completedAt) return 'done';
  const due = `${step.dueDate}T${step.dueTime || '23:59'}`;
  const cur = `${now.date}T${now.time}`;
  if (due < cur) return 'overdue';
  if (step.dueDate === now.date) return 'today';
  if (daysBetween(now.date, step.dueDate) <= 2) return 'soon';
  return 'ontrack';
}

export const worst = (hs: Health[]): Health => hs.reduce<Health>((a, b) => (HEALTH_RANK[b] > HEALTH_RANK[a] ? b : a), 'done');

export function versionHealth(steps: Step[], now: Now): Health {
  if (isDone(steps, 'email_sent')) return 'done';
  const open = steps.filter((s) => !s.completedAt);
  if (!open.length) return 'ontrack';
  return worst(open.map((s) => stepHealth(s, now)));
}

export function emailHealth(versions: { steps: Step[] }[], now: Now): Health {
  if (!versions.length) return 'ontrack';
  return worst(versions.map((v) => versionHealth(v.steps, now)));
}

export function progress(steps: Done[]): { done: number; total: number } {
  return { done: STEP_KEYS.filter((k) => isDone(steps, k)).length, total: TOTAL_STEPS };
}

export function nextStep<T extends Done>(steps: T[]): T | undefined {
  return STEP_KEYS.map((k) => steps.find((s) => s.key === k)).find((s) => s && !s.completedAt);
}

export function sortSteps<T extends { key: StepKey }>(steps: T[]): T[] {
  return [...steps].sort((a, b) => STEP_KEYS.indexOf(a.key) - STEP_KEYS.indexOf(b.key));
}
