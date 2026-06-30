"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardData, MatchRow, PointsLeaderboardRow } from "@/lib/types";

type Props =
  | { matches: MatchRow[]; pointsLeaderboard: PointsLeaderboardRow[] }
  | { data: DashboardData };

type GoblinResponse = {
  generatedAt: string;
  lines: string[];
};

function resolveProps(props: Props) {
  if ("data" in props) {
    return { matches: props.data.matches, pointsLeaderboard: props.data.pointsLeaderboard };
  }
  return { matches: props.matches, pointsLeaderboard: props.pointsLeaderboard };
}

export function GoblinSays(props: Props) {
  const { matches } = resolveProps(props);
  const [sayings, setSayings] = useState<GoblinResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const settledRecent = useMemo(() => {
    // Signature based on recently settled matches to trigger refresh
    return matches
      .filter((m) => m.result_90 !== null)
      .map((m) => [m.id, m.kickoff_utc, m.home_goals, m.away_goals].join("|"))
      .join(";");
  }, [matches]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/goblin-says", { cache: "no-store", signal });
      const payload = (await res.json()) as Partial<GoblinResponse> & { error?: string };

      if (!res.ok) {
        throw new Error(payload.error ?? "Goblin refused to speak.");
      }

      setSayings({
        generatedAt: payload.generatedAt ?? new Date().toISOString(),
        lines: Array.isArray(payload.lines) ? payload.lines : [],
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Goblin is sulking.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [settledRecent, load]);

  const hasContent = !!sayings?.lines?.length;

  return (
    <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/15 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.5px] text-emerald-300/80">
            Goblin Says
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="h-7 rounded border border-emerald-800/60 px-2.5 text-xs font-medium text-emerald-200 transition hover:bg-emerald-950/40 hover:border-emerald-700 disabled:opacity-60"
        >
          {loading ? "Thinking..." : "Refresh"}
        </button>
      </div>

      <div className="mt-3">
        {error ? (
          <p className="text-sm text-amber-300">{error}</p>
        ) : hasContent ? (
          <div className="space-y-2.5 border-l border-emerald-800/50 pl-3">
            {sayings!.lines.map((line, idx) => (
              <p key={`${line}-${idx}`} className="text-sm leading-relaxed text-neutral-200">
                {line}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-sm text-neutral-400">
            {loading ? "The goblin is sniffing the results..." : "No matches finished in the day window yet."}
          </p>
        )}
      </div>
    </div>
  );
}
