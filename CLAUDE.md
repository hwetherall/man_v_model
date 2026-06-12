# CLAUDE.md — Man v Model (MvM)

This file is the build spec and standing context for the MvM frontend. Read it
before writing code. Prefer the simplest thing that works: this is a private,
single-user tool, not a product. Resist gold-plating.

## What this is

MvM is the backend for a daily World Cup 2026 podcast, *Beat the Model*. Three
"players" predict every match of the tournament:

- **Market** — devigged betting odds (the wisdom of crowds)
- **Model** — Nate Silver's PELE model (taken from Substack)
- **Me** — the host, armed with both, trying to beat each of them

This app is the cockpit: it lets the host enter the three predictions per match,
pulls real results to score them, and tracks a running points leaderboard. The
host writes scripts and does deeper analysis elsewhere — **not in this app.**

## Scoring (already decided — do not redesign)

- Correct result (Home / Draw / Away): **+1 point**
- Exact scoreline on top of a correct result: **+2 bonus** (so a perfect call = 3)
- One pick + one scoreline per player per match. **No hedging.**
- **Coherence rule:** the scoreline must agree with the pick. A "Home" pick
  cannot carry a draw scoreline. The DB enforces this; the UI must too, and
  should block save with a clear message rather than relying on the DB error.

A second, silent layer exists: if probabilities are entered, the backend also
computes a Brier score per prediction. This is **never shown in the main UI** —
it's the host's private lab notebook, surfaced only on the Theses screen. Points
are the public game; Brier is the truth check.

## Stack

- **Next.js (App Router) + TypeScript + Tailwind**, deployed on Vercel.
- **Supabase** (Postgres) is already provisioned; the schema below already exists.
- ESPN result fetching **must** run server-side (Next.js Route Handler or
  Supabase Edge Function) — the ESPN endpoint is CORS-blocked in the browser.
- Keep dependencies minimal. Use the Supabase JS client; no ORM, no state library
  beyond React hooks unless something genuinely demands it.
- **Auth:** single user. A single password gate via an env var, or Supabase magic
  link, is plenty. Do not build roles, sign-up, or multi-tenant anything.

## Existing data model (already in Supabase — reference, don't recreate)

Tables: `matches`, `predictions`, `deviations`, `episodes`.
Views: `picks`, `match_points`, `points_leaderboard` (the public scoreboard),
plus `prediction_scores`, `leaderboard`, `deviation_scorecard` (the silent Brier
layer).

Key columns:
- `predictions(match_id, source, market, snapshot, p_home, p_draw, p_away,
  pred_home_goals, pred_away_goals, raw_odds, devig_method)`
  - `source` ∈ `crowd | pele | harry` (UI labels: Market / Model / Me)
  - `snapshot` ∈ `pele_publish | lock | kickoff`. **Scoring uses `lock` only.**
    For v1, every entry the host makes is a `lock` snapshot. The other snapshots
    are reserved for later automation — support storing them, but the UI only
    needs to create `lock` rows.
- `matches(... result_90, home_goals, away_goals, advanced)` — result fields are
  null until settled.
- `deviations(match_id, reason_code, direction, magnitude, note)` —
  `reason_code` ∈ `team_news | lineup | conditions | motivation | market_move |
  tactical | thesis | gut`.

### Two small migrations to run first
1. Add a `thesis_tag text` column to `deviations` so theses are grouped reliably
   by tag (e.g. `'cohesion'`) instead of by parsing the note. Index it.
2. Make `p_home`, `p_draw`, `p_away` **nullable**. Picks + scorelines are the
   required inputs; probabilities are optional (they power the silent Brier
   layer). Keep the sum-to-1 check but only enforce it when all three are present.

## v1 — what to build

### Screen 1: Matches & Picks (the daily driver)
- Add / edit a match: home team, away team, kickoff (datetime), stage, group.
- For each match, three side-by-side prediction cards — **Market, Model, Me** —
  each capturing:
  - Pick: Home / Draw / Away (required)
  - Scoreline: home goals, away goals (required)
  - Probabilities: three optional fields. If filled, validate they sum to ~1 and
    auto-derive/confirm the pick (argmax, ties broken by scoreline).
