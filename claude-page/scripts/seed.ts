// Prints the starter data as { "collection/docId": body } for loading into the page's database.
// Usage: tsx scripts/seed.ts <koriUserId>
import { defaultDue, STEP_KEYS, stepDef } from '../src/lib/workflow';

const kori = process.argv[2] || 'kori';
const out: Record<string, unknown> = {};
let n = 0;
const id = (p: string) => `${p}${(++n).toString().padStart(3, '0')}`;
const now = new Date().toISOString();

out[`people/${kori}`] = { role: 'marketing', isAdmin: true, active: true, joinedAt: now };

function email(title: string, sendDate: string, isLaunch: boolean, versions: Record<string, unknown>[]) {
  const eid = id('e');
  out[`emails/${eid}`] = { title, sendDate, sendTime: null, isLaunch, createdAt: now };
  versions.forEach((v, i) => {
    const vid = id('v');
    out[`versions/${vid}`] = { emailId: eid, audience: '', exclusions: '', subject: '', preheader: '', links: [], previewUrl: '', notes: '', city: '', ownerId: kori, sortOrder: i, ...v };
    for (const key of STEP_KEYS) {
      const due = defaultDue(key, sendDate, null);
      out[`steps/${id('s')}`] = {
        versionId: vid, key, assigneeId: stepDef(key).role === 'ops' ? null : kori,
        dueDate: due.dueDate, dueTime: due.dueTime, dueOverridden: false,
        completedById: null, completedAt: null, changesRequested: false, changesNote: null,
      };
    }
  });
  out[`activity/${id('a')}`] = { emailId: eid, versionId: null, personId: kori, kind: 'created', message: `created this email (${versions.map((v) => v.name).join(', ')})`, createdAt: now };
}

const mcpEx = ['Compass Group Canada - ISN', 'Compass Group US', 'Compass Group Canada', 'All churned customers'].join('\n');
const mcpLinks = [
  { label: 'ChatGPT', url: 'https://api.getresq.com/rest/docs/mcp/#openai' },
  { label: 'Claude', url: 'https://api.getresq.com/rest/docs/mcp/#claude' },
  { label: 'Developer center', url: 'https://api.getresq.com/rest/docs/' },
];
const mcpSubject = 'Your ResQ repair updates, right in Claude or ChatGPT';
email('MCP Email', '2026-11-02', false, [
  { name: 'Trades', audience: 'All Trades', exclusions: mcpEx, subject: mcpSubject, links: mcpLinks },
  { name: 'Facilities', audience: 'All Facilities', exclusions: mcpEx, subject: mcpSubject, links: mcpLinks },
]);
const lLinks = [
  { label: 'Top', url: 'https://app.getresq.com/~/resq-services' },
  { label: 'Bottom', url: 'https://app.getresq.com/~/new-request/repair-request' },
];
const lNotes = 'Churned customers are kept (not excluded).';
email('Launch Email', '2026-11-04', true, [
  { name: 'Boston', city: 'Boston', audience: 'Everyone in Boston', exclusions: 'Customers with PM', notes: lNotes, links: lLinks },
  { name: 'Chicago', city: 'Chicago', audience: 'Everyone in Chicago', exclusions: 'Customers with PM', notes: lNotes, links: lLinks },
]);

process.stdout.write(JSON.stringify(out));
