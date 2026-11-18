# ResQ Email Planner

A shared planner for the marketing team's email sends. You can plan each email and its versions, track the 7 approval steps, copy UTM-tagged links, and see everything in calendar, board, timeline and "My tasks" views. Everything is saved to a shared database, so a step one person checks shows up for everyone. Other open browsers pick up changes within about 10 seconds.

---

## What's in it

| View | What it does |
|---|---|
| **Calendar** | Month or week view. Each email sits on its send date, with steps done (e.g. 8/14 across two versions) and a health color. Step deadlines show as "N steps due". |
| **Board** | One card per version, in columns: Design → Audience → Kori approval → Ops approval → Ready to send → Sent. Drag a card to another column, or tick its next step on the card. |
| **Timeline** | Each version's step deadlines leading up to its send date, with an orange "Today" line. Weekends are shaded. |
| **My tasks** | Overdue steps plus anything due in the next 7 days. You can filter by person (or Everyone / Unassigned). |
| **Launch delays** | Ops reports a city launch delay. Every launch email for that city gets a suggested new send date for Marketing to approve. See below. |
| **Email drawer** | Click any email to see its checklist for each version, with assignee, due date/time, and who completed each step and when. "Request changes" sends a step back. You can edit the version's details (audience, exclusions, subject, preheader, preview link, owner, notes) and links, and copy the UTM-tagged links. Comments and an activity log are at the bottom. |

**Health colors:** red = overdue · orange = due today · yellow = due within 2 days · green = on track · grey = sent.

### Workflow rules
1. Design Submitted
2. Audiences Submitted
3. Design Approved – Stage 1 (Kori)
4. Design Approved – Stage 2 (Ops)
5. Audience Approved – Stage 1 (Kori)
6. Audience Approved – Stage 2 (Ops), which is also the **list upload final** deadline
7. Email Sent

