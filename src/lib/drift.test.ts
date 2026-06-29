import { describe, expect, it } from "vitest";
import { buildDriftSummary } from "./drift";
import type { MatchRow, PointsLeaderboardRow } from "./types";

function makeMatch(
  id: string,
  stage: MatchRow["stage"],
  homeGoals: number | null = null,
): MatchRow {
  return {
    id,
    external_ref: null,
    stage,
    group_name: null,
    home_team: "A",
    away_team: "B",
    kickoff_utc: "2026-06-01T18:00:00Z",
    venue: null,
    result_90: homeGoals !== null ? "home" : null,
    home_goals: homeGoals,
    away_goals: homeGoals !== null ? 0 : null,
    advanced: null,
  };
}

function makePoints(source: PointsLeaderboardRow["source"], points: number): PointsLeaderboardRow {
  return { source, matches_scored: points, correct_picks: 0, exact_scores: 0, points };
}

describe("buildDriftSummary", () => {
  it("(a) mid-stage: reports correct gap and required rates with harry behind", () => {
    // Group stage: 2 settled, 4 unsettled. harry=10, crowd=13, pele=12.
    const matches: MatchRow[] = [
      makeMatch("g1", "group", 1),
      makeMatch("g2", "group", 1),
      makeMatch("g3", "group"),
      makeMatch("g4", "group"),
      makeMatch("g5", "group"),
      makeMatch("g6", "group"),
    ];
    const pointsLeaderboard: PointsLeaderboardRow[] = [
      makePoints("harry", 10),
      makePoints("crowd", 13),
      makePoints("pele", 12),
    ];

    const summary = buildDriftSummary({ matches, pointsLeaderboard });

    expect(summary.currentStage).toBe("group");

    const vsCrowd = summary.rivals.find((r) => r.rival === "crowd")!;
    expect(vsCrowd.gap).toBe(-3); // 10 - 13
    expect(vsCrowd.matchesRemainingInStage).toBe(4);
    expect(vsCrowd.matchesRemainingTotal).toBe(4);
    // requiredPpm = (13 - 10) / 4 = 0.75
    expect(vsCrowd.requiredPpmThisStage).toBeCloseTo(0.75);
    expect(vsCrowd.requiredPpmTotal).toBeCloseTo(0.75);

    const vsPele = summary.rivals.find((r) => r.rival === "pele")!;
    expect(vsPele.gap).toBe(-2); // 10 - 12
    // requiredPpm = (12 - 10) / 4 = 0.5
    expect(vsPele.requiredPpmThisStage).toBeCloseTo(0.5);
  });

  it("(b) stage boundary: currentStage advances when prior stage is fully settled", () => {
    // All group matches settled; r32 has 2 unsettled matches.
    const matches: MatchRow[] = [
      makeMatch("g1", "group", 1),
      makeMatch("g2", "group", 2),
      makeMatch("r1", "r32"),
      makeMatch("r2", "r32"),
    ];
    const pointsLeaderboard: PointsLeaderboardRow[] = [
      makePoints("harry", 5),
      makePoints("crowd", 5),
      makePoints("pele", 8),
    ];

    const summary = buildDriftSummary({ matches, pointsLeaderboard });

    // currentStage should be r32, not group
    expect(summary.currentStage).toBe("r32");

    const vsCrowd = summary.rivals.find((r) => r.rival === "crowd")!;
    expect(vsCrowd.gap).toBe(0); // tied
    expect(vsCrowd.matchesRemainingInStage).toBe(2);
    // requiredPpm = (5 - 5) / 2 = 0 (just stay level)
    expect(vsCrowd.requiredPpmThisStage).toBeCloseTo(0);

    const vsPele = summary.rivals.find((r) => r.rival === "pele")!;
    expect(vsPele.gap).toBe(-3); // 5 - 8
    expect(vsPele.matchesRemainingInStage).toBe(2);
    // requiredPpm = (8 - 5) / 2 = 1.5
    expect(vsPele.requiredPpmThisStage).toBeCloseTo(1.5);
  });

  it("(c) tournament fully settled: currentStage is null, rates are null, no divide-by-zero", () => {
    const matches: MatchRow[] = [
      makeMatch("g1", "group", 1),
      makeMatch("f1", "final", 2),
    ];
    const pointsLeaderboard: PointsLeaderboardRow[] = [
      makePoints("harry", 20),
      makePoints("crowd", 18),
      makePoints("pele", 22),
    ];

    const summary = buildDriftSummary({ matches, pointsLeaderboard });

    expect(summary.currentStage).toBeNull();

    for (const rival of summary.rivals) {
      expect(rival.matchesRemainingInStage).toBe(0);
      expect(rival.matchesRemainingTotal).toBe(0);
      expect(rival.requiredPpmThisStage).toBeNull();
      expect(rival.requiredPpmTotal).toBeNull();
    }

    const vsCrowd = summary.rivals.find((r) => r.rival === "crowd")!;
    expect(vsCrowd.gap).toBe(2); // 20 - 18, harry wins
  });
});
