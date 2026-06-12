-- =============================================================
-- BEAT THE MODEL — Patch 3: score-only picks + Champion bonus
-- Run after patch2.sql.
-- =============================================================

-- ---------- REMOVE PRIVATE BRIER LAYER ----------
drop view if exists overall_leaderboard;
drop view if exists champion_points;
drop view if exists points_leaderboard;
drop view if exists deviation_scorecard;
drop view if exists leaderboard;
drop view if exists match_points;
drop view if exists prediction_scores;
drop view if exists picks;

-- ---------- SCORE-ONLY PICK DERIVATION ----------
create view picks as
select
  p.id, p.match_id, p.source, p.market, p.snapshot,
  case
    when p.pred_home_goals is null or p.pred_away_goals is null then null
    when p.pred_home_goals > p.pred_away_goals then 'home'
    when p.pred_home_goals < p.pred_away_goals then 'away'
    else 'draw'
  end as pick,
  p.pred_home_goals, p.pred_away_goals
from predictions p
where p.snapshot = 'lock';

create view match_points as
select
  k.source, k.match_id, m.stage,
  m.home_team, m.away_team, m.kickoff_utc,
  k.pick, m.result_90,
  (k.pick = m.result_90)::int as pick_point,
  case when k.pred_home_goals = m.home_goals
        and k.pred_away_goals = m.away_goals
       then 2 else 0 end as score_bonus,
  (k.pick = m.result_90)::int
    + case when k.pred_home_goals = m.home_goals
            and k.pred_away_goals = m.away_goals
           then 2 else 0 end as points
from picks k
join matches m on m.id = k.match_id
where m.result_90 is not null
  and k.pick is not null;

create view points_leaderboard as
select source,
       count(*)            as matches_scored,
       sum(pick_point)     as correct_picks,
       sum(score_bonus)/2  as exact_scores,
       sum(points)         as points
from match_points
group by source
order by points desc;

-- ---------- CHAMPION BONUS ----------
create table if not exists champion_picks (
  id          uuid primary key default gen_random_uuid(),
  source      text not null check (source in ('crowd','pele','harry')),
  rank        int not null check (rank between 1 and 10),
  team_name   text not null check (length(trim(team_name)) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (source, rank),
  unique (source, team_name)
);

create table if not exists champion_result (
  id           boolean primary key default true check (id),
  winner_team  text,
  settled_at   timestamptz,
  updated_at   timestamptz not null default now()
);

create or replace function champion_rank_points(p_rank int)
returns int
language sql
immutable
as $$
  select case
    when p_rank = 1 then 10
    when p_rank between 2 and 10 then greatest(0, 10 - p_rank)
    else 0
  end;
$$;

create view champion_points as
select
  cp.source,
  cp.rank,
  cp.team_name,
  cr.winner_team,
  champion_rank_points(cp.rank) as points
from champion_picks cp
join champion_result cr on cr.id = true
where cr.winner_team is not null
  and lower(cp.team_name) = lower(cr.winner_team);

create view overall_leaderboard as
select
  s.source,
  coalesce(pl.matches_scored, 0) as matches_scored,
  coalesce(pl.correct_picks, 0) as correct_picks,
  coalesce(pl.exact_scores, 0) as exact_scores,
  coalesce(pl.points, 0) as match_points,
  coalesce(cp.points, 0) as champion_bonus,
  coalesce(pl.points, 0) + coalesce(cp.points, 0) as total_points
from (values ('crowd'), ('pele'), ('harry')) as s(source)
left join points_leaderboard pl on pl.source = s.source
left join champion_points cp on cp.source = s.source
order by total_points desc;
