import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ChampionPickRow,
  ChampionResultRow,
  DashboardData,
  MatchPointsRow,
  MatchRow,
  PointsLeaderboardRow,
  PredictionRow,
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

function isMissingRelation(error: { message: string } | null) {
  return Boolean(
    error?.message.match(/relation .* does not exist/i) ||
      error?.message.match(/could not find the table/i),
  );
}

function optionalResult<T>(label: string, result: SupabaseResult<T>): T[] {
  if (isMissingRelation(result.error)) return [];
  return assertResult(label, result);
}

export async function getDashboardData(): Promise<DashboardData> {
  const supabase = getSupabaseServerClient();

  const [
    matches,
    predictions,
    championPicks,
    championResult,
    pointsLeaderboard,
    matchPoints,
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
      .from("champion_picks")
      .select("*")
      .order("source", { ascending: true })
      .order("rank", { ascending: true })
      .returns<ChampionPickRow[]>(),
    supabase
      .from("champion_result")
      .select("*")
      .maybeSingle<ChampionResultRow>(),
    supabase
      .from("points_leaderboard")
      .select("*")
      .returns<PointsLeaderboardRow[]>(),
    supabase
      .from("match_points")
      .select("*")
      .order("kickoff_utc", { ascending: false })
      .returns<MatchPointsRow[]>(),
  ]);

  return {
    matches: assertResult("matches", matches),
    predictions: assertResult("predictions", predictions),
    championPicks: optionalResult("champion_picks", championPicks),
    championResult: isMissingRelation(championResult.error)
      ? null
      : championResult.error
      ? (() => {
          throw new Error(`champion_result: ${championResult.error.message}`);
        })()
      : (championResult.data ?? null),
    pointsLeaderboard: assertResult("points_leaderboard", pointsLeaderboard),
    matchPoints: assertResult("match_points", matchPoints),
  };
}
