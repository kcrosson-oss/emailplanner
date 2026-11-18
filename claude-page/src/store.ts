// Data layer for the Claude-hosted page. Everything is stored in the artifact's shared
// database (claude.use("db")) and every viewer gets live updates. The workflow rules
// (lib/workflow.ts, lib/launch.ts) are checked here before any write.

import type { Activity, AppState, Email, Id, LaunchDelay, Link, Person, RescheduleSuggestion, Role, Step, StepKey, Version } from './lib/types';
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
} from './lib/workflow';
import { affectedVersions, canApproveReschedule, canReportDelay, reschedulePlan, shiftDate, suggestSendDate } from './lib/launch';

export class UserError extends Error {}

type Row = Record<string, any>;
type Snap = { id: string; data(): Row | undefined };

const COLS = ['people', 'emails', 'versions', 'steps', 'delays', 'suggestions'] as const;
type Col = (typeof COLS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const checkDate = (d: unknown) => {
  if (typeof d !== 'string' || !DATE_RE.test(d)) throw new UserError('Please pick a valid date.');
  return d;
};
const checkTime = (t: unknown) => {
  if (t === null || t === undefined || t === '') return null;
  if (typeof t !== 'string' || !TIME_RE.test(t)) throw new UserError('Please pick a valid time.');
  return t;
};
const nowIso = () => new Date().toISOString();

/** Run writes a few at a time (never two to the same doc at once — callers pass distinct docs). */
async function inChunks(tasks: (() => Promise<unknown>)[], size = 6) {
  for (let i = 0; i < tasks.length; i += size) await Promise.all(tasks.slice(i, i + size).map((t) => t()));
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
  ownerId?: Id | null;
  city?: string;
}

export interface Store {
  subscribe(cb: (s: AppState | null, status: 'loading' | 'ready' | 'slow' | 'error', err?: string) => void): () => void;
  act(type: string, p: Row): Promise<Row | void>;
  watchActivity(emailId: Id, cb: (items: Activity[]) => void): () => void;
  searchPeople(q: string): Promise<{ id: string; name: string; email?: string }[]>;
}

export function createStore(db: any, user: any): Store {
  const rows: Record<Col, Map<string, Row>> = {
    people: new Map(),
    emails: new Map(),
    versions: new Map(),
    steps: new Map(),
    delays: new Map(),
    suggestions: new Map(),
  };
  const loaded = new Set<Col>();
  const names = new Map<string, { name: string; email?: string }>();
  let meId: string | null = null;
  let owner = false;
  let listeners: ((s: AppState | null, status: any, err?: string) => void)[] = [];
  let status: 'loading' | 'ready' | 'slow' | 'error' = 'loading';
  let errMsg: string | undefined;
  let cached: AppState | null = null;
  let registering = false;

  // ---------- read model ----------
  const build = (): AppState | null => {
    if (!COLS.every((c) => loaded.has(c)) || !meId) return null;
    const people: Person[] = [...rows.people.entries()]
      .map(([id, r]) => ({
        id,
        name: names.get(id)?.name || r.label || 'Teammate',
        email: names.get(id)?.email ?? null,
        role: (r.role as Role) ?? 'member',
        isAdmin: !!r.isAdmin,
        active: r.active !== false,
      }))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
    let me = people.find((p) => p.id === meId);
    if (!me) me = { id: meId, name: names.get(meId)?.name || 'You', email: null, role: owner ? 'marketing' : 'member', isAdmin: owner, active: true };
    if (owner) me = { ...me, isAdmin: true };

    const stepsBy = new Map<string, Step[]>();
    for (const [id, r] of rows.steps) {
      const s: Step = {
        id,
        versionId: r.versionId,
        key: r.key,
        assigneeId: r.assigneeId ?? null,
        dueDate: r.dueDate,
        dueTime: r.dueTime ?? null,
        dueOverridden: !!r.dueOverridden,
        completedById: r.completedById ?? null,
        completedAt: r.completedAt ?? null,
        changesRequested: !!r.changesRequested,
        changesNote: r.changesNote ?? null,
      };
      stepsBy.set(s.versionId, [...(stepsBy.get(s.versionId) ?? []), s]);
    }
    const versBy = new Map<string, Version[]>();
    for (const [id, r] of rows.versions) {
      const v: Version = {
        id,
        emailId: r.emailId,
        name: r.name ?? 'Main',
        audience: r.audience ?? '',
        exclusions: r.exclusions ?? '',
        subject: r.subject ?? '',
        preheader: r.preheader ?? '',
        links: Array.isArray(r.links) ? r.links : [],
        previewUrl: r.previewUrl ?? '',
        notes: r.notes ?? '',
        ownerId: r.ownerId ?? null,
        sortOrder: r.sortOrder ?? 0,
        city: r.city ?? '',
        steps: sortSteps(stepsBy.get(id) ?? []).filter((s, i, a) => a.findIndex((x) => x.key === s.key) === i),
      };
      versBy.set(v.emailId, [...(versBy.get(v.emailId) ?? []), v]);
    }
    const emails: Email[] = [...rows.emails.entries()]
      .map(([id, r]) => ({
        id,
        title: r.title ?? 'Untitled',
        sendDate: r.sendDate,
        sendTime: r.sendTime ?? null,
        isLaunch: !!r.isLaunch,
        versions: (versBy.get(id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
      }))
      .filter((e) => DATE_RE.test(e.sendDate))
      .sort((a, b) => a.sendDate.localeCompare(b.sendDate) || a.title.localeCompare(b.title));

    const sugBy = new Map<string, RescheduleSuggestion[]>();
    for (const [id, r] of rows.suggestions) {
      const s = { id, ...r } as unknown as RescheduleSuggestion;
      sugBy.set(s.delayId, [...(sugBy.get(s.delayId) ?? []), s]);
    }
    const delays: LaunchDelay[] = [...rows.delays.entries()]
      .map(([id, r]) => ({ id, ...(r as any), suggestions: (sugBy.get(id) ?? []).sort((a, b) => a.currentSendDate.localeCompare(b.currentSendDate)) }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return { me, people, emails, delays, serverTime: nowIso() };
  };

  const emit = () => {
    cached = build();
    if (cached && status === 'loading') status = 'ready';
    for (const l of listeners) l(cached, status, errMsg);
  };

  let namesPending = false;
  const refreshNames = async () => {
    if (namesPending) return;
    const ids = [...new Set([...rows.people.keys(), ...(meId ? [meId] : [])])].filter((id) => !names.has(id));
    if (!ids.length) return;
    namesPending = true;
    try {
      const ps = await user.profiles(ids);
      for (const id of ids) names.set(id, { name: ps?.[id]?.name || '', email: ps?.[id]?.email });
    } catch {
      /* names are cosmetic */
    }
    namesPending = false;
    emit();
  };

  // Register the viewer in the people list on first visit (owner = Marketing (Kori) + admin).
  const ensureMe = async () => {
    if (registering || !meId || !loaded.has('people') || rows.people.has(meId)) return;
    registering = true;
    try {
      await db.collection('people').doc(meId).set({ role: owner ? 'marketing' : 'member', isAdmin: owner, active: true, joinedAt: nowIso() });
    } catch {
      /* read-only viewers can't register; that's fine */
    }
  };

  // ---------- subscriptions ----------
  const unsubs: (() => void)[] = [];
  const start = async () => {
    meId = (await user?.id?.()) ?? null;
    owner = !!(await user?.isOwner?.());
    const slow = setTimeout(() => {
      if (status === 'loading') {
        status = 'slow';
        emit();
      }
    }, 10000);
    for (const c of COLS) {
      unsubs.push(
        db.collection(c).onSnapshot(
          (snap: { docs: Snap[] }) => {
            const m = new Map<string, Row>();
            for (const d of snap.docs) m.set(d.id, d.data() ?? {});
            rows[c] = m;
            loaded.add(c);
            if (COLS.every((x) => loaded.has(x))) clearTimeout(slow);
            if (c === 'people') {
              refreshNames();
              ensureMe();
            }
            emit();
          },
          (e: { code: string; message: string }) => {
            clearTimeout(slow);
            status = 'error';
            errMsg = e.code === 'revoked' ? 'Access to this page changed. Reload to continue.' : e.message;
            emit();
          },
        ),
      );
    }
    refreshNames();
  };
  start();

  // ---------- write helpers ----------
  const ref = (c: string, id: string) => db.collection(c).doc(id);
  const newId = (c: string) => db.collection(c).doc().id as string;
  const S = () => {
    const s = cached ?? build();
    if (!s) throw new UserError('Still loading — try again in a moment.');
    return s;
  };
  const meP = () => S().me;
  const email = (id: Id) => {
    const e = S().emails.find((x) => x.id === id);
    if (!e) throw new UserError('That email no longer exists.');
    return e;
  };
  const versionCtx = (vid: Id) => {
    for (const e of S().emails) {
      const v = e.versions.find((x) => x.id === vid);
      if (v) return { email: e, version: v };
    }
    throw new UserError('That version no longer exists.');
  };
  const stepCtx = (sid: Id) => {
    for (const e of S().emails)
      for (const v of e.versions) {
        const st = v.steps.find((x) => x.id === sid);
        if (st) return { email: e, version: v, step: st };
      }
    throw new UserError('That step no longer exists.');
  };
  const log = (emailId: Id, versionId: Id | null, kind: string, message: string) =>
    db.collection('activity').doc().set({ emailId, versionId, personId: meId, kind, message, createdAt: nowIso() });

  const insertVersion = async (e: { id: Id; sendDate: string; sendTime: string | null; isLaunch: boolean }, v: VersionInput, sortOrder: number) => {
    const people = S().people;
    const vid = newId('versions');
    const city = (v.city ?? (e.isLaunch ? v.name : '')).trim();
    await ref('versions', vid).set({
      emailId: e.id,
      name: v.name?.trim() || 'Main',
      audience: v.audience ?? '',
      exclusions: v.exclusions ?? '',
      subject: v.subject ?? '',
      preheader: v.preheader ?? '',
      links: v.links ?? [],
      previewUrl: v.previewUrl ?? '',
      notes: v.notes ?? '',
      ownerId: v.ownerId ?? null,
      sortOrder,
      city,
    });
    await inChunks(
      STEP_KEYS.map((key) => () => {
        const due = defaultDue(key, e.sendDate, e.sendTime);
        return ref('steps', newId('steps')).set({
          versionId: vid,
          key,
          assigneeId: defaultAssignee(key, people, v.ownerId ?? null),
          dueDate: due.dueDate,
          dueTime: due.dueTime,
          dueOverridden: false,
          completedById: null,
          completedAt: null,
          changesRequested: false,
          changesNote: null,
        });
      }),
    );
    return vid;
  };

  const createEmail = async (p: { title: string; sendDate: string; sendTime?: string | null; isLaunch?: boolean; versions?: VersionInput[] }) => {
    const title = (p.title ?? '').trim();
    if (!title) throw new UserError('Give the email a title.');
    const sendDate = checkDate(p.sendDate);
    const sendTime = checkTime(p.sendTime);
    const isLaunch = p.isLaunch ?? /\blaunch\b/i.test(title);
    const id = newId('emails');
    await ref('emails', id).set({ title, sendDate, sendTime, isLaunch, createdAt: nowIso() });
    const vs = p.versions?.length ? p.versions : [{ name: 'Main' }];
    for (let i = 0; i < vs.length; i++) await insertVersion({ id, sendDate, sendTime, isLaunch }, vs[i], i);
    await log(id, null, 'created', `created this email (${vs.map((v) => v.name).join(', ')})`);
    return id;
  };

  const versionInput = (v: Version): VersionInput => ({
    name: v.name,
    audience: v.audience,
    exclusions: v.exclusions,
    subject: v.subject,
    preheader: v.preheader,
    links: v.links,
    previewUrl: v.previewUrl,
    notes: v.notes,
    ownerId: v.ownerId,
    city: v.city,
  });

  const setDone = (stepId: Id) => ref('steps', stepId).update({ completedById: meId, completedAt: nowIso(), changesRequested: false, changesNote: null });
  const setOpen = (stepId: Id) => ref('steps', stepId).update({ completedById: null, completedAt: null });
  const stepOf = (v: Version, key: StepKey) => v.steps.find((s) => s.key === key)!;

  const redate = async (versions: Version[], fromSend: string, toSend: string, sendTime: string | null) => {
    const tasks: (() => Promise<unknown>)[] = [];
    for (const v of versions)
      for (const s of v.steps) {
        if (s.completedAt) continue;
        const d = s.dueOverridden ? { dueDate: shiftDate(s.dueDate, fromSend, toSend), dueTime: s.dueTime } : defaultDue(s.key, toSend, sendTime);
        if (d.dueDate !== s.dueDate || d.dueTime !== s.dueTime) tasks.push(() => ref('steps', s.id).update(d));
      }
    await inChunks(tasks);
  };

  // ---------- actions ----------
  const actions: Record<string, (p: Row) => Promise<Row | void>> = {
    async createEmail(p) {
      return { id: await createEmail(p as any) };
    },

    async updateEmail({ id, patch = {} }) {
      const e = email(id);
      const upd: Row = {};
      if (patch.title !== undefined && patch.title.trim() && patch.title.trim() !== e.title) upd.title = patch.title.trim();
      if (patch.isLaunch !== undefined && !!patch.isLaunch !== e.isLaunch) upd.isLaunch = !!patch.isLaunch;
      const sendDate = patch.sendDate !== undefined ? checkDate(patch.sendDate) : e.sendDate;
      const sendTime = patch.sendTime !== undefined ? checkTime(patch.sendTime) : e.sendTime;
      if (sendDate !== e.sendDate) upd.sendDate = sendDate;
      if (sendTime !== e.sendTime) upd.sendTime = sendTime;
      if (!Object.keys(upd).length) return;
      await ref('emails', id).update(upd);
      if ('sendDate' in upd || 'sendTime' in upd) {
        const tasks: (() => Promise<unknown>)[] = [];
        for (const v of e.versions)
          for (const s of v.steps)
            if (!s.dueOverridden) {
              const d = defaultDue(s.key, sendDate, sendTime);
              if (d.dueDate !== s.dueDate || d.dueTime !== s.dueTime) tasks.push(() => ref('steps', s.id).update(d));
            }
        await inChunks(tasks);
        await log(id, null, 'edited', `moved the send to ${sendDate}${sendTime ? ' ' + sendTime : ''} (due dates updated)`);
      }
      if (upd.title) await log(id, null, 'edited', `renamed the email to “${upd.title}”`);
      if ('isLaunch' in upd) {
        if (upd.isLaunch) await inChunks(e.versions.filter((v) => !v.city).map((v) => () => ref('versions', v.id).update({ city: v.name })));
        await log(id, null, 'edited', upd.isLaunch ? 'labeled this a launch email' : 'removed the launch email label');
      }
    },

    async deleteEmail({ id }) {
      const e = email(id);
      await inChunks(e.versions.flatMap((v) => v.steps.map((s) => () => ref('steps', s.id).delete())));
      await inChunks(e.versions.map((v) => () => ref('versions', v.id).delete()));
      await ref('emails', id).delete();
      try {
        const acts = await db.collection('activity').where('emailId', '==', id).get();
        await inChunks(acts.docs.map((d: Snap) => () => ref('activity', d.id).delete()));
      } catch {
        /* leftover history is harmless */
      }
    },

    async duplicateEmail({ id }) {
      const e = email(id);
      const nid = await createEmail({ title: `${e.title} (copy)`, sendDate: e.sendDate, sendTime: e.sendTime, isLaunch: e.isLaunch, versions: e.versions.map(versionInput) });
      await log(nid, null, 'created', `duplicated from “${e.title}”`);
      return { id: nid };
    },

    async resetDueDates({ id }) {
      const e = email(id);
      const tasks = e.versions.flatMap((v) =>
        v.steps.map((s) => () => ref('steps', s.id).update({ ...defaultDue(s.key, e.sendDate, e.sendTime), dueOverridden: false })),
      );
      await inChunks(tasks);
      await log(id, null, 'edited', 'reset all due dates to the defaults');
    },

    async addVersion({ emailId, name, input }) {
      const e = email(emailId);
      const sort = e.versions.reduce((m, v) => Math.max(m, v.sortOrder), -1) + 1;
      const vin: VersionInput = input ?? { name, ownerId: meId };
      const vid = await insertVersion(e, vin, sort);
      await log(emailId, vid, 'version', `added version “${vin.name || 'Main'}”`);
      return { id: vid };
    },

    async duplicateVersion({ id }) {
      const { email: e, version: v } = versionCtx(id);
      return actions.addVersion({ emailId: e.id, input: { ...versionInput(v), name: `${v.name} (copy)` } });
    },

    async updateVersion({ id, patch = {} }) {
      const { email: e, version: v } = versionCtx(id);
      const upd: Row = {};
      const labels: Record<string, string> = { name: 'name', audience: 'audience', exclusions: 'exclusions', subject: 'subject line', preheader: 'preheader', links: 'links', previewUrl: 'preview link', notes: 'notes', ownerId: 'owner', city: 'launch city' };
      for (const k of Object.keys(labels)) {
        if (!(k in patch)) continue;
        let val = patch[k];
        if (k === 'links') val = (val as Link[]).map((l) => ({ label: String(l.label ?? '').trim(), url: String(l.url ?? '').trim() }));
        else if (typeof val === 'string' && (k === 'name' || k === 'city')) val = val.trim();
        if (k === 'name' && !val) continue;
        if (JSON.stringify(val) !== JSON.stringify((v as any)[k])) upd[k] = val ?? (k === 'ownerId' ? null : '');
      }
      if (!Object.keys(upd).length) return;
      await ref('versions', id).update(upd);
      await log(e.id, id, 'edited', `updated ${Object.keys(upd).map((k) => labels[k]).join(', ')}`);
    },

    async deleteVersion({ id }) {
      const { email: e, version: v } = versionCtx(id);
      if (e.versions.length <= 1) throw new UserError('An email needs at least one version. Delete the email instead.');
      await inChunks(v.steps.map((s) => () => ref('steps', s.id).delete()));
      await ref('versions', id).delete();
      await log(e.id, null, 'version', `removed version “${v.name}”`);
    },

    async completeStep({ id }) {
      const { email: e, version: v, step } = stepCtx(id);
      if (step.completedAt) return;
      const c = canComplete(step.key, v.steps, meP());
      if (!c.ok) throw new UserError(c.reason);
      await setDone(id);
      await log(e.id, v.id, 'step', `checked “${stepDef(step.key).label}” · ${v.name}`);
    },

    async reopenStep({ id }) {
      const { email: e, version: v, step } = stepCtx(id);
      if (!step.completedAt) return;
      const r = hasRole(step.key, meP());
      if (!r.ok) throw new UserError(r.reason);
      const keys = reopenPlan(step.key, v.steps);
      await inChunks(keys.map((k) => () => setOpen(stepOf(v, k).id)));
      const extra = keys.length > 1 ? ` (also reopened ${keys.slice(1).map((k) => stepDef(k).short).join(', ')})` : '';
      await log(e.id, v.id, 'step', `un-checked “${stepDef(step.key).label}” · ${v.name}${extra}`);
    },

    async requestChanges({ id, comment }) {
      const { email: e, version: v, step } = stepCtx(id);
      if (stepDef(step.key).kind !== 'approve') throw new UserError('Changes can only be requested on an approval step.');
      const note = String(comment ?? '').trim();
      if (!note) throw new UserError('Add a comment describing the changes needed.');
      const r = hasRole(step.key, meP());
      if (!r.ok) throw new UserError(r.reason);
      const plan = requestChangesPlan(step.key);
      await inChunks(plan.reopen.filter((k) => k !== plan.flag).map((k) => () => setOpen(stepOf(v, k).id)));
      await ref('steps', stepOf(v, plan.flag).id).update({ completedById: null, completedAt: null, changesRequested: true, changesNote: note });
      await log(e.id, v.id, 'changes', `requested changes on “${stepDef(step.key).label}” · ${v.name}: ${note}`);
    },

    async updateStep({ id, patch = {} }) {
      const { email: e, version: v, step } = stepCtx(id);
      const dueDate = patch.dueDate !== undefined ? checkDate(patch.dueDate) : step.dueDate;
      const dueTime = patch.dueTime !== undefined ? checkTime(patch.dueTime) : step.dueTime;
      const assigneeId = patch.assigneeId !== undefined ? patch.assigneeId || null : step.assigneeId;
      const dueChanged = dueDate !== step.dueDate || dueTime !== step.dueTime;
      if (!dueChanged && assigneeId === step.assigneeId) return;
      await ref('steps', id).update({ assigneeId, dueDate, dueTime, dueOverridden: step.dueOverridden || dueChanged });
      const label = stepDef(step.key).label;
      if (dueChanged) await log(e.id, v.id, 'edited', `changed due date of “${label}” · ${v.name} to ${dueDate}${dueTime ? ' ' + dueTime : ''}`);
      if (assigneeId !== step.assigneeId) {
        const who = S().people.find((p) => p.id === assigneeId)?.name ?? 'nobody';
        await log(e.id, v.id, 'edited', `assigned “${label}” · ${v.name} to ${who}`);
      }
    },

    async moveVersion({ id, stage }) {
      if (!STAGES.find((s) => s.id === stage)) throw new UserError('Unknown column.');
      const { email: e, version: v } = versionCtx(id);
      const plan = movePlan(stage as StageId, v.steps);
      const sim = v.steps.map((s) => ({ ...s }));
      for (const k of [...plan.reopen].reverse()) {
        const r = hasRole(k, meP());
        if (!r.ok) throw new UserError(r.reason);
        sim.find((s) => s.key === k)!.completedAt = null;
      }
      for (const k of plan.complete) {
        const c = canComplete(k, sim, meP());
        if (!c.ok) throw new UserError(c.reason);
        sim.find((s) => s.key === k)!.completedAt = 'pending';
      }
      await inChunks(plan.reopen.map((k) => () => setOpen(stepOf(v, k).id)));
      await inChunks(plan.complete.map((k) => () => setDone(stepOf(v, k).id)));
      if (plan.complete.length || plan.reopen.length) await log(e.id, v.id, 'step', `moved ${v.name} to “${STAGES.find((s) => s.id === stage)!.label}” on the board`);
    },

    async comment({ emailId, versionId, text }) {
      const t = String(text ?? '').trim();
      if (!t) throw new UserError('Write a comment first.');
      email(emailId);
      await log(emailId, versionId ?? null, 'comment', t);
    },

    async savePerson({ person }) {
      const me = meP();
      if (!me.isAdmin) throw new UserError('Only admins can edit the people list.');
      const id: string = person.id;
      if (!id) throw new UserError('Pick someone first.');
      const cur = rows.people.get(id);
      if (id === meId && person.isAdmin === false) throw new UserError("You can't remove your own admin access.");
      const next = {
        role: person.role ?? cur?.role ?? 'member',
        isAdmin: person.isAdmin ?? cur?.isAdmin ?? false,
        active: person.active ?? cur?.active ?? true,
        ...(person.label ? { label: person.label } : {}),
      };
      await ref('people', id).set({ ...(cur ?? {}), ...next });
      // New Ops / Marketing person: pick up any unassigned steps for that role.
      if ((next.role === 'ops' || next.role === 'marketing') && next.role !== cur?.role) {
        const tasks: (() => Promise<unknown>)[] = [];
        for (const e of S().emails)
          for (const v of e.versions)
            for (const s of v.steps)
              if (!s.assigneeId && !s.completedAt && stepDef(s.key).role === next.role) tasks.push(() => ref('steps', s.id).update({ assigneeId: id }));
        await inChunks(tasks);
      }
    },

    async reportDelay({ city, oldLaunchDate, newLaunchDate, reason }) {
      if (!canReportDelay(meP())) throw new UserError('Only Ops (or an admin) can report a launch delay.');
      const c = String(city ?? '').trim();
      if (!c) throw new UserError('Pick the city whose launch moved.');
      const oldD = checkDate(oldLaunchDate);
      const newD = checkDate(newLaunchDate);
      if (oldD === newD) throw new UserError('The new launch date is the same as the old one.');
      const items = S()
        .emails.map((e) => ({ e, vs: affectedVersions(e, c) }))
        .filter((x) => x.vs.length);
      if (!items.length) throw new UserError(`No unsent launch emails go to ${c}. Check the email is labeled “Launch email” and the version’s launch city is set.`);
      const did = newId('delays');
      await ref('delays', did).set({ city: c, oldLaunchDate: oldD, newLaunchDate: newD, reason: String(reason ?? '').trim(), reportedById: meId, createdAt: nowIso() });
      const pending = S().delays.flatMap((d) => d.suggestions).filter((s) => s.status === 'pending');
      for (const { e, vs } of items) {
        const ids = vs.map((v) => v.id);
        for (const p of pending.filter((p) => p.emailId === e.id && p.versionIds.some((v) => ids.includes(v))))
          await ref('suggestions', p.id).update({ status: 'declined', note: 'Replaced by a newer delay report', decidedAt: nowIso() });
        const s = suggestSendDate(e.sendDate, oldD, newD);
        await ref('suggestions', newId('suggestions')).set({
          delayId: did,
          emailId: e.id,
          emailTitle: e.title,
          versionIds: ids,
          versionNames: vs.map((v) => v.name),
          currentSendDate: e.sendDate,
          suggestedDate: s.date,
          movedOffWeekend: s.movedOffWeekend,
          plan: reschedulePlan(e.versions.length, vs.length),
          status: 'pending',
          finalDate: null,
          decidedById: null,
          decidedAt: null,
          note: null,
        });
        await log(e.id, null, 'delay', `reported the ${c} launch moved from ${oldD} to ${newD}${reason ? ` (${String(reason).trim()})` : ''} — suggested new send ${s.date}, waiting for approval`);
      }
      return { id: did };
    },

    async declineReschedule({ id, note }) {
      if (!canApproveReschedule(meP())) throw new UserError('Only Marketing (Kori) or an admin can decide on a reschedule.');
      const sg = S().delays.flatMap((d) => d.suggestions).find((s) => s.id === id);
      if (!sg || sg.status !== 'pending') throw new UserError('Someone already handled this suggestion.');
      const n = String(note ?? '').trim() || null;
      await ref('suggestions', id).update({ status: 'declined', decidedById: meId, decidedAt: nowIso(), note: n });
      if (sg.emailId && rows.emails.has(sg.emailId)) await log(sg.emailId, null, 'delay', `declined the suggested move to ${sg.suggestedDate}${n ? `: ${n}` : ''}`);
    },

    async approveReschedule({ id, date, note }) {
      if (!canApproveReschedule(meP())) throw new UserError('Only Marketing (Kori) or an admin can approve a reschedule.');
      const sg = S().delays.flatMap((d) => d.suggestions).find((s) => s.id === id);
      if (!sg || sg.status !== 'pending') throw new UserError('Someone already handled this suggestion.');
      if (!sg.emailId || !rows.emails.has(sg.emailId)) throw new UserError('That email was deleted.');
      const finalDate = checkDate(date || sg.suggestedDate);
      const e = email(sg.emailId);
      const moving = e.versions.filter((v) => sg.versionIds.includes(v.id));
      if (!moving.length) throw new UserError('Those versions are no longer on this email.');
      const plan = reschedulePlan(e.versions.length, moving.length);
      let target = e.id;
      if (plan === 'move') {
        await ref('emails', e.id).update({ sendDate: finalDate });
        await redate(moving, e.sendDate, finalDate, e.sendTime);
        await log(e.id, null, 'delay', `approved the reschedule: send moved from ${e.sendDate} to ${finalDate} (due dates updated)`);
      } else {
        const names = moving.map((v) => v.name);
        target = newId('emails');
        await ref('emails', target).set({ title: `${e.title} – ${names.join(' & ')}`, sendDate: finalDate, sendTime: e.sendTime, isLaunch: true, createdAt: nowIso() });
        await inChunks(moving.map((v, i) => () => ref('versions', v.id).update({ emailId: target, sortOrder: i })));
        await redate(moving, e.sendDate, finalDate, e.sendTime);
        await log(e.id, null, 'delay', `approved the reschedule: moved ${names.join(', ')} to a separate email on ${finalDate}`);
        await log(target, null, 'delay', `split from “${e.title}” after the launch delay; send ${finalDate}`);
      }
      await ref('suggestions', id).update({ status: 'approved', finalDate, decidedById: meId, decidedAt: nowIso(), note: String(note ?? '').trim() || null });
      return { emailId: target };
    },
  };

  return {
    subscribe(cb) {
      listeners.push(cb);
      cb(cached ?? build(), status, errMsg);
      return () => {
        listeners = listeners.filter((l) => l !== cb);
      };
    },
    async act(type, p) {
      const fn = actions[type];
      if (!fn) throw new UserError('Unknown action.');
      return fn(p);
    },
    watchActivity(emailId, cb) {
      return db
        .collection('activity')
        .where('emailId', '==', emailId)
        .onSnapshot(
          (snap: { docs: Snap[] }) =>
            cb(
              snap.docs
                .map((d) => ({ id: d.id, ...(d.data() as any) }) as Activity)
                .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
                .slice(0, 200),
            ),
          () => {},
        );
    },
    async searchPeople(q) {
      try {
        const hits = await user.search(q);
        return (hits ?? []).map((h: any) => ({ id: h.id, name: h.name || h.email || 'Someone', email: h.email }));
      } catch {
        return [];
      }
    },
  };
}
