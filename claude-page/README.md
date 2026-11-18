# ResQ Email Planner — Claude page version

This is the version the team actually uses: a Claude page with a shared database built in. It needs no hosting, database or passcode, and everyone signs in with Claude.

- Live page: https://claude.ai/artifact/5H8ENugdYejhGGChN6SYvV
- `src/store.ts` holds all reads and writes, using the page's shared `db`, with live updates for everyone.
- `src/lib/*` holds the same workflow, UTM and launch-delay rules as the Next.js app (`npm test`).
- `node build.mjs` produces `dist/index.html`, the single file that gets published.
