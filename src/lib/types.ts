import type { ReactNode } from "react";

export type Source = "crowd" | "pele" | "harry";
export type Pick = "home" | "draw" | "away";
export type Stage = "group" | "r32" | "r16" | "qf" | "sf" | "third" | "final";
export type ReasonCode =
  | "team_news"
  | "lineup"
  | "conditions"
  | "motivation"
  | "market_move"
  | "tactical"
  | "thesis"
  | "gut";

export const SOURCES: Source[] = ["crowd", "pele", "harry"];

export const SOURCE_LABELS: Record<Source, string> = {
  crowd: "Market",
  pele: "Model",
  harry: "Me",
};

export const STAGES: Stage[] = ["group", "r32", "r16", "qf", "sf", "third", "final"];

export const STAGE_LABELS: Record<Stage, string> = {
  group: "Group",
  r32: "Round of 32",
  r16: "Round of 16",
  qf: "Quarterfinal",
  sf: "Semifinal",
  third: "Third place",
  final: "Final",
};

export const REASON_CODES: ReasonCode[] = [
  "team_news",
  "lineup",
  "conditions",
  "motivation",
  "market_move",
  "tactical",
  "thesis",
  "gut",
];

export const REASON_LABELS: Record<ReasonCode, string> = {
  team_news: "Team news",
  lineup: "Lineup",
  conditions: "Conditions",
  motivation: "Motivation",
  market_move: "Market move",
  tactical: "Tactical",
  thesis: "Thesis",
  gut: "Gut",
};

export type MatchRow = {
  id: string;
  external_ref: string | null;
  stage: Stage;
  group_name: string | null;
  home_team: string;
  away_team: string;
  kickoff_utc: string;
  venue: string | null;
  result_90: Pick | null;
  home_goals: number | null;
  away_goals: number | null;
  advanced: "home" | "away" | null;
};

export type PredictionRow = {
  id: string;
  match_id: string;
  source: Source;
  market: "result_90" | "to_advance";
  snapshot: "pele_publish" | "lock" | "kickoff";
  captured_at: string;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  pred_home_goals: number | null;
  pred_away_goals: number | null;
  raw_odds: unknown | null;
  devig_method: string | null;
};

export type DeviationRow = {
  id: string;
  match_id: string;
  market: "result_90" | "to_advance";
  reason_code: ReasonCode;
  direction: string;
  magnitude: number;
  note: string | null;
  thesis_tag?: string | null;
  created_at: string;
};

export type PointsLeaderboardRow = {
  source: Source;
  matches_scored: number;
  correct_picks: number;
  exact_scores: number;
  points: number;
};

export type MatchPointsRow = {
  source: Source;
  match_id: string;
  stage: Stage;
  home_team: string;
  away_team: string;
  kickoff_utc: string;
  pick: Pick;
  result_90: Pick;
  pick_point: number;
  score_bonus: number;
  points: number;
};

export type PredictionScoreRow = {
  id: string;
  match_id: string;
  source: Source;
  market: "result_90" | "to_advance";
  stage: Stage;
  home_team: string;
  away_team: string;
  kickoff_utc: string;
  brier: number | null;
};

export type DashboardData = {
  matches: MatchRow[];
  predictions: PredictionRow[];
  deviations: DeviationRow[];
  pointsLeaderboard: PointsLeaderboardRow[];
  matchPoints: MatchPointsRow[];
  predictionScores: PredictionScoreRow[];
};

export type PredictionInput = {
  pick: Pick;
  pred_home_goals: number;
  pred_away_goals: number;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
};

export type DeviationInput = {
  reason_code: ReasonCode;
  thesis_tag: string | null;
  magnitude: number;
  note: string;
};

export type SaveMatchPayload = {
  match: {
    id: string | null;
    stage: Stage;
    group_name: string | null;
    home_team: string;
    away_team: string;
    kickoff_utc: string;
    venue: string | null;
  };
  predictions: Record<Source, PredictionInput>;
  deviation: DeviationInput | null;
};

export type AppShellProps = {
  initialData: DashboardData;
  authControl?: ReactNode;
};
