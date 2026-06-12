import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { MatchRow, Pick, Stage } from "@/lib/types";

type EspnCompetitor = {
  homeAway: "home" | "away";
  score?: string;
  advance?: boolean;
  winner?: boolean;
  team?: {
    displayName?: string;
    shortDisplayName?: string;
    name?: string;
    abbreviation?: string;
  };
};

type EspnStatus = {
  type?: {
    completed?: boolean;
    state?: string;
    name?: string;
  };
};

type EspnEvent = {
  id: string;
  name?: string;
  date?: string;
  season?: {
    slug?: string;
  };
  status?: EspnStatus;
  competitions?: Array<{
    date?: string;
    startDate?: string;
    status?: EspnStatus;
    altGameNote?: string;
    venue?: {
      fullName?: string;
      address?: {
        city?: string;
        country?: string;
      };
    };
    competitors?: EspnCompetitor[];
  }>;
};

type EspnScoreboard = {
  events?: EspnEvent[];
};

type ParsedEvent = {
  externalRef: string;
  kickoffUtc: string;
  stage: Stage;
  groupName: string | null;
  homeTeam: string;
  awayTeam: string;
  venue: string | null;
  completed: boolean;
  homeGoals: number | null;
  awayGoals: number | null;
  result: Pick | null;
  advanced: "home" | "away" | null;
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

export type SyncMatchesResult = {
  fetched: number;
  created: number;
  updated: number;
  settled: number;
  errors: Array<{
    externalRef: string;
    match: string;
    reason: string;
  }>;
};

const SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

const TEAM_ALIASES: Record<string, string> = {
  "czech republic": "czechia",
  czechia: "czechia",
  korea: "korea republic",
  "korea republic": "korea republic",
  "south korea": "korea republic",
  "united states": "united states",
  "united states of america": "united states",
  usa: "united states",
};

const TEAM_DISPLAY_ALIASES: Record<string, string> = {
  "korea republic": "Korea Republic",
  "south korea": "Korea Republic",
  usa: "United States",
};

const STAGE_BY_SLUG: Record<string, Stage> = {
  "group-stage": "group",
  "round-of-32": "r32",
  "round-of-16": "r16",
  quarterfinals: "qf",
  semifinals: "sf",
  "3rd-place-match": "third",
  final: "final",
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

function canonicalTeamName(name: string) {
  const normalized = normalizeTeamName(name);
  return TEAM_DISPLAY_ALIASES[normalized] ?? name;
}

function matchDate(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function isCompleted(event: EspnEvent) {
  const status = event.competitions?.[0]?.status?.type ?? event.status?.type;
  return Boolean(
    status?.completed ||
      status?.state === "post" ||
      status?.name === "STATUS_FINAL" ||
      status?.name === "STATUS_FULL_TIME",
  );
}

function teamName(competitor: EspnCompetitor) {
  const raw =
    competitor.team?.displayName ??
    competitor.team?.shortDisplayName ??
    competitor.team?.name ??
    competitor.team?.abbreviation ??
    "Unknown";

  return canonicalTeamName(raw);
}

function parseScore(value: string | undefined) {
  if (value === undefined || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function resultFromGoals(homeGoals: number, awayGoals: number): Pick {
  if (homeGoals > awayGoals) return "home";
  if (awayGoals > homeGoals) return "away";
  return "draw";
}

function stageFromSlug(slug: string | undefined): Stage {
  return STAGE_BY_SLUG[slug ?? ""] ?? "group";
}

function groupFromNote(note: string | undefined) {
  return note?.match(/Group ([A-L])/i)?.[1]?.toUpperCase() ?? null;
}

function venueName(event: EspnEvent) {
  const venue = event.competitions?.[0]?.venue;
  if (!venue?.fullName) return null;

  const city = venue.address?.city;
  return city ? `${venue.fullName}, ${city}` : venue.fullName;
}

function parseEvent(event: EspnEvent): ParsedEvent | null {
  const competition = event.competitions?.[0];
  const home = competition?.competitors?.find(
    (competitor) => competitor.homeAway === "home",
  );
  const away = competition?.competitors?.find(
    (competitor) => competitor.homeAway === "away",
  );

  if (!competition || !home || !away) return null;

  const completed = isCompleted(event);
  const homeGoals = completed ? parseScore(home.score) : null;
  const awayGoals = completed ? parseScore(away.score) : null;
  const hasResult = homeGoals !== null && awayGoals !== null;
  const advanced =
    completed && home.advance
      ? "home"
      : completed && away.advance
        ? "away"
        : null;

  return {
    externalRef: event.id,
    kickoffUtc: competition.startDate ?? competition.date ?? event.date ?? "",
    stage: stageFromSlug(event.season?.slug),
    groupName: groupFromNote(competition.altGameNote),
    homeTeam: teamName(home),
    awayTeam: teamName(away),
    venue: venueName(event),
    completed,
    homeGoals,
    awayGoals,
    result: hasResult ? resultFromGoals(homeGoals, awayGoals) : null,
    advanced,
  };
}

function findExistingMatch(event: ParsedEvent, matches: MatchRow[]) {
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
      matchDate(match.kickoff_utc) === matchDate(event.kickoffUtc),
  );

  return candidates.length === 1 ? candidates[0] : null;
}

function espnDateParam(date: string | null) {
  if (date) return date.replaceAll("-", "");
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

async function fetchScoreboard(dates: string) {
  const url = new URL(SCOREBOARD_URL);
  url.searchParams.set("dates", dates);
  url.searchParams.set("limit", "200");

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`ESPN returned ${response.status}.`);
  }

  return (await response.json()) as EspnScoreboard;
}

function matchFields(event: ParsedEvent) {
  return {
    external_ref: event.externalRef,
    stage: event.stage,
    group_name: event.groupName,
    home_team: event.homeTeam,
    away_team: event.awayTeam,
    kickoff_utc: new Date(event.kickoffUtc).toISOString(),
    venue: event.venue,
    result_90: event.result,
    home_goals: event.homeGoals,
    away_goals: event.awayGoals,
    advanced: event.advanced,
  };
}

export async function syncWorldCupMatchesFromEspn(
  dates = "2026",
): Promise<SyncMatchesResult> {
  const supabase = getSupabaseServerClient();
  const scoreboard = await fetchScoreboard(dates);
  const parsedEvents = (scoreboard.events ?? [])
    .map(parseEvent)
    .filter((event): event is ParsedEvent => event !== null);

  const matchResult = await supabase
    .from("matches")
    .select("*")
    .returns<MatchRow[]>();

  if (matchResult.error) {
    throw new Error(matchResult.error.message);
  }

  const matches = [...(matchResult.data ?? [])];
  const result: SyncMatchesResult = {
    fetched: parsedEvents.length,
    created: 0,
    updated: 0,
    settled: 0,
    errors: [],
  };

  for (const event of parsedEvents) {
    try {
      const existing = findExistingMatch(event, matches);
      const fields = matchFields(event);
      const label = `${event.homeTeam} v ${event.awayTeam}`;

      if (existing) {
        const update = await supabase
          .from("matches")
          .update(fields)
          .eq("id", existing.id)
          .select("*")
          .single<MatchRow>();

        if (update.error || !update.data) {
          throw new Error(update.error?.message ?? "Update returned no row.");
        }

        const wasUnsettled = existing.result_90 === null && event.result !== null;
        if (wasUnsettled) result.settled += 1;
        result.updated += 1;
        matches.splice(matches.indexOf(existing), 1, update.data);
        continue;
      }

      const insert = await supabase
        .from("matches")
        .insert(fields)
        .select("*")
        .single<MatchRow>();

      if (insert.error || !insert.data) {
        throw new Error(insert.error?.message ?? "Insert returned no row.");
      }

      result.created += 1;
      if (event.result !== null) result.settled += 1;
      matches.push(insert.data);
    } catch (error) {
      result.errors.push({
        externalRef: event.externalRef,
        match: `${event.homeTeam} v ${event.awayTeam}`,
        reason: error instanceof Error ? error.message : "Unknown import error.",
      });
    }
  }

  return result;
}

export async function settleFromEspn(date: string | null): Promise<SettleResult> {
  const supabase = getSupabaseServerClient();
  const scoreboard = await fetchScoreboard(espnDateParam(date));
  const parsedEvents = (scoreboard.events ?? [])
    .map(parseEvent)
    .filter((event): event is ParsedEvent => event !== null && event.result !== null);

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

  for (const event of parsedEvents) {
    const match = findExistingMatch(event, matches);
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
      .update(matchFields(event))
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
