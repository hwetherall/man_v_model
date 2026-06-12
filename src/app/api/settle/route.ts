import { hasAppAccess } from "@/lib/auth";
import { settleFromEspn } from "@/lib/espn";
import { getDashboardData } from "@/lib/supabase/queries";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  if (!(await hasAppAccess())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { date?: string };
    const result = await settleFromEspn(body.date ?? null);
    const data = await getDashboardData();

    return NextResponse.json({ result, data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to settle results." },
      { status: 500 },
    );
  }
}
