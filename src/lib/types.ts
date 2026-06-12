import type { ReactNode } from "react";

export type Source = "crowd" | "pele" | "harry";
export type Pick = "home" | "draw" | "away";
export type Stage = "group" | "r32" | "r16" | "qf" | "sf" | "third" | "final";

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

export type ChampionPickRow = {
  id: string;
  source: Source;
  rank: number;
  team_name: string;
  created_at: string;
  updated_at: string;
};

export type ChampionResultRow = {
  id: boolean;
  winner_team: string | null;
  settled_at: string | null;
  updated_at: string;
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

export type DashboardData = {
  matches: MatchRow[];
  predictions: PredictionRow[];
  championPicks: ChampionPickRow[];
  championResult: ChampionResultRow | null;
  pointsLeaderboard: PointsLeaderboardRow[];
  matchPoints: MatchPointsRow[];
};

export type PredictionInput = {
  pick: Pick;
  pred_home_goals: number;
  pred_away_goals: number;
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
};

export type SaveChampionPayload = {
  picks: Record<Source, string[]>;
  winner_team: string | null;
};

export type AppShellProps = {
  initialData: DashboardData;
  authControl?: ReactNode;
};
