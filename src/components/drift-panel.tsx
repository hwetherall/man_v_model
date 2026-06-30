"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SOURCE_LABELS,
  STAGE_LABELS,
  type DashboardData,
  type MatchRow,
  type PointsLeaderboardRow,
  type Source,
} from "@/lib/types";
import {
  buildDriftSummary,
  DRIFT_AMBER_THRESHOLD,
  DRIFT_RED_THRESHOLD,
  type RivalDrift,
} from "@/lib/drift";

type Props =
  | { matches: MatchRow[]; pointsLeaderboard: PointsLeaderboardRow[] }
  | { data: DashboardData };

type DriftAdviceResponse = {
  generatedAt: string;
  lines: string[];
};

function resolveProps(props: Props) {
  if ("data" in props) {
    return { matches: props.data.matches, pointsLeaderboard: props.data.pointsLeaderboard };
  }
  return { matches: props.matches, pointsLeaderboard: props.pointsLeaderboard };
}

function formatPpm(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}`;
}

function ppmColorClass(value: number | null): string {
  if (value === null) return "text-neutral-400";
  if (value <= 0) return "text-emerald-400";
  if (value <= DRIFT_AMBER_THRESHOLD) return "text-neutral-300";
  if (value <= DRIFT_RED_THRESHOLD) return "text-amber-400";
  return "text-red-400";
}

function ppmBadgeClass(value: number | null): string {
  if (value === null) return "border-neutral-800 bg-neutral-950/60";
  if (value <= 0) return "border-emerald-800/50 bg-emerald-950/20";
  if (value <= DRIFT_AMBER_THRESHOLD) return "border-neutral-700 bg-neutral-900/60";
  if (value <= DRIFT_RED_THRESHOLD) return "border-amber-800/50 bg-amber-950/20";
  return "border-red-900/50 bg-red-950/20";
}

function gapDisplay(gap: number) {
  if (gap > 0) return `+${gap}`;
  return String(gap);
}

function RivalCard({
  drift,
  currentStageLabel,
  tournamentDone,
}: {
  drift: RivalDrift;
  currentStageLabel: string | null;
  tournamentDone: boolean;
}) {
  const { rival, gap, requiredPpmThisStage, requiredPpmTotal } = drift;
  const rivalLabel = SOURCE_LABELS[rival as Source];
  const cardClass = ppmBadgeClass(tournamentDone ? null : requiredPpmThisStage);
  const gapColor = gap > 0 ? "text-emerald-400" : gap < 0 ? "text-red-400" : "text-neutral-300";

  return (
    <div className={`flex-1 rounded-lg border p-4 ${cardClass}`}>
      <div className="text-xs font-medium uppercase tracking-normal text-neutral-500">
        vs {rivalLabel}
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={`font-mono text-4xl font-semibold ${gapColor}`}>
          {gapDisplay(gap)}
        </span>
        <span className="text-sm text-neutral-400">pts</span>
      </div>

      {tournamentDone ? (
        <div className="mt-3 text-xs text-neutral-500">Tournament settled</div>
      ) : (
        <div className="mt-3 grid gap-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-neutral-400">
              By end of {currentStageLabel ?? "stage"}:
            </span>
            {requiredPpmThisStage === null ? (
              <span className="text-neutral-500">stage settled</span>
            ) : (
              <span className={`font-mono font-medium ${ppmColorClass(requiredPpmThisStage)}`}>
                {formatPpm(requiredPpmThisStage)} pts/match
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-neutral-400">By the Final:</span>
            {requiredPpmTotal === null ? (
              <span className="text-neutral-500">tournament settled</span>
            ) : (
              <span className={`font-mono font-medium ${ppmColorClass(requiredPpmTotal)}`}>
                {formatPpm(requiredPpmTotal)} pts/match
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function DriftPanel(props: Props) {
  const { matches, pointsLeaderboard } = resolveProps(props);
  const [advice, setAdvice] = useState<DriftAdviceResponse | null>(null);
  const [adviceError, setAdviceError] = useState<string | null>(null);
  const [isLoadingAdvice, setIsLoadingAdvice] = useState(false);
  const summary = useMemo(
    () => buildDriftSummary({ matches, pointsLeaderboard }),
    [matches, pointsLeaderboard],
  );
  const adviceSignature = useMemo(
    () =>
      JSON.stringify({
        matches: matches.map((match) => [
          match.id,
          match.kickoff_utc,
          match.result_90,
          match.home_goals,
          match.away_goals,
        ]),
        points: pointsLeaderboard.map((row) => [
          row.source,
          row.points,
          row.correct_picks,
          row.exact_scores,
        ]),
      }),
    [matches, pointsLeaderboard],
  );

  const loadAdvice = useCallback(async (signal?: AbortSignal) => {
    setIsLoadingAdvice(true);
    setAdviceError(null);

    try {
      const response = await fetch("/api/drift-advice", {
        cache: "no-store",
        signal,
      });
      const payload = (await response.json()) as Partial<DriftAdviceResponse> & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to generate drift advice.");
      }

      setAdvice({
        generatedAt: payload.generatedAt ?? new Date().toISOString(),
        lines: Array.isArray(payload.lines) ? payload.lines : [],
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setAdviceError(error instanceof Error ? error.message : "Unable to generate drift advice.");
    } finally {
      if (!signal?.aborted) {
        setIsLoadingAdvice(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadAdvice(controller.signal);
    return () => controller.abort();
  }, [adviceSignature, loadAdvice]);

  const currentStageLabel = summary.currentStage ? STAGE_LABELS[summary.currentStage] : null;
  const tournamentDone = summary.currentStage === null;

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-normal text-neutral-500">
            Drift
          </p>
          <h3 className="mt-1 text-base font-semibold">Points to close</h3>
          <p className="mt-1 text-xs text-neutral-500">
            {tournamentDone
              ? "Tournament complete — final standings"
              : `Rate needed per remaining match to catch up`}
          </p>
        </div>
        {!tournamentDone && currentStageLabel && (
          <span className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono text-xs text-neutral-300">
            {currentStageLabel}
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        {summary.rivals.map((drift) => (
          <RivalCard
            key={drift.rival}
            drift={drift}
            currentStageLabel={currentStageLabel}
            tournamentDone={tournamentDone}
          />
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-violet-900/40 bg-violet-950/15 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.5px] text-violet-300/80">
              Drift goblin says
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadAdvice()}
            disabled={isLoadingAdvice}
            className="h-7 rounded border border-violet-800/60 px-2.5 text-xs font-medium text-violet-200 transition hover:bg-violet-950/40 hover:border-violet-700 disabled:opacity-60"
          >
            {isLoadingAdvice ? "Thinking..." : "Refresh"}
          </button>
        </div>

        <div className="mt-3">
          {adviceError ? (
            <p className="text-sm text-amber-300">{adviceError}</p>
          ) : advice?.lines.length ? (
            <div className="space-y-2.5 border-l border-violet-800/50 pl-3">
              {advice.lines.map((line, index) => (
                <p key={`${line}-${index}`} className="text-sm leading-relaxed text-neutral-200">
                  {line}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-sm text-neutral-400">
              {isLoadingAdvice ? "Reading the runes..." : "No advice yet."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
