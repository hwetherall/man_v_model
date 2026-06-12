import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  DashboardData,
  DeviationRow,
  MatchPointsRow,
  MatchRow,
  PointsLeaderboardRow,
  PredictionRow,
  PredictionScoreRow,
} from "@/lib/types";

type SupabaseResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

function assertResult<T>(label: string, result: SupabaseResult<T>): T[] {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }

  return result.data ?? [];
}

export async function getDashboardData(): Promise<DashboardData> {
  const supabase = getSupabaseServerClient();

  const [
    matches,
    predictions,
    deviations,
    pointsLeaderboard,
    matchPoints,
    predictionScores,
  ] = await Promise.all([
    supabase
      .from("matches")
      .select("*")
      .order("kickoff_utc", { ascending: true })
      .returns<MatchRow[]>(),
    supabase
      .from("predictions")
      .select("*")
      .eq("snapshot", "lock")
      .returns<PredictionRow[]>(),
    supabase
      .from("deviations")
      .select("*")
      .order("created_at", { ascending: false })
      .returns<DeviationRow[]>(),
    supabase
      .from("points_leaderboard")
      .select("*")
      .returns<PointsLeaderboardRow[]>(),
    supabase
      .from("match_points")
      .select("*")
      .order("kickoff_utc", { ascending: false })
      .returns<MatchPointsRow[]>(),
    supabase
      .from("prediction_scores")
      .select("*")
      .returns<PredictionScoreRow[]>(),
  ]);

  return {
    matches: assertResult("matches", matches),
    predictions: assertResult("predictions", predictions),
    deviations: assertResult("deviations", deviations),
    pointsLeaderboard: assertResult("points_leaderboard", pointsLeaderboard),
    matchPoints: assertResult("match_points", matchPoints),
    predictionScores: assertResult("prediction_scores", predictionScores),
  };
}
