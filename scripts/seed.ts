// npm run seed        → load starter data if the database is empty
// npm run reset-db    → WIPE everything and reload the starter data
import { getDb } from '../lib/db';
import { seed } from '../lib/seed';

async function main() {
  const db = await getDb(); // creates tables + seeds an empty DB
  if (process.argv.includes('--reset')) {
    await db.exec('TRUNCATE activity, steps, versions, emails, people RESTART IDENTITY CASCADE');
    await seed(db);
    console.log('Database reset and starter data loaded.');
  } else {
    console.log('Database ready (starter data is loaded automatically when empty).');
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
