import fs from 'fs';
import { addDays, isWeekend } from '../src/lib/dates';
import { defaultDue } from '../src/lib/workflow';
const TODAY = '2026-11-18';
const HOL = new Set(['2026-11-26', '2026-11-27', '2026-12-24', '2026-12-25', '2026-12-31']);
const workday = (d: string) => { while (isWeekend(d) || HOL.has(d)) d = addDays(d, -1); return d; };
const NEW: Record<string, string> = { ed001: '2026-11-23', ed014: '2026-11-24', ed040: '2026-11-30', ed027: '2026-12-01', ed053: '2026-12-02', ed066: '2026-12-08', ed079: '2026-12-09', ed092: '2026-12-16' };
const old = JSON.parse(fs.readFileSync('/tmp/dec-ops.json', 'utf8'));
const vEmail: Record<string, string> = {};
for (const o of old) if (o.path.startsWith('versions/')) vEmail[o.path.split('/')[1]] = o.data.emailId;
const ops: any[] = [];
for (const [e, d] of Object.entries(NEW)) ops.push({ op: 'update', path: `emails/${e}`, ifVersion: 1, data: { sendDate: d } });
const report: string[] = [];
for (const o of old) {
  if (!o.path.startsWith('steps/')) continue;
  const e = vEmail[o.data.versionId]; if (!e) continue;
  const send = NEW[e]; const key = o.data.key;
  const dd = defaultDue(key, send, null);
  let due = key === 'email_sent' ? dd.dueDate : workday(dd.dueDate);
  if (due < TODAY) due = TODAY;
  ops.push({ op: 'update', path: o.path, ifVersion: 1, data: { dueDate: due, dueTime: dd.dueTime } });
  if (['creative_brief', 'audience_brief', 'design_submitted', 'test_send', 'audience_approved_2'].includes(key)) report.push(`${send} ${e} ${key} ${due}`);
}
for (const [e, d] of Object.entries(NEW)) ops.push({ op: 'set', path: `activity/ad${e}r1`, data: { emailId: e, versionId: null, personId: 'u_uIarySJN3XSZOTMsnhtXlA', kind: 'edited', message: `moved the send to ${d} (schedule pulled up; due dates updated)`, createdAt: '2026-11-18T16:20:00.000Z' } });
for (let i = 0; i < ops.length; i += 50) fs.writeFileSync(`/tmp/res-${i / 50}.json`, JSON.stringify(ops.slice(i, i + 50)));
console.log(ops.length); console.log(report.join('\n'));
