-- =============================================================
-- BEAT THE MODEL — Day 1 seed (June 11, 2026)
-- Run after beat_the_model_schema.sql
-- =============================================================

-- Add 'thesis' to the deviation taxonomy (pre-registered personal theses,
-- named in the note field so each thesis builds its own track record)
alter table deviations drop constraint deviations_reason_code_check;
alter table deviations add constraint deviations_reason_code_check
  check (reason_code in ('team_news','lineup','conditions','motivation',
                         'market_move','tactical','thesis','gut'));

-- ---------- MATCHES ----------
insert into matches (id, stage, group_name, home_team, away_team, kickoff_utc, venue)
values
  ('00000000-0000-0000-0000-000000000001', 'group', 'A',
   'Mexico', 'South Africa', '2026-06-11 19:00:00+00', 'Estadio Azteca, Mexico City'),
  ('00000000-0000-0000-0000-000000000002', 'group', 'A',
   'Korea Republic', 'Czechia', '2026-06-12 02:00:00+00', 'Estadio Akron, Guadalajara');

-- ---------- PREDICTIONS ----------
-- Crowd @ lock (devigged proportional; overround MEX 2.92%, KOR 3.19%)
insert into predictions (match_id, source, market, snapshot, p_home, p_draw, p_away, raw_odds, devig_method)
values
  ('00000000-0000-0000-0000-000000000001', 'crowd', 'result_90', 'lock',
   0.682, 0.207, 0.112,
   '{"format":"american","home":-235,"draw":370,"away":770,"captured":"2026-06-11 morning"}',
   'proportional'),
  ('00000000-0000-0000-0000-000000000002', 'crowd', 'result_90', 'lock',
   0.359, 0.313, 0.328,
   '{"format":"american","home":170,"draw":210,"away":195,"captured":"2026-06-11 morning"}',
   'proportional');

-- PELE @ lock (from Substack, 6/11)
insert into predictions (match_id, source, market, snapshot, p_home, p_draw, p_away, raw_odds)
values
  ('00000000-0000-0000-0000-000000000001', 'pele', 'result_90', 'lock',
   0.76, 0.19, 0.05,
   '{"gf_home":2.2,"gf_away":0.4,"most_likely_score":"1-0"}'),
  ('00000000-0000-0000-0000-000000000002', 'pele', 'result_90', 'lock',
   0.35, 0.30, 0.35,
   '{"gf_home":1.3,"gf_away":1.3,"most_likely_score":"0-0"}');

-- Harry @ lock
-- Match 1: rides PELE (no deviation). Narrative only: BTTS, RSA scores
--   first, Mexico responds, final 2-1 or 3-1.
-- Match 2: DEVIATION — Korea win on cohesion thesis. 35 -> 44 (+9 pts).
insert into predictions (match_id, source, market, snapshot, p_home, p_draw, p_away)
values
  ('00000000-0000-0000-0000-000000000001', 'harry', 'result_90', 'lock',
   0.76, 0.19, 0.05),
  ('00000000-0000-0000-0000-000000000002', 'harry', 'result_90', 'lock',
   0.44, 0.30, 0.26);

-- ---------- DEVIATIONS ----------
insert into deviations (match_id, market, reason_code, direction, magnitude, note)
values
  ('00000000-0000-0000-0000-000000000002', 'result_90', 'thesis',
   'toward home (Korea)', 0.09,
   'COHESION THESIS (first test): national teams have minimal training time
    together; culturally conformist football nations (e.g. East Asian sides)
    adopt a unified team style faster than individualistic ones, giving an
    edge in EARLY tournament games specifically. Predicted shape: low-scoring,
    1-0 Korea. Watch for further tests across the group stage.');

-- ---------- EPISODE ----------
insert into episodes (episode_date, episode_number, brief)
values ('2026-06-11', 1,
  '{"matches": 2,
    "picks": {"MEX v RSA": "Mexico (ride PELE 76/19/5)",
              "KOR v CZE": "Korea (deviation: 44/30/26 vs PELE 35/30/35)"},
    "story": "manifesto + cohesion thesis",
    "key_tension": "PELE gives RSA 5%, market gives 11% — model vs market on night one"}');

-- ---------- AFTER THE MATCHES: settle results ----------
-- update matches set result_90 = 'home', home_goals = 2, away_goals = 1
--   where id = '00000000-0000-0000-0000-000000000001';
-- update matches set result_90 = 'draw', home_goals = 0, away_goals = 0
--   where id = '00000000-0000-0000-0000-000000000002';
-- Then: select * from leaderboard;