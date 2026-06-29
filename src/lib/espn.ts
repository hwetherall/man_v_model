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

type EspnLinescore = {
  displayValue?: string;
};

type EspnSummary = {
  header?: {
    competitions?: Array<{
      competitors?: Array<{
        homeAway: "home" | "away";
        linescores?: EspnLinescore[];
      }>;
    }>;
  };
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
  /** True when the match went beyond 90 minutes (ET or penalties). */
  wentToET: boolean;
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

// ESPN status names that indicate a match is fully finished.
// STATUS_FINAL_PEN  = ended via penalty shootout (score is post-ET, not 90-min)
// STATUS_FINAL_AET  = ended in extra time (score is post-ET, not 90-min)
const COMPLETED_STATUSES = new Set([
  "STATUS_FULL_TIME",
  "STATUS_FINAL",
  "STATUS_FINAL_PEN",
  "STATUS_FINAL_AET",
  "STATUS_FINAL_ET",
]);

// Statuses where competitor.score reflects extra-time goals, not just 90-min.
// For these we must fetch the summary endpoint to get regulation-only scores.
const EXTRA_TIME_STATUSES = new Set([
  "STATUS_FINAL_PEN",
  "STATUS_FINAL_AET",
  "STATUS_FINAL_ET",
]);

function isCompleted(event: EspnEvent) {
  const status = event.competitions?.[0]?.status?.type ?? event.status?.type;
  return Boolean(
    status?.completed ||
      status?.state === "post" ||
      (status?.name && COMPLETED_STATUSES.has(status.name)),
  );
}

function wentToExtraTime(event: EspnEvent): boolean {
  const status = event.competitions?.[0]?.status?.type ?? event.status?.type;
  return Boolean(status?.name && EXTRA_TIME_STATUSES.has(status.name));
}

const SUMMARY_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary";

/**
 * Fetches the ESPN event summary and extracts the regulation (90-min) score
 * by summing periods 1 and 2 from linescores.
 * Returns null if the data is unavailable or incomplete.
 */
async function fetchRegulationScore(
  eventId: string,
): Promise<{ homeGoals: number; awayGoals: number } | null> {
  try {
    const url = new URL(SUMMARY_BASE);
    url.searchParams.set("event", eventId);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;

    const data = (await response.json()) as EspnSummary;
    const comp = data?.header?.competitions?.[0];
    if (!comp) return null;

    const home = comp.competitors?.find((c) => c.homeAway === "home");
    const away = comp.competitors?.find((c) => c.homeAway === "away");
    const homeLS = home?.linescores ?? [];
    const awayLS = away?.linescores ?? [];

    // Need at least 2 periods (first half + second half).
    if (homeLS.length < 2 || awayLS.length < 2) return null;

    const parsePeriod = (ls: EspnLinescore) =>
      parseInt(ls.displayValue ?? "0", 10) || 0;

    return {
      homeGoals: parsePeriod(homeLS[0]) + parsePeriod(homeLS[1]),
      awayGoals: parsePeriod(awayLS[0]) + parsePeriod(awayLS[1]),
    };
  } catch {
    return null;
  }
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

async function parseEvent(event: EspnEvent): Promise<ParsedEvent | null> {
  const competition = event.competitions?.[0];
  const home = competition?.competitors?.find(
    (competitor) => competitor.homeAway === "home",
  );
  const away = competition?.competitors?.find(
    (competitor) => competitor.homeAway === "away",
  );

  if (!competition || !home || !away) return null;

  const completed = isCompleted(event);
  const extraTime = completed && wentToExtraTime(event);

  // For ET/pen matches the scoreboard score includes extra-time goals.
  // Fetch the summary endpoint to get period-by-period linescores and sum
  // periods 1+2 to isolate the 90-minute result.
  let homeGoals = completed ? parseScore(home.score) : null;
  let awayGoals = completed ? parseScore(away.score) : null;

  if (extraTime) {
    const reg = await fetchRegulationScore(event.id);
    if (reg) {
      homeGoals = reg.homeGoals;
      awayGoals = reg.awayGoals;
    }
    // If the summary fetch fails we keep the post-ET score as a fallback;
    // the operator will see the mismatch and can correct manually.
  }

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
    wentToET: extraTime,
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
  const parsedEvents = (
    await Promise.all((scoreboard.events ?? []).map(parseEvent))
  ).filter((event): event is ParsedEvent => event !== null);

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
  const parsedEvents = (
    await Promise.all((scoreboard.events ?? []).map(parseEvent))
  ).filter((event): event is ParsedEvent => event !== null && event.result !== null);

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
