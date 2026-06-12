import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { MatchRow, Pick } from "@/lib/types";

type EspnCompetitor = {
  homeAway: "home" | "away";
  score: string;
  team?: {
    displayName?: string;
    shortDisplayName?: string;
    name?: string;
    abbreviation?: string;
  };
};

type EspnEvent = {
  id: string;
  name?: string;
  date?: string;
  status?: {
    type?: {
      completed?: boolean;
      state?: string;
      name?: string;
    };
  };
  competitions?: Array<{
    date?: string;
    competitors?: EspnCompetitor[];
  }>;
};

type EspnScoreboard = {
  events?: EspnEvent[];
};

type CompletedEvent = {
  externalRef: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  result: Pick;
};

export type SettleResult = {
  settled: Array<{
    matchId: string;
    externalRef: string;
    match: string;
    score: string;
  }>;
  unmatched: Array<{
    externalRef: string;
    match: string;
    score: string;
    reason: string;
  }>;
};

const TEAM_ALIASES: Record<string, string> = {
  "czech republic": "czechia",
  czechia: "czechia",
  korea: "korea republic",
  "korea republic": "korea republic",
  "south korea": "korea republic",
  "united states": "usa",
  "united states of america": "usa",
  usa: "usa",
};

function normalizeTeamName(name: string) {
  const cleaned = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(men|w)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return TEAM_ALIASES[cleaned] ?? cleaned;
}

function eventDate(event: CompletedEvent) {
  return new Date(event.date).toISOString().slice(0, 10);
}

function matchDate(match: MatchRow) {
  return new Date(match.kickoff_utc).toISOString().slice(0, 10);
}

function isCompleted(event: EspnEvent) {
  const status = event.status?.type;
  return Boolean(
    status?.completed ||
      status?.state === "post" ||
      status?.name === "STATUS_FINAL",
  );
}

function teamName(competitor: EspnCompetitor) {
  return (
    competitor.team?.displayName ??
    competitor.team?.shortDisplayName ??
    competitor.team?.name ??
    competitor.team?.abbreviation ??
    "Unknown"
  );
}

function parseCompletedEvent(event: EspnEvent): CompletedEvent | null {
  if (!isCompleted(event)) return null;

  const competition = event.competitions?.[0];
  const home = competition?.competitors?.find(
    (competitor) => competitor.homeAway === "home",
  );
  const away = competition?.competitors?.find(
    (competitor) => competitor.homeAway === "away",
  );

  if (!home || !away) return null;

  const homeGoals = Number.parseInt(home.score, 10);
  const awayGoals = Number.parseInt(away.score, 10);

  if (Number.isNaN(homeGoals) || Number.isNaN(awayGoals)) return null;

  return {
    externalRef: event.id,
    date: competition?.date ?? event.date ?? new Date().toISOString(),
    homeTeam: teamName(home),
    awayTeam: teamName(away),
    homeGoals,
    awayGoals,
    result: homeGoals > awayGoals ? "home" : awayGoals > homeGoals ? "away" : "draw",
  };
}

function findMatch(event: CompletedEvent, matches: MatchRow[]) {
  const byExternalRef = matches.find(
    (match) => match.external_ref === event.externalRef,
  );
  if (byExternalRef) return byExternalRef;

  const home = normalizeTeamName(event.homeTeam);
  const away = normalizeTeamName(event.awayTeam);
  const candidates = matches.filter(
    (match) =>
      !match.external_ref &&
      normalizeTeamName(match.home_team) === home &&
      normalizeTeamName(match.away_team) === away &&
      matchDate(match) === eventDate(event),
  );

  return candidates.length === 1 ? candidates[0] : null;
}

function espnDateParam(date: string | null) {
  if (date) return date.replaceAll("-", "");
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

export async function settleFromEspn(date: string | null): Promise<SettleResult> {
  const supabase = getSupabaseServerClient();
  const url = new URL(
    "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard",
  );
  url.searchParams.set("dates", espnDateParam(date));

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`ESPN returned ${response.status}.`);
  }

  const scoreboard = (await response.json()) as EspnScoreboard;
  const completedEvents = (scoreboard.events ?? [])
    .map(parseCompletedEvent)
    .filter((event): event is CompletedEvent => event !== null);

  const matchResult = await supabase
    .from("matches")
    .select("*")
    .returns<MatchRow[]>();

  if (matchResult.error) {
    throw new Error(matchResult.error.message);
  }

  const matches = matchResult.data ?? [];
  const result: SettleResult = {
    settled: [],
    unmatched: [],
  };

  for (const event of completedEvents) {
    const match = findMatch(event, matches);
    const score = `${event.homeGoals}-${event.awayGoals}`;
    const label = `${event.homeTeam} v ${event.awayTeam}`;

    if (!match) {
      result.unmatched.push({
        externalRef: event.externalRef,
        match: label,
        score,
        reason: "No exact name/date match.",
      });
      continue;
    }

    const update = await supabase
      .from("matches")
      .update({
        external_ref: event.externalRef,
        home_goals: event.homeGoals,
        away_goals: event.awayGoals,
        result_90: event.result,
      })
      .eq("id", match.id);

    if (update.error) {
      result.unmatched.push({
        externalRef: event.externalRef,
        match: label,
        score,
        reason: update.error.message,
      });
      continue;
    }

    result.settled.push({
      matchId: match.id,
      externalRef: event.externalRef,
      match: `${match.home_team} v ${match.away_team}`,
      score,
    });
  }

  return result;
}
