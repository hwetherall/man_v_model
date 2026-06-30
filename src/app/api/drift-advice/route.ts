import { hasAppAccess } from "@/lib/auth";
import { buildDriftAdviceContext, generateDriftAdvice } from "@/lib/drift-advice";
import { getDashboardData } from "@/lib/supabase/queries";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await hasAppAccess())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await getDashboardData();
    const context = buildDriftAdviceContext(data);
    const lines = await generateDriftAdvice(context);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      lines,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to generate drift advice." },
      { status: 500 },
    );
  }
}
