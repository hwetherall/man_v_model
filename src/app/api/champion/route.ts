import { hasAppAccess } from "@/lib/auth";
import { getDashboardData } from "@/lib/supabase/queries";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  SOURCE_LABELS,
  SOURCES,
  type SaveChampionPayload,
  type Source,
} from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";

function cleanTeamName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function validatePayload(payload: SaveChampionPayload) {
  const errors: string[] = [];

  for (const source of SOURCES) {
    const picks = payload.picks[source] ?? [];
    if (picks.length > 10) {
      errors.push(`${SOURCE_LABELS[source]} has more than 10 champion picks.`);
    }

    const filled = picks.map(cleanTeamName).filter(Boolean);
    const normalized = filled.map((team) => team.toLowerCase());
    if (new Set(normalized).size !== normalized.length) {
      errors.push(`${SOURCE_LABELS[source]} has a duplicate champion pick.`);
    }
  }

  return errors;
}

export async function POST(request: NextRequest) {
  if (!(await hasAppAccess())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json()) as SaveChampionPayload;
  const errors = validatePayload(payload);

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();
    const deleteResult = await supabase
      .from("champion_picks")
      .delete()
      .neq("source", "__none__");

    if (deleteResult.error) {
      throw new Error(deleteResult.error.message);
    }

    const rows = SOURCES.flatMap((source) =>
      (payload.picks[source] ?? [])
        .slice(0, 10)
        .map((teamName, index) => ({
          source,
          rank: index + 1,
          team_name: cleanTeamName(teamName),
        }))
        .filter((row) => row.team_name.length > 0),
    );

    if (rows.length > 0) {
      const insertResult = await supabase.from("champion_picks").insert(rows);
      if (insertResult.error) {
        throw new Error(insertResult.error.message);
      }
    }

    const winnerTeam = payload.winner_team ? cleanTeamName(payload.winner_team) : null;
    const winnerResult = await supabase.from("champion_result").upsert(
      {
        id: true,
        winner_team: winnerTeam,
        settled_at: winnerTeam ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

    if (winnerResult.error) {
      throw new Error(winnerResult.error.message);
    }

    return NextResponse.json({ data: await getDashboardData() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save champion picks." },
      { status: 500 },
    );
  }
}
