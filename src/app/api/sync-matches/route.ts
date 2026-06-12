import { hasAppAccess } from "@/lib/auth";
import { syncWorldCupMatchesFromEspn } from "@/lib/espn";
import { getDashboardData } from "@/lib/supabase/queries";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  if (!(await hasAppAccess())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { dates?: string };
    const result = await syncWorldCupMatchesFromEspn(body.dates ?? "2026");
    const data = await getDashboardData();

    return NextResponse.json({ result, data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to sync ESPN matches." },
      { status: 500 },
    );
  }
}
