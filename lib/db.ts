// Database connection. One tiny interface, two backends:
//  - DATABASE_URL set  → real Postgres (Neon, Supabase, Vercel Postgres, Docker…) via `pg`
//  - DATABASE_URL unset → embedded Postgres (PGlite) stored in ./.data — zero setup for local use
// Both speak the same Postgres SQL, so nothing else in the app cares which one is running.

import { SCHEMA_SQL } from './schema';

export type Query = <T = any>(text: string, params?: unknown[]) => Promise<T[]>;
export interface DB {
  query: Query;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Query) => Promise<T>): Promise<T>;
  kind: 'postgres' | 'pglite';
}

const g = globalThis as unknown as { __resqDb?: Promise<DB> };

async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import('pg');
    const needsSsl = !/localhost|127\.0\.0\.1/.test(url) && !/sslmode=disable/.test(url);
    const pool = new Pool({ connectionString: url, max: 5, ssl: needsSsl ? { rejectUnauthorized: false } : undefined });
    const query: Query = async (text, params) => (await pool.query(text, params as any[])).rows;
    return {
      kind: 'postgres',
      query,
      exec: async (sql) => {
        await pool.query(sql);
      },
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn(async (t, p) => (await client.query(t, p as any[])).rows);
          await client.query('COMMIT');
          return out;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      },
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR || './.data/pglite';
  const fs = await import('fs');
  fs.mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.waitReady;
  const query: Query = async (text, params) => (await db.query<any>(text, params as any[])).rows;
  return {
    kind: 'pglite',
    query,
    exec: async (sql) => {
      await db.exec(sql);
    },
    tx: (fn) => db.transaction((t) => fn(async (q, p) => (await t.query<any>(q, p as any[])).rows)),
  };
}

/** Get the shared DB, creating tables (and seed data on first run) automatically. */
export function getDb(): Promise<DB> {
  if (!g.__resqDb) {
    g.__resqDb = (async () => {
      const db = await connect();
      await db.exec(SCHEMA_SQL);
      const { seedIfEmpty } = await import('./seed');
      await seedIfEmpty(db);
      return db;
    })().catch((e) => {
      g.__resqDb = undefined;
      throw e;
    });
  }
  return g.__resqDb;
}
