import { buildDriftSummary } from "@/lib/drift";
import {
  SOURCE_LABELS,
  STAGE_LABELS,
  SOURCES,
  type DashboardData,
  type MatchRow,
  type Pick,
  type PredictionRow,
  type Source,
} from "@/lib/types";
import { pickFromScoreline } from "@/lib/validation";

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";

type AdviceResponse = {
  lines?: unknown;
};

function resultLabel(result: Pick | null) {
  if (result === "home") return "home win";
  if (result === "away") return "away win";
  if (result === "draw") return "draw";
  return "unsettled";
}

function sourceLabel(source: Source) {
  return SOURCE_LABELS[source];
}

function predictionText(prediction: PredictionRow | undefined) {
  if (
    !prediction ||
    prediction.pred_home_goals === null ||
    prediction.pred_away_goals === null
  ) {
    return "no pick";
  }

  const pick = pickFromScoreline(prediction.pred_home_goals, prediction.pred_away_goals);
  return `${prediction.pred_home_goals}-${prediction.pred_away_goals} (${resultLabel(pick)})`;
}

function predictionPick(prediction: PredictionRow | undefined) {
  if (
    !prediction ||
    prediction.pred_home_goals === null ||
    prediction.pred_away_goals === null
  ) {
    return null;
  }

  return pickFromScoreline(prediction.pred_home_goals, prediction.pred_away_goals);
}

function matchTitle(match: MatchRow) {
  return `${match.home_team} v ${match.away_team}`;
}

function hoursFrom(now: Date, iso: string) {
  return Math.round((new Date(iso).getTime() - now.getTime()) / (60 * 60 * 1000));
}

function buildPredictionIndex(predictions: PredictionRow[]) {
  return new Map(predictions.map((row) => [`${row.match_id}:${row.source}`, row]));
}

function buildRecentResults(data: DashboardData, now: Date) {
  const cutoff = now.getTime() - 48 * 60 * 60 * 1000;
  const pointsByMatch = new Map(
    data.matchPoints.map((row) => [`${row.match_id}:${row.source}`, row.points]),
  );

  return data.matches
    .filter((match) => {
      const kickoff = new Date(match.kickoff_utc).getTime();
      return match.result_90 !== null && kickoff >= cutoff && kickoff <= now.getTime();
    })
    .sort((left, right) => new Date(right.kickoff_utc).getTime() - new Date(left.kickoff_utc).getTime())
    .slice(0, 6)
    .map((match) => {
      const points = SOURCES.map(
        (source) => `${sourceLabel(source)} ${pointsByMatch.get(`${match.id}:${source}`) ?? 0}`,
      ).join(", ");
      return `${matchTitle(match)} finished ${match.home_goals}-${match.away_goals} (${resultLabel(
        match.result_90,
      )}); points: ${points}.`;
    });
}

function buildRecentSwings(data: DashboardData, now: Date) {
  const cutoff = now.getTime() - 48 * 60 * 60 * 1000;
  const pointsByMatch = new Map(
    data.matchPoints.map((row) => [`${row.match_id}:${row.source}`, row.points]),
  );

  return data.matches
    .filter((match) => {
      const kickoff = new Date(match.kickoff_utc).getTime();
      return match.result_90 !== null && kickoff >= cutoff && kickoff <= now.getTime();
    })
    .sort((left, right) => new Date(right.kickoff_utc).getTime() - new Date(left.kickoff_utc).getTime())
    .slice(0, 6)
    .map((match) => {
      const myPoints = pointsByMatch.get(`${match.id}:harry`) ?? 0;
      const marketSwing = myPoints - (pointsByMatch.get(`${match.id}:crowd`) ?? 0);
      const modelSwing = myPoints - (pointsByMatch.get(`${match.id}:pele`) ?? 0);

      return `${matchTitle(match)}: Me ${myPoints}; swing vs Market ${marketSwing >= 0 ? "+" : ""}${marketSwing}, vs Model ${modelSwing >= 0 ? "+" : ""}${modelSwing}.`;
    });
}

function buildUpcomingMatches(data: DashboardData, now: Date) {
  const predictionByKey = buildPredictionIndex(data.predictions);

  return data.matches
    .filter((match) => match.result_90 === null)
    .sort((left, right) => new Date(left.kickoff_utc).getTime() - new Date(right.kickoff_utc).getTime())
    .slice(0, 6)
    .map((match) => {
      const inHours = hoursFrom(now, match.kickoff_utc);
      const picks = SOURCES.map((source) => {
        const prediction = predictionByKey.get(`${match.id}:${source}`);
        return `${sourceLabel(source)} ${predictionText(prediction)}`;
      }).join("; ");

      return `${matchTitle(match)}, ${STAGE_LABELS[match.stage]}, in ${inHours}h: ${picks}.`;
    });
}

