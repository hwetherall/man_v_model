-- =============================================================
-- BEAT THE MODEL — Patch 2: optional probabilities + thesis tags
-- Run after patch1.sql.
-- Picks + scorelines are the required v1 inputs. Probabilities are optional
-- and power only the private Brier layer when all three are present.
-- =============================================================

-- ---------- THESES ----------
alter table deviations drop constraint if exists deviations_reason_code_check;

alter table deviations add constraint deviations_reason_code_check
  check (reason_code in ('team_news','lineup','conditions','motivation',
                         'market_move','tactical','thesis','gut'));

alter table deviations
  add column if not exists thesis_tag text;

create index if not exists deviations_thesis_tag_idx
  on deviations (thesis_tag)
  where thesis_tag is not null;

-- Backfill the day-one thesis if the original seed text is present.
update deviations
set thesis_tag = 'cohesion'
where thesis_tag is null
  and note ilike '%cohesion thesis%';

-- ---------- OPTIONAL PROBABILITIES ----------
alter table predictions
  drop constraint if exists predictions_p_home_check,
  drop constraint if exists predictions_p_draw_check,
  drop constraint if exists predictions_p_away_check,
  drop constraint if exists predictions_check,
  drop constraint if exists scoreline_coherent_with_pick;

alter table predictions
  alter column p_home drop not null,
  alter column p_away drop not null;

alter table predictions
  add constraint predictions_p_home_check
    check (p_home is null or p_home between 0 and 1),
  add constraint predictions_p_draw_check
    check (p_draw is null or p_draw between 0 and 1),
  add constraint predictions_p_away_check
    check (p_away is null or p_away between 0 and 1),
  add constraint predictions_probability_shape_check
    check (
      (p_home is null and p_draw is null and p_away is null)
      or
      (p_home is not null and p_draw is not null and p_away is not null
       and abs(p_home + p_draw + p_away - 1.0) < 0.01)
    ),
  add constraint scoreline_coherent_with_probabilities
    check (
      pred_home_goals is null
      or pred_away_goals is null
      or p_home is null
      or p_draw is null
      or p_away is null
      or (
        case
          when p_home > p_draw and p_home > p_away then pred_home_goals > pred_away_goals
          when p_away > p_draw and p_away > p_home then pred_away_goals > pred_home_goals
          when p_draw > p_home and p_draw > p_away then pred_home_goals = pred_away_goals
          else true
        end
      )
    );

-- ---------- VIEW REFRESH ----------
drop view if exists points_leaderboard;
drop view if exists deviation_scorecard;
drop view if exists leaderboard;
drop view if exists match_points;
drop view if exists prediction_scores;
drop view if exists picks;

create view picks as
select
  p.id, p.match_id, p.source, p.market, p.snapshot,
  case
    when p.p_home is not null and p.p_draw is not null and p.p_away is not null
      and p.p_home > p.p_draw and p.p_home > p.p_away then 'home'
    when p.p_home is not null and p.p_draw is not null and p.p_away is not null
      and p.p_away > p.p_draw and p.p_away > p.p_home then 'away'
    when p.p_home is not null and p.p_draw is not null and p.p_away is not null
      and p.p_draw > p.p_home and p.p_draw > p.p_away then 'draw'
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
where m.result_90 is not null;

create view points_leaderboard as
select source,
       count(*)            as matches_scored,
       sum(pick_point)     as correct_picks,
       sum(score_bonus)/2  as exact_scores,
       sum(points)         as points
from match_points
group by source
order by points desc;

create view prediction_scores as
select
  p.id, p.match_id, p.source, p.market,
  m.stage, m.home_team, m.away_team, m.kickoff_utc,
  case
    when p.p_home is null or p.p_draw is null or p.p_away is null then null
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

create view leaderboard as
select source, market,
       count(*) filter (where brier is not null) as scored_matches,
       round(avg(brier)::numeric, 4) as avg_brier
from prediction_scores
group by source, market
order by market, avg_brier;

create view deviation_scorecard as
select
  coalesce(d.thesis_tag, d.reason_code) as thesis_tag,
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
group by coalesce(d.thesis_tag, d.reason_code), d.reason_code
order by harry_edge desc nulls last;
