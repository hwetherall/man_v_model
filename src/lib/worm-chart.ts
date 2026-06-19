import { SOURCES, type MatchPointsRow, type Source } from "@/lib/types";

export type WormStep = {
  matchId: string;
  label: string;
  kickoffUtc: string;
  pointsBySource: Record<Source, number>;
};

export type WormChartData = {
  steps: WormStep[];
  /** cumulative[source][i] = total after i settled matches (index 0 = 0 pts at start) */
  cumulative: Record<Source, number[]>;
};

function kickoffTime(kickoff: string) {
  return new Date(kickoff).getTime();
}

export function buildWormChartData(matchPoints: MatchPointsRow[]): WormChartData {
  const byMatch = new Map<
    string,
    {
      kickoffUtc: string;
      homeTeam: string;
      awayTeam: string;
      points: Record<Source, number>;
    }
  >();

  for (const row of matchPoints) {
    let entry = byMatch.get(row.match_id);
    if (!entry) {
      entry = {
        kickoffUtc: row.kickoff_utc,
        homeTeam: row.home_team,
        awayTeam: row.away_team,
        points: { crowd: 0, pele: 0, harry: 0 },
      };
      byMatch.set(row.match_id, entry);
    }
    entry.points[row.source] = row.points;
  }

  const steps: WormStep[] = [...byMatch.entries()]
    .sort(([, left], [, right]) => kickoffTime(left.kickoffUtc) - kickoffTime(right.kickoffUtc))
    .map(([matchId, entry]) => ({
      matchId,
      kickoffUtc: entry.kickoffUtc,
      label: `${entry.homeTeam} v ${entry.awayTeam}`,
      pointsBySource: entry.points,
    }));

  const cumulative = Object.fromEntries(
    SOURCES.map((source) => [source, [0] as number[]]),
  ) as Record<Source, number[]>;

  for (const step of steps) {
    for (const source of SOURCES) {
      const previous = cumulative[source][cumulative[source].length - 1] ?? 0;
      cumulative[source].push(previous + step.pointsBySource[source]);
    }
  }

  return { steps, cumulative };
}