function buildUpcomingLeverage(data: DashboardData, now: Date) {
  const predictionByKey = buildPredictionIndex(data.predictions);

  return data.matches
    .filter((match) => match.result_90 === null)
    .sort((left, right) => new Date(left.kickoff_utc).getTime() - new Date(right.kickoff_utc).getTime())
    .map((match) => {
      const harry = predictionByKey.get(`${match.id}:harry`);
      const market = predictionByKey.get(`${match.id}:crowd`);
      const model = predictionByKey.get(`${match.id}:pele`);
      const harryPick = predictionPick(harry);
      const marketPick = predictionPick(market);
      const modelPick = predictionPick(model);

      if (!harryPick) return null;

      const targets = [
        marketPick && marketPick !== harryPick ? "Market" : null,
        modelPick && modelPick !== harryPick ? "Model" : null,
      ].filter(Boolean);

      if (targets.length === 0) return null;

      return `${matchTitle(match)}, in ${hoursFrom(now, match.kickoff_utc)}h: Me ${predictionText(
        harry,
      )}; Market ${predictionText(market)}; Model ${predictionText(
        model,
      )}. Leverage against ${targets.join(" and ")}.`;
    })
    .filter((line): line is string => Boolean(line))
    .slice(0, 6);
}

export function buildDriftAdviceContext(data: DashboardData, now = new Date()) {
  const summary = buildDriftSummary(data);
  const standings = SOURCES.map((source) => {
    const row = data.pointsLeaderboard.find((standing) => standing.source === source);
    return `${sourceLabel(source)} ${row?.points ?? 0} pts (${row?.correct_picks ?? 0} correct, ${
      row?.exact_scores ?? 0
    } exact)`;
  });

  const drift = summary.rivals.map((rival) => {
    const label = sourceLabel(rival.rival);
    const stageNeed =
      rival.requiredPpmThisStage === null
        ? "stage settled"
        : `${rival.requiredPpmThisStage.toFixed(2)} pts/match this stage`;
    const totalNeed =
      rival.requiredPpmTotal === null
        ? "tournament settled"
        : `${rival.requiredPpmTotal.toFixed(2)} pts/match to the final`;
    return `Me vs ${label}: gap ${rival.gap} pts; needs ${stageNeed}; ${totalNeed}.`;
  });

  const recentResults = buildRecentResults(data, now);
  const recentSwings = buildRecentSwings(data, now);
  const upcomingMatches = buildUpcomingMatches(data, now);
  const upcomingLeverage = buildUpcomingLeverage(data, now);

  return [
    `Generated at ${now.toISOString()}.`,
    `Current stage: ${summary.currentStage ? STAGE_LABELS[summary.currentStage] : "complete"}.`,
    `Standings: ${standings.join("; ")}.`,
    `Drift: ${drift.join(" ")}`,
    `Recent 48h: ${recentResults.length > 0 ? recentResults.join(" ") : "No settled matches in the last 48 hours."}`,
    `Recent swing ledger: ${recentSwings.length > 0 ? recentSwings.join(" ") : "No point swings in the last 48 hours."}`,
    `Leverage board: ${upcomingLeverage.length > 0 ? upcomingLeverage.join(" ") : "No upcoming matches where Me differs from Market or Model."}`,
    `Next fixtures: ${upcomingMatches.length > 0 ? upcomingMatches.join(" ") : "No unsettled matches remain."}`,
  ].join("\n");
}

function parseAdviceLines(content: string) {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  let parsed: AdviceResponse;

  try {
    parsed = JSON.parse(cleaned) as AdviceResponse;
  } catch {
    const recoveredLines = cleaned
      .split(/\r?\n/)
      .map((line) =>
        line
          .replace(/^\s*[-*"'\d.)]+/, "")
          .replace(/[",]+$/, "")
          .trim(),
      )
      .filter((line) => line.length > 0 && !line.match(/^[{}\]]/) && line !== "lines")
      .slice(0, 4);

    if (recoveredLines.length > 0) {
      return recoveredLines;
    }

    throw new Error("DeepSeek response could not be parsed.");
  }

  if (!Array.isArray(parsed.lines)) {
    throw new Error("DeepSeek response did not include advice lines.");
  }

  return parsed.lines
    .filter((line): line is string => typeof line === "string")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);
}

export async function generateDriftAdvice(context: string) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL ?? DEFAULT_DEEPSEEK_MODEL,
        temperature: 0.9,
        max_tokens: 260,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are the Drift Goblin inside a private World Cup prediction dashboard. Give Harry cheeky, cryptic, useful advice. Use only the supplied dashboard facts. Do not invent news, injuries, odds, or results. Prefer leverage and risk over recap. Return strict JSON only: {\"lines\":[\"...\"]}.",
          },
          {
            role: "user",
            content: `Write 3 or 4 short lines. Each should be 8-18 words.

Rules:
- Start from the leverage board; mention consensus fixtures only as traps or no-action spots.
- Tie at least one line to the recent swing ledger if there was a meaningful swing.
- Do not say "bank the sure point", "dead heat", "no mischief", or generic encouragement.
- Be sly, specific, and a little cryptic, but still actionable.
- If Harry is behind, nudge where to hunt. If Harry is ahead, warn where not to bleed.

${context}`,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`DeepSeek returned ${response.status}.`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("DeepSeek returned an empty response.");
    }

    const lines = parseAdviceLines(content);
    if (lines.length === 0) {
      throw new Error("DeepSeek returned no usable advice.");
    }

    return lines;
  } finally {
    clearTimeout(timeout);
  }
}
