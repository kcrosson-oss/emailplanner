// All reads and writes. Every mutation is checked against the workflow rules
// (lib/workflow.ts) on the server, so the rules hold no matter which view the click came from.

import type { Query } from './db';
import { affectedVersions, canApproveReschedule, canReportDelay, reschedulePlan, shiftDate, suggestSendDate } from './launch';
import type { LaunchDelay, RescheduleSuggestion } from './types';
import type { Activity, Email, Link, Person, Role, Step, StepKey, Version } from './types';
import {
  canComplete,
  defaultAssignee,
  defaultDue,
  hasRole,
  movePlan,
  reopenPlan,
  requestChangesPlan,
  sortSteps,
  StageId,
  STAGES,
  stepDef,
  STEP_KEYS,
} from './workflow';

export class UserError extends Error {}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

const mapPerson = (r: any): Person => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role as Role,
  isAdmin: !!r.is_admin,
  active: !!r.active,
});

const mapStep = (r: any): Step => ({
  id: r.id,
  versionId: r.version_id,
  key: r.key,
  assigneeId: r.assignee_id,
  dueDate: r.due_date,
  dueTime: r.due_time,
  dueOverridden: !!r.due_overridden,
  completedById: r.completed_by_id,
  completedAt: iso(r.completed_at),
  changesRequested: !!r.changes_requested,
  changesNote: r.changes_note,
});

const parseLinks = (v: unknown): Link[] => {
  const arr = typeof v === 'string' ? JSON.parse(v) : v;
  return Array.isArray(arr) ? arr.map((l: any) => ({ label: String(l.label ?? ''), url: String(l.url ?? '') })) : [];
};

// ---------- Reads ----------

export async function listPeople(q: Query): Promise<Person[]> {
  return (await q('SELECT * FROM people ORDER BY active DESC, name')).map(mapPerson);
}

export async function getPerson(q: Query, id: number): Promise<Person | null> {
  const r = await q('SELECT * FROM people WHERE id = $1', [id]);
  return r[0] ? mapPerson(r[0]) : null;
}

export async function listEmails(q: Query): Promise<Email[]> {
  const [emails, versions, steps] = await Promise.all([
    q('SELECT * FROM emails ORDER BY send_date, id'),
    q('SELECT * FROM versions ORDER BY sort_order, id'),
    q('SELECT * FROM steps'),
  ]);
  const stepsBy = new Map<number, Step[]>();
  for (const s of steps.map(mapStep)) stepsBy.set(s.versionId, [...(stepsBy.get(s.versionId) ?? []), s]);
  const versionsBy = new Map<number, Version[]>();
  for (const v of versions) {
    const ver: Version = {
      id: v.id,
      emailId: v.email_id,
      name: v.name,
      audience: v.audience,
      exclusions: v.exclusions,
      subject: v.subject,
      preheader: v.preheader,
      links: parseLinks(v.links),
      previewUrl: v.preview_url,
      notes: v.notes,
      ownerId: v.owner_id,
      sortOrder: v.sort_order,
      city: v.city ?? '',
      steps: sortSteps(stepsBy.get(v.id) ?? []),
    };
    versionsBy.set(v.email_id, [...(versionsBy.get(v.email_id) ?? []), ver]);
  }
  return emails.map((e) => ({ id: e.id, title: e.title, sendDate: e.send_date, sendTime: e.send_time, isLaunch: !!e.is_launch, versions: versionsBy.get(e.id) ?? [] }));
}

export async function listActivity(q: Query, emailId: number): Promise<Activity[]> {
  const rows = await q('SELECT * FROM activity WHERE email_id = $1 ORDER BY created_at DESC, id DESC LIMIT 200', [emailId]);
  return rows.map((r) => ({
    id: r.id,
    emailId: r.email_id,
    versionId: r.version_id,
    personId: r.person_id,
    kind: r.kind,
    message: r.message,
    createdAt: iso(r.created_at)!,
  }));
}

