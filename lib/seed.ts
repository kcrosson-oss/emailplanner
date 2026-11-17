// Starter data, loaded automatically the first time the app runs against an empty database.
import type { DB } from './db';
import { createEmail } from './repo';

export async function seedIfEmpty(db: DB) {
  const [{ c }] = await db.query<{ c: number }>('SELECT COUNT(*)::int AS c FROM people');
  if (Number(c) > 0) return;
  await seed(db);
}

export async function seed(db: DB) {
  await db.tx(async (q) => {
    const [kori] = await q(
      `INSERT INTO people (name, email, role, is_admin) VALUES ('Kori Crosson', 'kori@getresq.com', 'marketing', TRUE) RETURNING id`,
    );
    await q(`INSERT INTO people (name, email, role, is_admin) VALUES ('Ops Reviewer', 'ops@getresq.com', 'ops', FALSE)`);

    const mcpExclusions = ['Compass Group Canada - ISN', 'Compass Group US', 'Compass Group Canada', 'All churned customers'].join('\n');
    const mcpLinks = [
      { label: 'ChatGPT', url: 'https://api.getresq.com/rest/docs/mcp/#openai' },
      { label: 'Claude', url: 'https://api.getresq.com/rest/docs/mcp/#claude' },
      { label: 'Developer center', url: 'https://api.getresq.com/rest/docs/' },
    ];
    const mcpSubject = 'Your ResQ repair updates, right in Claude or ChatGPT';
    await createEmail(
      q,
      {
        title: 'MCP Email',
        sendDate: '2026-11-02',
        isLaunch: false,
        versions: [
          { name: 'Trades', audience: 'All Trades', exclusions: mcpExclusions, subject: mcpSubject, links: mcpLinks, ownerId: kori.id },
          { name: 'Facilities', audience: 'All Facilities', exclusions: mcpExclusions, subject: mcpSubject, links: mcpLinks, ownerId: kori.id },
        ],
      },
      kori.id,
    );

    const launchLinks = [
      { label: 'Top', url: 'https://app.getresq.com/~/resq-services' },
      { label: 'Bottom', url: 'https://app.getresq.com/~/new-request/repair-request' },
    ];
    const launchExclusions = 'Customers with PM';
    const launchNotes = 'Churned customers are kept (not excluded).';
    await createEmail(
      q,
      {
        title: 'Launch Email',
        sendDate: '2026-11-04',
        isLaunch: true,
        versions: [
          { name: 'Boston', city: 'Boston', audience: 'Everyone in Boston', exclusions: launchExclusions, notes: launchNotes, links: launchLinks, ownerId: kori.id },
          { name: 'Chicago', city: 'Chicago', audience: 'Everyone in Chicago', exclusions: launchExclusions, notes: launchNotes, links: launchLinks, ownerId: kori.id },
        ],
      },
      kori.id,
    );
  });
}
