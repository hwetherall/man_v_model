import { hasAppAccess } from "@/lib/auth";
import { buildGoblinSaysContext, generateGoblinSays } from "@/lib/goblin-says";
import { getDashboardData } from "@/lib/supabase/queries";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await hasAppAccess())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await getDashboardData();
    const context = buildGoblinSaysContext(data);
    const lines = await generateGoblinSays(context);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      lines,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Goblin is tongue-tied." },
      { status: 500 },
    );
  }
}