export async function log(q: Query, emailId: number, versionId: number | null, personId: number | null, kind: string, message: string) {
  await q('INSERT INTO activity (email_id, version_id, person_id, kind, message) VALUES ($1,$2,$3,$4,$5)', [emailId, versionId, personId, kind, message]);
}

// ---------- Emails & versions ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
function checkDate(d: unknown): string {
  if (typeof d !== 'string' || !DATE_RE.test(d)) throw new UserError('Please pick a valid date.');
  return d;
}
function checkTime(t: unknown): string | null {
  if (t === null || t === undefined || t === '') return null;
  if (typeof t !== 'string' || !TIME_RE.test(t)) throw new UserError('Please pick a valid time.');
  return t;
}

export interface VersionInput {
  name: string;
  audience?: string;
  exclusions?: string;
  subject?: string;
  preheader?: string;
  links?: Link[];
  previewUrl?: string;
  notes?: string;
  ownerId?: number | null;
  city?: string;
}

async function insertVersion(q: Query, email: { id: number; sendDate: string; sendTime: string | null }, v: VersionInput, sortOrder: number, people: Person[]) {
  const [row] = await q(
    `INSERT INTO versions (email_id, name, audience, exclusions, subject, preheader, links, preview_url, notes, owner_id, sort_order, city)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [
      email.id,
      v.name?.trim() || 'Main',
      v.audience ?? '',
      v.exclusions ?? '',
      v.subject ?? '',
      v.preheader ?? '',
      JSON.stringify(v.links ?? []),
      v.previewUrl ?? '',
      v.notes ?? '',
      v.ownerId ?? null,
      sortOrder,
      (v.city ?? '').trim(),
    ],
  );
  for (const key of STEP_KEYS) {
    const due = defaultDue(key, email.sendDate, email.sendTime);
    await q('INSERT INTO steps (version_id, key, assignee_id, due_date, due_time) VALUES ($1,$2,$3,$4,$5)', [
      row.id,
      key,
      defaultAssignee(key, people, v.ownerId ?? null),
      due.dueDate,
      due.dueTime,
    ]);
  }
  return row.id as number;
}

export async function createEmail(
  q: Query,
  input: { title: string; sendDate: string; sendTime?: string | null; isLaunch?: boolean; versions: VersionInput[] },
  actorId: number | null,
): Promise<number> {
  const title = input.title?.trim();
  if (!title) throw new UserError('Give the email a title.');
  const sendDate = checkDate(input.sendDate);
  const sendTime = checkTime(input.sendTime);
  const isLaunch = input.isLaunch ?? /\blaunch\b/i.test(title);
  const [row] = await q('INSERT INTO emails (title, send_date, send_time, is_launch) VALUES ($1,$2,$3,$4) RETURNING id', [title, sendDate, sendTime, isLaunch]);
  const people = await listPeople(q);
  const versions = input.versions?.length ? input.versions : [{ name: 'Main' }];
  for (let i = 0; i < versions.length; i++) await insertVersion(q, { id: row.id, sendDate, sendTime }, { ...versions[i], city: versions[i].city ?? (isLaunch ? versions[i].name : '') }, i, people);
  await log(q, row.id, null, actorId, 'created', `created this email (${versions.map((v) => v.name).join(', ')})`);
  return row.id;
}

async function getEmailRow(q: Query, id: number) {
  const [e] = await q('SELECT * FROM emails WHERE id = $1', [id]);
  if (!e) throw new UserError('That email no longer exists.');
  return { id: e.id as number, title: e.title as string, sendDate: e.send_date as string, sendTime: e.send_time as string | null, isLaunch: !!e.is_launch };
}

export async function updateEmail(q: Query, id: number, patch: { title?: string; sendDate?: string; sendTime?: string | null; isLaunch?: boolean }, actorId: number) {
  const e = await getEmailRow(q, id);
  if (patch.isLaunch !== undefined && patch.isLaunch !== e.isLaunch) {
    await q('UPDATE emails SET is_launch=$1 WHERE id=$2', [!!patch.isLaunch, id]);
    if (patch.isLaunch) await q(`UPDATE versions SET city = name WHERE email_id = $1 AND city = ''`, [id]);
    await log(q, id, null, actorId, 'edited', patch.isLaunch ? 'labeled this a launch email' : 'removed the launch email label');
  }
  const title = patch.title !== undefined ? patch.title.trim() || e.title : e.title;
  const sendDate = patch.sendDate !== undefined ? checkDate(patch.sendDate) : e.sendDate;
  const sendTime = patch.sendTime !== undefined ? checkTime(patch.sendTime) : e.sendTime;
  await q('UPDATE emails SET title=$1, send_date=$2, send_time=$3, updated_at=NOW() WHERE id=$4', [title, sendDate, sendTime, id]);
  if (sendDate !== e.sendDate || sendTime !== e.sendTime) {
    // Re-derive due dates for steps nobody has hand-edited.
    const steps = await q(
      'SELECT s.id, s.key FROM steps s JOIN versions v ON v.id = s.version_id WHERE v.email_id = $1 AND s.due_overridden = FALSE',
      [id],
    );
    for (const s of steps) {
      const d = defaultDue(s.key, sendDate, sendTime);
      await q('UPDATE steps SET due_date=$1, due_time=$2 WHERE id=$3', [d.dueDate, d.dueTime, s.id]);
    }
    await log(q, id, null, actorId, 'edited', `moved the send to ${sendDate}${sendTime ? ' ' + sendTime : ''} (due dates updated)`);
  }
  if (title !== e.title) await log(q, id, null, actorId, 'edited', `renamed the email to “${title}”`);
}

export async function deleteEmail(q: Query, id: number) {
  await q('DELETE FROM emails WHERE id = $1', [id]);
}

async function versionInputFromRow(q: Query, versionId: number): Promise<{ emailId: number; input: VersionInput }> {
  const [v] = await q('SELECT * FROM versions WHERE id = $1', [versionId]);
  if (!v) throw new UserError('That version no longer exists.');
  return {
    emailId: v.email_id,
    input: {
      name: v.name,
      audience: v.audience,
      exclusions: v.exclusions,
      subject: v.subject,
      preheader: v.preheader,
      links: parseLinks(v.links),
      previewUrl: v.preview_url,
      notes: v.notes,
      ownerId: v.owner_id,
      city: v.city ?? '',
    },
  };
}

export async function duplicateEmail(q: Query, id: number, actorId: number): Promise<number> {
  const e = await getEmailRow(q, id);
  const vs = await q('SELECT id FROM versions WHERE email_id = $1 ORDER BY sort_order, id', [id]);
  const inputs = [];
  for (const v of vs) inputs.push((await versionInputFromRow(q, v.id)).input);
  const newId = await createEmail(q, { title: `${e.title} (copy)`, sendDate: e.sendDate, sendTime: e.sendTime, isLaunch: e.isLaunch, versions: inputs }, actorId);
  await log(q, newId, null, actorId, 'created', `duplicated from “${e.title}”`);
  return newId;
}

export async function addVersion(q: Query, emailId: number, input: VersionInput, actorId: number): Promise<number> {
  const e = await getEmailRow(q, emailId);
  const [{ n }] = await q('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM versions WHERE email_id = $1', [emailId]);
  const id = await insertVersion(q, e, { ...input, city: input.city ?? (e.isLaunch ? input.name : '') }, Number(n), await listPeople(q));
  await log(q, emailId, id, actorId, 'version', `added version “${input.name || 'Main'}”`);
  return id;
}

export async function duplicateVersion(q: Query, versionId: number, actorId: number): Promise<number> {
  const { emailId, input } = await versionInputFromRow(q, versionId);
  return addVersion(q, emailId, { ...input, name: `${input.name} (copy)` }, actorId);
}

export async function updateVersion(q: Query, id: number, patch: Partial<VersionInput>, actorId: number) {
  const { emailId, input } = await versionInputFromRow(q, id);
  const next = { ...input, ...patch };
  if (patch.links) next.links = patch.links.map((l) => ({ label: String(l.label ?? '').trim(), url: String(l.url ?? '').trim() }));
  await q(
    `UPDATE versions SET name=$1, audience=$2, exclusions=$3, subject=$4, preheader=$5, links=$6, preview_url=$7, notes=$8, owner_id=$9, city=$11 WHERE id=$10`,
    [next.name?.trim() || input.name, next.audience ?? '', next.exclusions ?? '', next.subject ?? '', next.preheader ?? '', JSON.stringify(next.links ?? []), next.previewUrl ?? '', next.notes ?? '', next.ownerId ?? null, id, (next.city ?? '').trim()],
  );
  const changed = Object.keys(patch).filter((k) => JSON.stringify((patch as any)[k]) !== JSON.stringify((input as any)[k]));
  if (changed.length) {
    const names: Record<string, string> = { name: 'name', audience: 'audience', exclusions: 'exclusions', subject: 'subject line', preheader: 'preheader', links: 'links', previewUrl: 'preview link', notes: 'notes', ownerId: 'owner', city: 'launch city' };
    await log(q, emailId, id, actorId, 'edited', `updated ${changed.map((k) => names[k] ?? k).join(', ')}`);
  }
}

export async function deleteVersion(q: Query, id: number, actorId: number) {
  const [v] = await q('SELECT email_id, name FROM versions WHERE id = $1', [id]);
  if (!v) return;
  const [{ c }] = await q('SELECT COUNT(*)::int AS c FROM versions WHERE email_id = $1', [v.email_id]);
  if (Number(c) <= 1) throw new UserError('An email needs at least one version. Delete the email instead.');
  await q('DELETE FROM versions WHERE id = $1', [id]);
  await log(q, v.email_id, null, actorId, 'version', `removed version “${v.name}”`);
}

// ---------- Steps ----------

async function versionContext(q: Query, versionId: number) {
  const [v] = await q('SELECT v.id, v.name, v.email_id, e.title FROM versions v JOIN emails e ON e.id = v.email_id WHERE v.id = $1', [versionId]);
  if (!v) throw new UserError('That version no longer exists.');
  const steps = (await q('SELECT * FROM steps WHERE version_id = $1', [versionId])).map(mapStep);
  return { versionId: v.id as number, versionName: v.name as string, emailId: v.email_id as number, steps };
}

async function stepById(q: Query, stepId: number) {
  const [s] = await q('SELECT * FROM steps WHERE id = $1', [stepId]);
  if (!s) throw new UserError('That step no longer exists.');
  return mapStep(s);
}

async function setDone(q: Query, versionId: number, key: StepKey, actorId: number) {
  await q('UPDATE steps SET completed_by_id=$1, completed_at=NOW(), changes_requested=FALSE, changes_note=NULL WHERE version_id=$2 AND key=$3', [actorId, versionId, key]);
}
async function setOpen(q: Query, versionId: number, key: StepKey) {
  await q('UPDATE steps SET completed_by_id=NULL, completed_at=NULL WHERE version_id=$1 AND key=$2', [versionId, key]);
}

export async function completeStep(q: Query, stepId: number, actor: Person) {
  const step = await stepById(q, stepId);
  const ctx = await versionContext(q, step.versionId);
  if (step.completedAt) return;
  const check = canComplete(step.key, ctx.steps, actor);
  if (!check.ok) throw new UserError(check.reason);
  await setDone(q, ctx.versionId, step.key, actor.id);
  await log(q, ctx.emailId, ctx.versionId, actor.id, 'step', `checked “${stepDef(step.key).label}” · ${ctx.versionName}`);
}

export async function reopenStep(q: Query, stepId: number, actor: Person) {
  const step = await stepById(q, stepId);
  const ctx = await versionContext(q, step.versionId);
  if (!step.completedAt) return;
  const role = hasRole(step.key, actor);
  if (!role.ok) throw new UserError(role.reason);
  const keys = reopenPlan(step.key, ctx.steps);
  for (const k of keys) await setOpen(q, ctx.versionId, k);
  const extra = keys.length > 1 ? ` (also reopened ${keys.slice(1).map((k) => stepDef(k).short).join(', ')})` : '';
  await log(q, ctx.emailId, ctx.versionId, actor.id, 'step', `un-checked “${stepDef(step.key).label}” · ${ctx.versionName}${extra}`);
}

export async function requestChanges(q: Query, stepId: number, actor: Person, comment: string) {
  const step = await stepById(q, stepId);
  if (stepDef(step.key).kind !== 'approve') throw new UserError('Changes can only be requested on an approval step.');
  const note = (comment ?? '').trim();
  if (!note) throw new UserError('Add a comment describing the changes needed.');
  const role = hasRole(step.key, actor);
  if (!role.ok) throw new UserError(role.reason);
  const ctx = await versionContext(q, step.versionId);
  const plan = requestChangesPlan(step.key);
  for (const k of plan.reopen) await setOpen(q, ctx.versionId, k);
  await q('UPDATE steps SET changes_requested=TRUE, changes_note=$1 WHERE version_id=$2 AND key=$3', [note, ctx.versionId, plan.flag]);
  await log(q, ctx.emailId, ctx.versionId, actor.id, 'changes', `requested changes on “${stepDef(step.key).label}” · ${ctx.versionName}: ${note}`);
}

export async function updateStep(q: Query, stepId: number, patch: { assigneeId?: number | null; dueDate?: string; dueTime?: string | null }, actorId: number) {
  const step = await stepById(q, stepId);
  const ctx = await versionContext(q, step.versionId);
  const dueDate = patch.dueDate !== undefined ? checkDate(patch.dueDate) : step.dueDate;
  const dueTime = patch.dueTime !== undefined ? checkTime(patch.dueTime) : step.dueTime;
  const assigneeId = patch.assigneeId !== undefined ? patch.assigneeId : step.assigneeId;
  const dueChanged = dueDate !== step.dueDate || dueTime !== step.dueTime;
  await q('UPDATE steps SET assignee_id=$1, due_date=$2, due_time=$3, due_overridden = due_overridden OR $4 WHERE id=$5', [assigneeId, dueDate, dueTime, dueChanged, stepId]);
  const label = stepDef(step.key).label;
  if (dueChanged) await log(q, ctx.emailId, ctx.versionId, actorId, 'edited', `changed due date of “${label}” · ${ctx.versionName} to ${dueDate}${dueTime ? ' ' + dueTime : ''}`);
  if (assigneeId !== step.assigneeId) {
    const p = assigneeId ? await getPerson(q, assigneeId) : null;
    await log(q, ctx.emailId, ctx.versionId, actorId, 'edited', `assigned “${label}” · ${ctx.versionName} to ${p?.name ?? 'nobody'}`);
  }
}

export async function resetDueDates(q: Query, emailId: number, actorId: number) {
  const e = await getEmailRow(q, emailId);
  const steps = await q('SELECT s.id, s.key FROM steps s JOIN versions v ON v.id = s.version_id WHERE v.email_id = $1', [emailId]);
  for (const s of steps) {
    const d = defaultDue(s.key, e.sendDate, e.sendTime);
    await q('UPDATE steps SET due_date=$1, due_time=$2, due_overridden=FALSE WHERE id=$3', [d.dueDate, d.dueTime, s.id]);
  }
  await log(q, emailId, null, actorId, 'edited', 'reset all due dates to the defaults');
}

/** Board drag: check/un-check the steps needed to land in the target column. */
export async function moveVersion(q: Query, versionId: number, target: StageId, actor: Person) {
  if (!STAGES.find((s) => s.id === target)) throw new UserError('Unknown column.');
  const ctx = await versionContext(q, versionId);
  const plan = movePlan(target, ctx.steps);
  // Validate the whole move before touching anything.
  const sim = ctx.steps.map((s) => ({ ...s }));
  for (const k of [...plan.reopen].reverse()) {
    const r = hasRole(k, actor);
    if (!r.ok) throw new UserError(r.reason);
    sim.find((s) => s.key === k)!.completedAt = null;
  }
  for (const k of plan.complete) {
    const c = canComplete(k, sim, actor);
    if (!c.ok) throw new UserError(c.reason);
    sim.find((s) => s.key === k)!.completedAt = 'pending';
  }
  for (const k of plan.reopen) await setOpen(q, versionId, k);
  for (const k of plan.complete) await setDone(q, versionId, k, actor.id);
  const label = STAGES.find((s) => s.id === target)!.label;
  if (plan.complete.length || plan.reopen.length)
    await log(q, ctx.emailId, versionId, actor.id, 'step', `moved ${ctx.versionName} to “${label}” on the board`);
}

export async function addComment(q: Query, emailId: number, versionId: number | null, actorId: number, text: string) {
  const t = (text ?? '').trim();
  if (!t) throw new UserError('Write a comment first.');
  await getEmailRow(q, emailId);
  await log(q, emailId, versionId, actorId, 'comment', t);
}

// ---------- People ----------

const ROLES: Role[] = ['marketing', 'ops', 'member'];

export async function upsertPerson(q: Query, p: Partial<Person> & { id?: number }, actor: Person) {
  if (!actor.isAdmin) throw new UserError('Only admins can edit the people list.');
  const name = p.name?.trim();
  const email = p.email?.trim().toLowerCase() || null;
  const role = ROLES.includes(p.role as Role) ? p.role : 'member';
  if (p.id) {
    const cur = await getPerson(q, p.id);
    if (!cur) throw new UserError('Person not found.');
    if (cur.id === actor.id && p.isAdmin === false) throw new UserError("You can't remove your own admin access.");
    await q('UPDATE people SET name=$1, email=$2, role=$3, is_admin=$4, active=$5 WHERE id=$6', [
      name || cur.name,
      p.email !== undefined ? email : cur.email,
      p.role !== undefined ? role : cur.role,
      p.isAdmin ?? cur.isAdmin,
      p.active ?? cur.active,
      p.id,
    ]);
  } else {
    if (!name) throw new UserError('Add a name.');
    await q('INSERT INTO people (name, email, role, is_admin) VALUES ($1,$2,$3,$4)', [name, email, role, !!p.isAdmin]);
  }
}

// ---------- Launch delays & reschedule suggestions ----------


const jsonArr = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : Array.isArray(v) ? v : []);

const mapSuggestion = (r: any): RescheduleSuggestion => ({
  id: r.id,
  delayId: r.delay_id,
  emailId: r.email_id,
  emailTitle: r.email_title,
  versionIds: jsonArr(r.version_ids),
  versionNames: jsonArr(r.version_names),
  currentSendDate: r.current_send_date,
  suggestedDate: r.suggested_date,
  movedOffWeekend: !!r.moved_off_weekend,
  plan: r.plan,
  status: r.status,
  finalDate: r.final_date,
  decidedById: r.decided_by_id,
  decidedAt: iso(r.decided_at),
  note: r.note,
});

/** Pending delays plus the 20 most recent ones. */
export async function listDelays(q: Query): Promise<LaunchDelay[]> {
  const delays = await q(
    `SELECT * FROM launch_delays d
     WHERE EXISTS (SELECT 1 FROM reschedule_suggestions s WHERE s.delay_id = d.id AND s.status = 'pending')
        OR d.id IN (SELECT id FROM launch_delays ORDER BY created_at DESC LIMIT 20)
     ORDER BY created_at DESC`,
  );
  if (!delays.length) return [];
  const sugg = (await q('SELECT * FROM reschedule_suggestions WHERE delay_id = ANY($1::int[]) ORDER BY current_send_date, id', [delays.map((d) => d.id)])).map(mapSuggestion);
  return delays.map((d) => ({
    id: d.id,
    city: d.city,
    oldLaunchDate: d.old_launch_date,
    newLaunchDate: d.new_launch_date,
    reason: d.reason,
    reportedById: d.reported_by_id,
    createdAt: iso(d.created_at)!,
    suggestions: sugg.filter((s) => s.delayId === d.id),
  }));
}

/** What a delay would affect — used for the preview before Ops submits, and to create the suggestions. */
export async function previewDelay(q: Query, city: string, oldLaunch: string, newLaunch: string) {
  const emails = await listEmails(q);
  const out = [];
  for (const e of emails) {
    const vs = affectedVersions(e, city);
    if (!vs.length) continue;
    const s = suggestSendDate(e.sendDate, oldLaunch, newLaunch);
    out.push({
      emailId: e.id,
      emailTitle: e.title,
      versionIds: vs.map((v) => v.id),
      versionNames: vs.map((v) => v.name),
      currentSendDate: e.sendDate,
      suggestedDate: s.date,
      movedOffWeekend: s.movedOffWeekend,
      plan: reschedulePlan(e.versions.length, vs.length),
    });
  }
  return out;
}

export async function reportDelay(q: Query, input: { city: string; oldLaunchDate: string; newLaunchDate: string; reason?: string }, actor: Person) {
  if (!canReportDelay(actor)) throw new UserError('Only Ops (or an admin) can report a launch delay.');
  const city = (input.city ?? '').trim();
  if (!city) throw new UserError('Pick the city whose launch moved.');
  const oldD = checkDate(input.oldLaunchDate);
  const newD = checkDate(input.newLaunchDate);
  if (oldD === newD) throw new UserError('The new launch date is the same as the old one.');
  const items = await previewDelay(q, city, oldD, newD);
  if (!items.length) throw new UserError(`No unsent launch emails go to ${city}. Check that the email is labeled “Launch email” and the version’s launch city is set.`);
  const [d] = await q('INSERT INTO launch_delays (city, old_launch_date, new_launch_date, reason, reported_by_id) VALUES ($1,$2,$3,$4,$5) RETURNING id', [city, oldD, newD, (input.reason ?? '').trim(), actor.id]);
  // A newer delay for the same email replaces any older pending suggestion.
  for (const it of items) {
    const pending = (await q(`SELECT * FROM reschedule_suggestions WHERE status='pending' AND email_id=$1`, [it.emailId])).map(mapSuggestion);
    for (const p of pending.filter((p) => p.versionIds.some((v) => it.versionIds.includes(v))))
      await q(`UPDATE reschedule_suggestions SET status='declined', note='Replaced by a newer delay report', decided_at=NOW() WHERE id=$1`, [p.id]);
    await q(
      `INSERT INTO reschedule_suggestions (delay_id, email_id, email_title, version_ids, version_names, current_send_date, suggested_date, moved_off_weekend, plan)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [d.id, it.emailId, it.emailTitle, JSON.stringify(it.versionIds), JSON.stringify(it.versionNames), it.currentSendDate, it.suggestedDate, it.movedOffWeekend, it.plan],
    );
    await log(q, it.emailId, null, actor.id, 'delay', `reported the ${city} launch moved from ${oldD} to ${newD}${input.reason ? ` (${input.reason.trim()})` : ''} — suggested new send ${it.suggestedDate}, waiting for approval`);
  }
  return d.id as number;
}