- An approval can only be checked once its matching submission is checked. **Stage 2 can only be checked after Stage 1.**
- Only people with the **Marketing (Kori)** role can check Stage 1. Only **Ops** can check Stage 2. **Admins** can check either.
- Email Sent unlocks once all six steps above it are done.
- Un-checking a step also un-checks the steps that depend on it.
- **Request changes** on an approval needs a comment. It re-opens the matching Submitted step (and that track's approvals) and flags it with your comment.

### Launch delays (Ops → suggested new date → Marketing approves)
1. Tick **Launch email** at the top of an email (any email with "launch" in its title gets this automatically). Each version has a **Launch city**, which defaults to the version name (e.g. Boston, Chicago).
2. When a city launch slips, someone with the **Ops** role clicks **Report launch delay** and enters the city, the old and new launch dates, and an optional reason. Before submitting, they see every unsent launch email for that city with its suggested new send date.
   - The suggestion shifts the send by the same number of days as the delay. If that lands on a Saturday or Sunday, it moves to the following Monday.
3. Everyone sees an orange banner, and the suggested dates appear on the calendar as dashed "Suggested" chips. Nothing moves until **Marketing (Kori)** or an admin clicks **Approve** in the banner, in **My tasks**, or in the email. They can change the date before approving, or **Decline** with a note.
4. On approval:
   - **If every version is delayed,** the email moves to the new date.
   - **If only some are** (e.g. Chicago but not Boston), those versions split off into their own email (e.g. "Launch Email – Chicago") on the new date, and Boston stays put.
   - Unfinished steps get new due dates. Hand-edited dates shift by the same amount, and completed steps are kept.
   - It's all recorded in each email's activity log.

### Default due dates (every one can be edited per step)
- Steps 1–5: **3 days before send**
- Step 6 (Audience Stage 2 / list upload final): **the day before send, by 12:00 PM ET**
- Step 7: **the send date** (at the send time, if one is set)

Deadlines that fall on a Saturday or Sunday get a **WEEKEND** flag. If you change an email's send date, every due date you haven't edited by hand moves with it. "Reset due dates" puts them all back to the defaults.

### UTM tags
Every link gets `?utm_source=email&utm_medium=marketing_YYYYMMDD&utm_campaign=<topic_slug>`:
- the date is the send date
- the slug is the email title in lowercase with underscores (e.g. `MCP Email` → `mcp_email`), the same for every version
- the tags go before any `#fragment`, and are added with `&` if the URL already has a `?`

---

## Run it on your computer

You need [Node.js](https://nodejs.org) version 20 or newer. Nothing else: the app uses a built-in database stored in a `.data` folder.

```bash
npm install
npm run dev
```

Open http://localhost:3000. The local passcode is `resq-local`. The starter data (MCP Email and Launch Email) loads automatically the first time.

Other commands:
- `npm test` runs the automated tests (due dates, UTM tags, stage rules, health colors)
- `npm run reset-db` **erases everything** and reloads the starter data

---

## Put it online for free (Netlify + Neon)

Netlify's free plan allows business use, and Neon's free plan covers the database. You'll need free accounts at **GitHub**, **Netlify** and **Neon**.

1. **Database:** in [Neon](https://console.neon.tech), open your project and click **Connect**. Turn on **Connection pooling** and copy the `postgresql://…` string. Delete `&channel_binding=require` from the end if it's there.
2. **Website:** go to [app.netlify.com/start](https://app.netlify.com/start) and choose **GitHub**, then pick the `emailplanner` repo. Netlify detects Next.js automatically, so leave the build settings as they are.
3. Before deploying, open **Add environment variables** and add `DATABASE_URL`, `SESSION_SECRET` (any long random text) and `TEAM_PASSCODE`.
4. Click **Deploy**. When it finishes you'll get a link like `something.netlify.app`. You can rename it under *Site configuration → Change site name*.

Every push to GitHub redeploys the site automatically.

## Alternative: Vercel + Neon

> Vercel's free Hobby plan is for personal, non-commercial use only. A company tool needs Vercel Pro, which is paid.

You'll need free accounts at **GitHub**, **Vercel** and **Neon**. Plan on about 15 minutes.

1. **Put the code on GitHub.** Create a new private repository and upload this folder to it. (In GitHub Desktop: *File → Add local repository → Publish*.)
2. **Create the database.** In [Neon](https://neon.tech), create a project (any name, region "US East"). On the dashboard, click **Connect** and copy the connection string. It starts with `postgresql://` and ends with `?sslmode=require`.
3. **Create the site.** In [Vercel](https://vercel.com), choose **Add New → Project**, pick your GitHub repo, and open **Environment Variables**. Add:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the Neon connection string from step 2 |
   | `SESSION_SECRET` | any long random text (e.g. 40+ random characters). Keep it private. |
   | `TEAM_PASSCODE` | the passcode your team will type to sign in |

4. Click **Deploy**. When it finishes, open the URL. The tables and starter data are created automatically on the first visit.
5. Share the URL and passcode with the team. Kori is set up as the admin. Use **People & settings** (click your name, top right) to add teammates, set roles, or rename "Ops Reviewer" to your actual Ops person.

> Tip: Vercel → your project → Settings → Domains lets you use something like `emails.getresq.com`.

---

## Sign-in options

**Passcode (default).** Each person picks their name from the list and types the shared team passcode. Someone not on the list can add themselves; they join as a "Team member" until an admin gives them a role. To change the passcode, update `TEAM_PASSCODE` in Vercel and redeploy.

**Google sign-in, only @getresq.com accounts.** This mode is built in. To switch to it:

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type *Web application*. Set the **Authorized redirect URI** to `https://YOUR-SITE/api/auth/google/callback`. (If asked to set up the consent screen first, choose **Internal**.)
2. In Vercel, add these environment variables and redeploy:

   | Name | Value |
   |---|---|
   | `AUTH_MODE` | `google` |
   | `GOOGLE_CLIENT_ID` | from step 1 |
   | `GOOGLE_CLIENT_SECRET` | from step 1 |
   | `ALLOWED_DOMAIN` | `getresq.com` |
   | `APP_URL` | `https://YOUR-SITE` (no trailing slash) |

People are matched to the people list by email address, so make sure each teammate's email is filled in under **People & settings**. Anyone new from the allowed domain is added automatically as a Team member.

---

## For engineers

- **Stack:** Next.js 15 (App Router) with TypeScript, and Postgres through `pg`. When `DATABASE_URL` is unset it uses [PGlite](https://pglite.dev) (embedded Postgres), so local and production run the same SQL. There's no ORM and no migration step: `lib/schema.ts` uses `CREATE TABLE IF NOT EXISTS` and runs on boot.
- **Layout:**
  - `lib/launch.ts`: launch-delay rules (affected versions, suggested date, move vs. split, who can report and approve)
  - `lib/workflow.ts`: step definitions, default due dates, permissions, board stages, health (pure functions, unit-tested)
  - `lib/utm.ts`, `lib/dates.ts`: UTM tagging, date math (ET wall-clock)
  - `lib/repo.ts`: all DB reads and writes. Every rule is re-checked server-side.
  - `app/api/action/route.ts`: a single mutation endpoint `{ type, ...payload }`, run inside a transaction
  - `app/api/state/route.ts`: full board state (clients poll every 10s) and the per-email activity feed
  - `lib/auth.ts` + `app/api/auth/*`: signed-cookie sessions with passcode or Google OAuth
  - `components/*`: the views
- **Tests:** `npm test` (Vitest, `tests/*.test.ts`).
- **Docker Postgres instead of PGlite:** `docker run -p 5432:5432 -e POSTGRES_PASSWORD=pw postgres:16`, then `DATABASE_URL=postgresql://postgres:pw@localhost:5432/postgres?sslmode=disable npm run dev`.
