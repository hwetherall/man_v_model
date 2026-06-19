import type { MatchRow } from "@/lib/types";

function startOfYesterdayUtc(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1);
}

export function isEarlierMatch(match: MatchRow, now = new Date()): boolean {
  if (match.result_90 === null) return false;
  return new Date(match.kickoff_utc).getTime() < startOfYesterdayUtc(now);
}

function kickoffTime(match: MatchRow): number {
  return new Date(match.kickoff_utc).getTime();
}

export function sortPrimaryMatches(matches: MatchRow[]): MatchRow[] {
  return [...matches].sort((left, right) => {
    const leftUnsettled = left.result_90 === null ? 0 : 1;
    const rightUnsettled = right.result_90 === null ? 0 : 1;
    if (leftUnsettled !== rightUnsettled) return leftUnsettled - rightUnsettled;

    if (left.result_90 === null) {
      return kickoffTime(left) - kickoffTime(right);
    }

    return kickoffTime(right) - kickoffTime(left);
  });
}

export function sortEarlierMatches(matches: MatchRow[]): MatchRow[] {
  return [...matches].sort((left, right) => kickoffTime(right) - kickoffTime(left));
}

export function partitionMatchesForSidebar(
  matches: MatchRow[],
  now = new Date(),
): { primary: MatchRow[]; earlier: MatchRow[] } {
  const primary: MatchRow[] = [];
  const earlier: MatchRow[] = [];

  for (const match of matches) {
    if (isEarlierMatch(match, now)) {
      earlier.push(match);
    } else {
      primary.push(match);
    }
  }

  return {
    primary: sortPrimaryMatches(primary),
    earlier: sortEarlierMatches(earlier),
  };
}

export function defaultSidebarMatchId(
  matches: MatchRow[],
  now = new Date(),
): string | null {
  const { primary, earlier } = partitionMatchesForSidebar(matches, now);
  const unsettled = primary.find((match) => match.result_90 === null);
  if (unsettled) return unsettled.id;
  if (primary[0]) return primary[0].id;
  if (earlier[0]) return earlier[0].id;
  return null;
}