/** Re-date one email's versions: re-derive default due dates, shift hand-edited ones by the same amount. Completed steps stay as they are. */
async function redateVersions(q: Query, versionIds: number[], fromSend: string, toSend: string, sendTime: string | null) {
  const steps = await q('SELECT * FROM steps WHERE version_id = ANY($1::int[]) AND completed_at IS NULL', [versionIds]);
  for (const s of steps) {
    const d = s.due_overridden ? { dueDate: shiftDate(s.due_date, fromSend, toSend), dueTime: s.due_time } : defaultDue(s.key, toSend, sendTime);
    await q('UPDATE steps SET due_date=$1, due_time=$2 WHERE id=$3', [d.dueDate, d.dueTime, s.id]);
  }
}

export async function decideSuggestion(q: Query, id: number, decision: 'approve' | 'decline', actor: Person, opts: { date?: string; note?: string } = {}) {
  if (!canApproveReschedule(actor)) throw new UserError('Only Marketing (Kori) or an admin can approve a reschedule.');
  const [r] = await q('SELECT * FROM reschedule_suggestions WHERE id = $1', [id]);
  if (!r) throw new UserError('That suggestion no longer exists.');
  const sg = mapSuggestion(r);
  if (sg.status !== 'pending') throw new UserError('Someone already handled this suggestion.');
  const note = (opts.note ?? '').trim() || null;

  if (decision === 'decline') {
    await q(`UPDATE reschedule_suggestions SET status='declined', decided_by_id=$1, decided_at=NOW(), note=$2 WHERE id=$3`, [actor.id, note, id]);
    if (sg.emailId) await log(q, sg.emailId, null, actor.id, 'delay', `declined the suggested move to ${sg.suggestedDate}${note ? `: ${note}` : ''}`);
    return {};
  }

  if (!sg.emailId) throw new UserError('That email was deleted.');
  const finalDate = checkDate(opts.date || sg.suggestedDate);
  const e = await getEmailRow(q, sg.emailId);
  const allVs = await q('SELECT id, name FROM versions WHERE email_id = $1 ORDER BY sort_order, id', [e.id]);
  const ids = sg.versionIds.filter((v) => allVs.some((x) => x.id === v));
  if (!ids.length) throw new UserError('Those versions are no longer on this email.');
  const plan = reschedulePlan(allVs.length, ids.length);
  let targetId = e.id;

  if (plan === 'move') {
    await q('UPDATE emails SET send_date=$1, updated_at=NOW() WHERE id=$2', [finalDate, e.id]);
    await redateVersions(q, ids, e.sendDate, finalDate, e.sendTime);
    await log(q, e.id, null, actor.id, 'delay', `approved the reschedule: send moved from ${e.sendDate} to ${finalDate} (due dates updated)`);
  } else {
    // Only some versions (e.g. Chicago) are delayed: give them their own email on the new date.
    const names = allVs.filter((v) => ids.includes(v.id)).map((v) => v.name);
    const [ne] = await q('INSERT INTO emails (title, send_date, send_time, is_launch) VALUES ($1,$2,$3,TRUE) RETURNING id', [`${e.title} – ${names.join(' & ')}`, finalDate, e.sendTime]);
    targetId = ne.id;
    for (let i = 0; i < ids.length; i++) await q('UPDATE versions SET email_id=$1, sort_order=$2 WHERE id=$3', [ne.id, i, ids[i]]);
    await redateVersions(q, ids, e.sendDate, finalDate, e.sendTime);
    await log(q, e.id, null, actor.id, 'delay', `approved the reschedule: moved ${names.join(', ')} to a separate email on ${finalDate}`);
    await log(q, ne.id, null, actor.id, 'delay', `split from “${e.title}” after the launch delay; send ${finalDate}`);
  }
  await q(`UPDATE reschedule_suggestions SET status='approved', final_date=$1, decided_by_id=$2, decided_at=NOW(), note=$3 WHERE id=$4`, [finalDate, actor.id, note, id]);
  return { emailId: targetId };
}

