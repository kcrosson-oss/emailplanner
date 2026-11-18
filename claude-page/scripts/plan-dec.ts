// Builds db_write ops for the Dec 2026 email plan + the 3 new steps on Launch Email – Chicago.
import { addDays, isWeekend } from '../src/lib/dates';
import { defaultDue, STEP_KEYS, stepDef } from '../src/lib/workflow';
import type { StepKey } from '../src/lib/types';

const kori = process.argv[2];
const HOLIDAYS = new Set(['2026-11-26', '2026-11-27', '2026-12-24', '2026-12-25', '2026-12-31']);
const workday = (d: string) => { while (isWeekend(d) || HOLIDAYS.has(d)) d = addDays(d, -1); return d; };
const now = new Date().toISOString();
const ops: any[] = [];
let n = 0;
const id = (p: string) => `${p}d${(++n).toString().padStart(3, '0')}`;
const blankBrief = { goal: '', keyMessage: '', cta: '', notes: '', link: '' };

function step(versionId: string, key: StepKey, sendDate: string) {
  const d = defaultDue(key, sendDate, null);
  const dueDate = key === 'email_sent' ? d.dueDate : workday(d.dueDate);
  const roles = stepDef(key).roles ?? (stepDef(key).role ? [stepDef(key).role] : []);
  const assignee = roles.length && !roles.includes('marketing') ? null : kori;
  return { op: 'set', path: `steps/${id('s')}`, data: { versionId, key, assigneeId: assignee, dueDate, dueTime: d.dueTime, dueOverridden: false, completedById: null, completedAt: null, changesRequested: false, changesNote: null } };
}

function email(title: string, sendDate: string, isLaunch: boolean, v: Record<string, unknown>) {
  const eid = id('e'), vid = id('v');
  ops.push({ op: 'set', path: `emails/${eid}`, data: { title, sendDate, sendTime: null, isLaunch, brief: blankBrief, createdAt: now } });
  ops.push({ op: 'set', path: `versions/${vid}`, data: { emailId: eid, audience: '', exclusions: '', subject: '', preheader: '', links: [], previewUrl: '', notes: '', city: '', ownerId: kori, sortOrder: 0, ...v } });
  for (const k of STEP_KEYS) ops.push(step(vid, k, sendDate));
  ops.push({ op: 'set', path: `activity/${id('a')}`, data: { emailId: eid, versionId: null, personId: kori, kind: 'created', message: `added to the December plan (send ${sendDate}) — creative brief to come`, createdAt: now } });
}

const mcpLinks = [
  { label: 'ChatGPT', url: 'https://api.getresq.com/rest/docs/mcp/#openai' },
  { label: 'Claude', url: 'https://api.getresq.com/rest/docs/mcp/#claude' },
  { label: 'Developer center', url: 'https://api.getresq.com/rest/docs/' },
];
const mcpEx = ['Compass Group Canada - ISN', 'Compass Group US', 'Compass Group Canada', 'All churned customers'].join('\n');
const mcpNote = 'Exclusions and links copied from MCP Email #1 — Ops to confirm in the audience brief.';
const diff = { name: 'All ResQ areas', audience: 'All ResQ users in a ResQ Services area' };

email('Houston Systems Check Email #2', '2026-12-02', true, { name: 'Houston', city: 'Houston', audience: 'Houston' });
email('Why ResQ Is Different #1', '2026-12-03', false, diff);
email('MCP Email #2 – Trades', '2026-12-08', false, { name: 'Trades', audience: 'All Trades', exclusions: mcpEx, links: mcpLinks, notes: mcpNote });
email('Houston Systems Check Email #3', '2026-12-09', true, { name: 'Houston', city: 'Houston', audience: 'Houston' });
email('Why ResQ Is Different #2', '2026-12-10', false, diff);
email('MCP Email #2 – Facilities', '2026-12-15', false, { name: 'Facilities', audience: 'All Facilities', exclusions: mcpEx, links: mcpLinks, notes: mcpNote });
email('Why ResQ Is Different #3', '2026-12-17', false, diff);
email('Why ResQ Is Different #4', '2026-12-22', false, diff);

// Existing Launch Email (Chicago, send Nov 4): add the three new steps.
for (const k of ['creative_brief', 'audience_brief', 'test_send'] as StepKey[]) ops.push(step('v028', k, '2026-11-04'));

process.stdout.write(JSON.stringify(ops));
