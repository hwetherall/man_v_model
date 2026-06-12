-- =============================================================
-- BEAT THE MODEL — World Cup 2026 prediction tracking schema
-- Postgres / Supabase
-- Three competitors: crowd (devigged odds), pele, harry
-- =============================================================

-- ---------- MATCHES ----------
create table matches (
  id              uuid primary key default gen_random_uuid(),
  external_ref    text unique,                  -- FIFA / odds-API match id
  stage           text not null check (stage in
                    ('group','r32','r16','qf','sf','third','final')),
  group_name      text,                          -- 'A'..'L', null in knockouts
  home_team       text not null,
  away_team       text not null,
  kickoff_utc     timestamptz not null,
  venue           text,

  -- outcomes (filled after the match)
  result_90       text check (result_90 in ('home','draw','away')),
  home_goals      int,
  away_goals      int,
  advanced        text check (advanced in ('home','away'))  -- knockouts only
);

-- ---------- PREDICTIONS ----------
-- One row per (match, source, market, snapshot).
-- Probabilities are canonical; raw bookmaker odds kept for audit.
create table predictions (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references matches(id),
  source          text not null check (source in ('crowd','pele','harry')),
  market          text not null default 'result_90'
                    check (market in ('result_90','to_advance')),
  snapshot        text not null default 'lock'
                    check (snapshot in ('pele_publish','lock','kickoff')),
  captured_at     timestamptz not null default now(),

  p_home          numeric not null check (p_home between 0 and 1),
  p_draw          numeric check (p_draw between 0 and 1), -- null for to_advance
  p_away          numeric not null check (p_away between 0 and 1),

  raw_odds        jsonb,        -- pre-devig decimal odds, bookmaker name, etc.
  devig_method    text,         -- 'proportional' | 'power' | null

  unique (match_id, source, market, snapshot),
  check (abs(p_home + coalesce(p_draw,0) + p_away - 1.0) < 0.01)
);

-- Snapshot semantics:
--   pele_publish : crowd odds at the moment PELE's numbers went up
--                  (tests "odds are faster" — did the market already know?)
--   lock         : the prediction you score everyone on. Harry & PELE
--                  always lock here; crowd captured at same moment.
--   kickoff      : crowd only. Measures late market drift after your lock.

-- ---------- DEVIATIONS ----------
-- Logged only when harry's lock differs from pele's lock.
-- This is the labelled dataset: which reasons earn their keep?
create table deviations (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references matches(id),
  market          text not null default 'result_90',
  reason_code     text not null check (reason_code in
                    ('team_news','lineup','conditions','motivation',
                     'market_move','tactical','gut')),
  direction       text not null,   -- e.g. 'toward home', 'toward draw'
  magnitude       numeric not null, -- prob points moved vs PELE (0–1 scale)
  note            text,
  created_at      timestamptz not null default now()
);

-- ---------- EPISODES ----------
create table episodes (
  id              uuid primary key default gen_random_uuid(),
  episode_date    date unique not null,
  episode_number  int unique not null,
  brief           jsonb,            -- structured input to the script
  published       boolean default false,
  audio_url       text,
  notes           text
);

-- ---------- SCORING ----------
-- Brier score per prediction at the 'lock' snapshot.
-- Lower is better. 3-way for result_90, 2-way for to_advance.
create view prediction_scores as
select
  p.id, p.match_id, p.source, p.market,
  m.stage, m.home_team, m.away_team, m.kickoff_utc,
  case
    when p.market = 'result_90' and m.result_90 is not null then
        power(p.p_home - (m.result_90 = 'home')::int, 2)
      + power(p.p_draw - (m.result_90 = 'draw')::int, 2)
      + power(p.p_away - (m.result_90 = 'away')::int, 2)
    when p.market = 'to_advance' and m.advanced is not null then
        power(p.p_home - (m.advanced = 'home')::int, 2)
      + power(p.p_away - (m.advanced = 'away')::int, 2)
  end as brier
from predictions p
join matches m on m.id = p.match_id
where p.snapshot = 'lock';

-- Running leaderboard
create view leaderboard as
select source, market,
       count(*) filter (where brier is not null) as scored_matches,
       round(avg(brier)::numeric, 4) as avg_brier
from prediction_scores
group by source, market
order by market, avg_brier;

-- Deviation report card: on matches where Harry deviated,
-- did he beat PELE?
create view deviation_scorecard as
select
  d.reason_code,
  count(distinct d.match_id) as n_matches,
  round(avg(h.brier)::numeric, 4) as harry_avg_brier,
  round(avg(pl.brier)::numeric, 4) as pele_avg_brier,
  round((avg(pl.brier) - avg(h.brier))::numeric, 4) as harry_edge
from deviations d
join prediction_scores h
  on h.match_id = d.match_id and h.source = 'harry'  and h.market = d.market
join prediction_scores pl
  on pl.match_id = d.match_id and pl.source = 'pele' and pl.market = d.market
group by d.reason_code
order by harry_edge desc;