- Enforce the coherence rule live: changing the pick should constrain the
  allowable scoreline and vice versa; block save on a mismatch.
- **Deviation prompt:** when *Me* differs from *Model* (different pick OR a
  probability gap beyond a small threshold), require a deviation before save:
  reason_code (dropdown), optional thesis_tag (free text or pick-from-existing),
  magnitude (probability points moved vs Model, 0–1), and a note. Save to
  `deviations`. Make this feel like friction the host has to earn — that's intentional.

### Screen 2: Scoreboard
- The running leaderboard from `points_leaderboard`: per player, matches scored,
  correct picks, exact scores, total points. This is the number read aloud daily.
- Per-match breakdown table: each settled match, what each player picked, the
  actual result, and points awarded.
- **"Settle results" action** (see ESPN section). After settling, the views
  recompute automatically — no manual scoring.

### Screen 3: Theses tracker (wanted, build if time allows)
- List named theses (grouped by `thesis_tag`), e.g. "cohesion."
- Per thesis: every match where it was invoked, *Me*'s record on those matches
  vs *Model* (points, and here — and only here — the silent Brier comparison
  from `deviation_scorecard`), and a running verdict (is this thesis earning its
  keep, or is it a just-so story?).
- No charts needed; a clean table is enough.

## ESPN results integration

- Endpoint (no auth): `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard`
  - Optional `?dates=YYYYMMDD` to scope to one day. Default to today.
  - **Server-side only** (CORS). Route handler fetches, parses, writes to Supabase.
- Parse path: `events[] → competitions[0] → competitors[]`. Each competitor has
  `homeAway` (`"home"`/`"away"`), team info, and `score`. Match completion is
  `status.type.completed === true` (or `state === "post"`). Only settle completed
  matches; ignore in-progress.
- **Matching to our rows** is the fragile part — handle it carefully:
  - Match on normalized team names + kickoff date.
  - Maintain a small alias map for name mismatches (e.g. ESPN may use "South
    Korea" vs our "Korea Republic"). Centralize it in one config object so it's
    easy to extend as the tournament throws up edge cases.
  - On first successful match, write ESPN's event id into `matches.external_ref`.
    Thereafter match directly on `external_ref` — names only resolve unmatched rows.
  - Leave anything unmatched untouched and surface it in the UI for manual fixing.
    Never guess a result onto the wrong match.
- Settling writes `home_goals`, `away_goals`, and derives `result_90`. Idempotent:
  re-running on an already-settled match is a no-op overwrite, never double counts
  (scores come from views, not incrementing counters).
- A manual "Settle results" button is the v1 mechanism. A Vercel cron that calls
  the same route during match windows is a fine **later** enhancement — don't
  build it now.

## Non-goals (do not build)

- **No transcript upload/storage.** Scripts live on the host's machine.
- **No analysis or charting features** beyond the plain scoreboard and theses
  tables. Deep analysis happens in the Claude web app, deliberately.
- **No podcasting/audio features.** Editing is done in Adobe Podcast.
- No odds-API integration in v1. The host enters Market numbers by hand. (An
  auto-fill from the-odds-api is a possible later convenience, not now.)

## Conventions

- TypeScript throughout; explicit types on Supabase reads.
- Server-side env vars for Supabase service role and the ESPN route; never expose
  the service role to the client. Browser uses the anon key with RLS.
- Keep the UI dense and fast — this is a tool used daily under time pressure
  before kickoff, not a showcase. Few clicks from "open app" to "picks saved."
- Fail loudly on settle/matching problems; fail quietly nowhere.

## Out of scope for v1 — future ideas (do NOT build yet)

The host runs a second, simpler episode daily **in French** as language practice.
A future "learning mode" could support that. Park these; listed only so the data
model isn't accidentally designed in a way that blocks them later:
- Render the day's picks/results as spoken French sentences to read aloud
  (scorelines, percentages, and dates are exactly the hard-to-say French bits).
- A football/stats French glossary + vocabulary the host has encountered.
- Track which French phrasings have been practiced.
Keep `matches`/`predictions` clean enough that a French presentation layer can sit
on top later without schema changes.
