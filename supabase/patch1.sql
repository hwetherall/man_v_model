-- =============================================================
-- BEAT THE MODEL — Patch 1: points layer + scorelines
-- Run after schema + day1 seed.
-- Scoring: correct pick = 1 pt, exact scoreline = +2 bonus.
-- Rule: scoreline must be consistent with the pick (one actor,
-- one story). Brier views remain untouched as the silent layer.
-- =============================================================

-- ---------- SCORELINES ----------
alter table predictions
  add column pred_home_goals int,
  add column pred_away_goals int,
  add constraint scoreline_coherent_with_pick check (
    pred_home_goals is null or pred_away_goals is null or (
      case
        when p_home > p_draw and p_home > p_away then pred_home_goals > pred_away_goals
        when p_away > p_draw and p_away > p_home then pred_away_goals > pred_home_goals
        when p_draw >= p_home and p_draw >= p_away then pred_home_goals = pred_away_goals
        else true  -- home/away tie in array: scoreline itself breaks the tie
      end
    )
  );

-- ---------- PICK DERIVATION ----------
-- Pick = argmax of the array; ties broken by the predicted scoreline.
create view picks as
select
  p.id, p.match_id, p.source, p.market, p.snapshot,
  case
    when p.p_home > p.p_draw and p.p_home > p.p_away then 'home'
    when p.p_away > p.p_draw and p.p_away > p.p_home then 'away'
    when coalesce(p.p_draw,0) >= p.p_home and coalesce(p.p_draw,0) >= p.p_away then 'draw'
    -- home/away tied at the top: scoreline decides
    when p.pred_home_goals > p.pred_away_goals then 'home'
    when p.pred_home_goals < p.pred_away_goals then 'away'
    else 'draw'
  end as pick,
  p.pred_home_goals, p.pred_away_goals
from predictions p
where p.snapshot = 'lock';

-- ---------- POINTS ----------
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

-- The on-air scoreboard
create view points_leaderboard as
select source,
       count(*)            as matches_scored,
       sum(pick_point)     as correct_picks,
       sum(score_bonus)/2  as exact_scores,
       sum(points)         as points
from match_points
group by source
order by points desc;

-- ---------- DAY 1 SCORELINES ----------
-- Crowd: KOR-CZE correct-score favourite consistent with its Korea pick
-- is 1-0 (+700). (1-1 at +460 is the overall modal scoreline — logged
-- below as data, but a draw scoreline can't ride a Korea pick.)
update predictions set pred_home_goals = 1, pred_away_goals = 0,
  raw_odds = raw_odds || '{"correct_score_market":{"modal":"1-1 (+460)","modal_consistent_with_pick":"1-0 (+700)"}}'
  where match_id = '00000000-0000-0000-0000-000000000002'
    and source = 'crowd' and snapshot = 'lock';
-- Crowd MEX-RSA scoreline: fill from the correct-score market when pulled.

-- PELE
update predictions set pred_home_goals = 1, pred_away_goals = 0
  where match_id = '00000000-0000-0000-0000-000000000001'
    and source = 'pele' and snapshot = 'lock';
update predictions set pred_home_goals = 0, pred_away_goals = 0
  where match_id = '00000000-0000-0000-0000-000000000002'
    and source = 'pele' and snapshot = 'lock';

-- Harry
update predictions set pred_home_goals = 3, pred_away_goals = 1
  where match_id = '00000000-0000-0000-0000-000000000001'
    and source = 'harry' and snapshot = 'lock';
update predictions set pred_home_goals = 1, pred_away_goals = 0
  where match_id = '00000000-0000-0000-0000-000000000002'
    and source = 'harry' and snapshot = 'lock';