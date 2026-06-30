import {
  SOURCE_LABELS,
  SOURCES,
  STAGE_LABELS,
  type DashboardData,
  type MatchRow,
  type MatchPointsRow,
  type PredictionRow,
  type Source,
} from "@/lib/types";
import { pickFromScoreline } from "@/lib/validation";
import { getStereotypesForMatch } from "@/lib/team-stereotypes";

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";

const DAY_WINDOW_MS = 36 * 60 * 60 * 1000;

type GoblinResponse = {
  lines?: unknown;
};

function resultLabel(p: "home" | "draw" | "away" | null) {
  if (p === "home") return "home win";
  if (p === "away") return "away win";
  if (p === "draw") return "draw";
  return "unsettled";
}

function sourceLabel(s: Source) {
  return SOURCE_LABELS[s];
}

function predictionText(row: PredictionRow | undefined) {
  if (!row || row.pred_home_goals === null || row.pred_away_goals === null) {
    return "no pick";
  }
  const pick = pickFromScoreline(row.pred_home_goals, row.pred_away_goals);
  return `${row.pred_home_goals}-${row.pred_away_goals} (${resultLabel(pick)})`;
}

function matchTitle(m: MatchRow) {
  return `${m.home_team} v ${m.away_team}`;
}

function buildPredictionIndex(rows: PredictionRow[]) {
  return new Map(rows.map((r) => [`${r.match_id}:${r.source}`, r]));
}

function buildPointsIndex(rows: MatchPointsRow[]) {
  return new Map(rows.map((r) => [`${r.match_id}:${r.source}`, r]));
}

export function getTodaysSettledMatches(data: DashboardData, now = new Date()): MatchRow[] {
  const cutoff = now.getTime() - DAY_WINDOW_MS;
  return data.matches
    .filter((m) => {
      if (m.result_90 === null) return false;
      const kick = new Date(m.kickoff_utc).getTime();
      return kick >= cutoff;
    })
    .sort((a, b) => new Date(b.kickoff_utc).getTime() - new Date(a.kickoff_utc).getTime());
}

function buildTodaysSummary(data: DashboardData, todaysMatches: MatchRow[]) {
  const pointsIdx = buildPointsIndex(data.matchPoints);
  const perSource: Record<Source, number> = { crowd: 0, pele: 0, harry: 0 };

  todaysMatches.forEach((m) => {
    SOURCES.forEach((src) => {
      const p = pointsIdx.get(`${m.id}:${src}`);
      if (p) perSource[src] += p.points;
    });
  });

  return SOURCES.map((src) => `${sourceLabel(src)} +${perSource[src]}`).join(", ");
}

function buildMatchLines(data: DashboardData, todaysMatches: MatchRow[]) {
  const predIdx = buildPredictionIndex(data.predictions);
  const pointsIdx = buildPointsIndex(data.matchPoints);

  return todaysMatches.map((match) => {
    const actual = `${match.home_goals}-${match.away_goals} (${resultLabel(match.result_90)})`;
    const picks = SOURCES.map((src) => {
      const pred = predIdx.get(`${match.id}:${src}`);
      const ptsRow = pointsIdx.get(`${match.id}:${src}`);
      const pts = ptsRow ? ptsRow.points : 0;
      return `${sourceLabel(src)} ${predictionText(pred)} [${pts}pt]`;
    }).join("; ");

    const stereotypes = getStereotypesForMatch(match.home_team, match.away_team);

    return `${matchTitle(match)} → ${actual}. ${picks}. ${stereotypes}`;
  });
}

export function buildGoblinSaysContext(data: DashboardData, now = new Date()) {
  const todays = getTodaysSettledMatches(data, now);
  const summary = buildTodaysSummary(data, todays);
  const matchLines = buildMatchLines(data, todays);

  const stage = data.matches.find((m) => m.result_90 === null)?.stage;
  const stageLabel = stage ? STAGE_LABELS[stage] : "tournament winding down";

  const standings = SOURCES.map((src) => {
    const row = data.pointsLeaderboard.find((r) => r.source === src);
    return `${sourceLabel(src)} ${row?.points ?? 0}`;
  }).join(" / ");

  return [
    `Day window: last ${Math.round(DAY_WINDOW_MS / (3600 * 1000))} hours.`,
    `Current stage vibe: ${stageLabel}.`,
    `Overall: ${standings}.`,
    `Today's haul: ${summary || "quiet day"}.`,
    matchLines.length > 0
      ? `Matches:\n${matchLines.join("\n")}`
      : "No settled matches in the day window.",
  ].join("\n\n");
}

function parseGoblinLines(content: string): string[] {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  let parsed: GoblinResponse;
  try {
    parsed = JSON.parse(cleaned) as GoblinResponse;
  } catch {
    // Fallback: try to pull lines from prose
    const recovered = cleaned
      .split(/\r?\n+/)
      .map((l) =>
        l
          .replace(/^\s*[-*•"\d).]+/, "")
          .replace(/[",]+$/, "")
          .trim(),
      )
      .filter((l) => l.length > 6 && !/^[{}\]]/.test(l) && l.toLowerCase() !== "lines")
      .slice(0, 6);

    if (recovered.length > 0) return recovered;
    throw new Error("Goblin response could not be parsed.");
  }

  if (!Array.isArray(parsed.lines)) {
    throw new Error("Goblin response did not include lines.");
  }

  return parsed.lines
    .filter((l): l is string => typeof l === "string")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6);
}

export async function generateGoblinSays(context: string): Promise<string[]> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL ?? DEFAULT_DEEPSEEK_MODEL,
        temperature: 0.95,
        max_tokens: 320,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are the Goblin — a cheeky, slightly unhinged football gremlin who loves national team stereotypes and dramatic outcomes. You speak in short, flavorful, goblin-voiced lines. Use the supplied team stereotypes to color every comment. Be specific to today's results, who gained points, and the flavor of the teams. Never invent external news. Output strict JSON only: {\"lines\": [\"line1\", ...]}. Max 6 lines, each 8–20 words.",
          },
          {
            role: "user",
            content: `Write a goblin-style end-of-day roundup as 4–6 short lines. Weave in the stereotypes. Highlight clever calls, disasters, and trope-fulfilling results. Be playful and specific.\n\n${context}`,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`DeepSeek returned ${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("DeepSeek returned empty content for Goblin Says.");
    }

    const lines = parseGoblinLines(content);
    if (lines.length === 0) {
      throw new Error("Goblin had nothing to say.");
    }
    return lines;
  } finally {
    clearTimeout(timeout);
  }
}
