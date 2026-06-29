"use client";

import { useMemo } from "react";
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
  const summary = useMemo(
    () => buildDriftSummary({ matches, pointsLeaderboard }),
    [matches, pointsLeaderboard],
  );

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
    </div>
  );
}
