import type { DashboardData, MatchRow, PointsLeaderboardRow, Source, Stage } from "./types";
import { STAGES } from "./types";

export type RivalDrift = {
  rival: Source;
  /** me.points - rival.points (positive = I'm ahead, negative = I'm behind) */
  gap: number;
  matchesRemainingInStage: number;
  /** null if matchesRemainingInStage === 0 */
  requiredPpmThisStage: number | null;
  matchesRemainingTotal: number;
  /** null if matchesRemainingTotal === 0 */
  requiredPpmTotal: number | null;
};

export type DriftSummary = {
  /** null once every match is settled */
  currentStage: Stage | null;
  /** one entry each for crowd and pele, vs "harry" */
  rivals: RivalDrift[];
};

/**
 * Max points per match: 1 (correct result) + 2 (exact scoreline bonus) = 3.
 * Thresholds below are calibrated against this ceiling so the colour coding
 * isn't arbitrary.
 *   amber : need ≤ 10 % of ceiling per match (mild edge)
 *   red   : need > 33 % of ceiling per match (hard — requires consistent
 *           performance divergence)
 */
export const MAX_PTS_PER_MATCH = 3;
export const DRIFT_AMBER_THRESHOLD = MAX_PTS_PER_MATCH / 10; // 0.3
export const DRIFT_RED_THRESHOLD = MAX_PTS_PER_MATCH / 3; // 1.0

function isUnsettled(match: MatchRow) {
  return match.home_goals === null;
}

export function buildDriftSummary(
  data: Pick<DashboardData, "matches" | "pointsLeaderboard">,
  me: Source = "harry",
): DriftSummary {
  // 1. Build points map
  const points: Record<Source, number> = { crowd: 0, pele: 0, harry: 0 };
  for (const row of data.pointsLeaderboard) {
    points[row.source] = row.points;
  }

  // 2. Find currentStage: first stage with at least one unsettled match
  let currentStage: Stage | null = null;
  for (const stage of STAGES) {
    if (data.matches.some((match) => match.stage === stage && isUnsettled(match))) {
      currentStage = stage;
      break;
    }
  }

  // 3. Matches remaining in current stage
  const matchesRemainingInStage =
    currentStage === null
      ? 0
      : data.matches.filter(
          (match) => match.stage === currentStage && isUnsettled(match),
        ).length;

  // 4. Matches remaining across all stages
  const matchesRemainingTotal = data.matches.filter(isUnsettled).length;

  // 5. Per-rival calculations
  const rivals: RivalDrift[] = (["crowd", "pele"] as Source[]).map((rival) => {
    const gap = points[me] - points[rival];
    const requiredPpmThisStage =
      matchesRemainingInStage > 0
        ? (points[rival] - points[me]) / matchesRemainingInStage
        : null;
    const requiredPpmTotal =
      matchesRemainingTotal > 0
        ? (points[rival] - points[me]) / matchesRemainingTotal
        : null;

    return { rival, gap, matchesRemainingInStage, requiredPpmThisStage, matchesRemainingTotal, requiredPpmTotal };
  });

  return { currentStage, rivals };
}
