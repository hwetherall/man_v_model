import { hasAppAccess } from "@/lib/auth";
import { getDashboardData } from "@/lib/supabase/queries";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  SOURCE_LABELS,
  SOURCES,
  type MatchRow,
  type PredictionRow,
  type SaveMatchPayload,
} from "@/lib/types";
import { validatePrediction } from "@/lib/validation";
import { NextRequest, NextResponse } from "next/server";

function trimToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function validationErrors(payload: SaveMatchPayload) {
  const errors: string[] = [];
  const match = payload.match;

  if (!match.home_team.trim()) errors.push("Home team is required.");
  if (!match.away_team.trim()) errors.push("Away team is required.");
  if (match.home_team.trim() === match.away_team.trim()) {
    errors.push("Home and away teams must differ.");
  }
  if (Number.isNaN(new Date(match.kickoff_utc).getTime())) {
    errors.push("Kickoff must be a valid datetime.");
  }

  for (const source of SOURCES) {
    errors.push(
      ...validatePrediction(source, payload.predictions[source]).map((error) =>
        error.replace(source, SOURCE_LABELS[source]),
      ),
    );
  }

  return errors;
}

export async function GET() {
  if (!(await hasAppAccess())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await getDashboardData());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load data." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await hasAppAccess())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json()) as SaveMatchPayload;
  const errors = validationErrors(payload);

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();
    const kickoff = new Date(payload.match.kickoff_utc).toISOString();
    const matchFields = {
      stage: payload.match.stage,
      group_name: trimToNull(payload.match.group_name),
      home_team: payload.match.home_team.trim(),
      away_team: payload.match.away_team.trim(),
      kickoff_utc: kickoff,
      venue: trimToNull(payload.match.venue),
    };

    const matchResult = payload.match.id
      ? await supabase
          .from("matches")
          .update(matchFields)
          .eq("id", payload.match.id)
          .select("*")
          .single()
      : await supabase.from("matches").insert(matchFields).select("*").single();

    if (matchResult.error || !matchResult.data) {
      throw new Error(matchResult.error?.message ?? "Unable to save match.");
    }

    const match = matchResult.data as MatchRow;
    const predictionRows = SOURCES.map((source) => {
      const prediction = payload.predictions[source];
      return {
        match_id: match.id,
        source,
        market: "result_90",
        snapshot: "lock",
        p_home: null,
        p_draw: null,
        p_away: null,
        pred_home_goals: prediction.pred_home_goals,
        pred_away_goals: prediction.pred_away_goals,
      };
    });

    const predictionResult = await supabase
      .from("predictions")
      .upsert(predictionRows, {
        onConflict: "match_id,source,market,snapshot",
      })
      .select("*")
      .returns<PredictionRow[]>();

    if (predictionResult.error) {
      throw new Error(predictionResult.error.message);
    }

    return NextResponse.json({
      data: await getDashboardData(),
      matchId: match.id,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save match." },
      { status: 500 },
    );
  }
}
