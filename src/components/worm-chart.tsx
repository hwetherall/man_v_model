"use client";

import { useMemo, useState } from "react";
import { formatMatchDate, formatMatchKickoff } from "@/lib/format-date";
import { buildWormChartData } from "@/lib/worm-chart";
import { SOURCE_LABELS, SOURCES, type MatchPointsRow, type Source } from "@/lib/types";

const sourceStroke: Record<Source, string> = {
  crowd: "#34d399",
  pele: "#fcd34d",
  harry: "#f87171",
};

const PLOT = {
  left: 44,
  top: 16,
  right: 16,
  bottom: 36,
  width: 640,
  height: 240,
};

function yTicks(maxValue: number) {
  if (maxValue <= 0) return [0];
  const step = maxValue <= 6 ? 1 : maxValue <= 15 ? 3 : Math.ceil(maxValue / 5);
  const ticks: number[] = [];
  for (let value = 0; value <= maxValue; value += step) {
    ticks.push(value);
  }
  if (ticks[ticks.length - 1] !== maxValue) ticks.push(maxValue);
  return ticks;
}

export function WormChart({ matchPoints }: { matchPoints: MatchPointsRow[] }) {
  const chart = useMemo(() => buildWormChartData(matchPoints), [matchPoints]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const plotWidth = PLOT.width - PLOT.left - PLOT.right;
  const plotHeight = PLOT.height - PLOT.top - PLOT.bottom;
  const pointCount = chart.steps.length + 1;
  const maxY = Math.max(
    1,
    ...SOURCES.flatMap((source) => chart.cumulative[source]),
  );
  const ticks = yTicks(maxY);

  function xAt(index: number) {
    if (pointCount <= 1) return PLOT.left + plotWidth / 2;
    return PLOT.left + (index / (pointCount - 1)) * plotWidth;
  }

  function yAt(value: number) {
    return PLOT.top + plotHeight - (value / maxY) * plotHeight;
  }

  const labelStride =
    chart.steps.length <= 8 ? 1 : Math.ceil(chart.steps.length / 8);

  if (chart.steps.length === 0) {
    return (
      <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950/60 p-4 text-sm text-neutral-400">
        Worm appears once matches are settled.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-normal text-neutral-500">
            Over time
          </p>
          <h3 className="mt-1 text-base font-semibold">Points worm</h3>
          <p className="mt-1 text-xs text-neutral-500">Match points only, by kickoff order</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {SOURCES.map((source) => (
            <div key={source} className="flex items-center gap-2 text-xs text-neutral-300">
              <span
                className="h-0.5 w-4 rounded-full"
                style={{ backgroundColor: sourceStroke[source] }}
              />
              {SOURCE_LABELS[source]}
            </div>
          ))}
        </div>
      </div>

      <div className="relative mt-4">
        <svg
          viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
          className="h-auto w-full"
          role="img"
          aria-label="Cumulative match points over settled matches"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PLOT.left}
                x2={PLOT.width - PLOT.right}
                y1={yAt(tick)}
                y2={yAt(tick)}
                stroke="#262626"
                strokeWidth={1}
              />
              <text
                x={PLOT.left - 8}
                y={yAt(tick) + 4}
                textAnchor="end"
                className="fill-neutral-500 text-[10px]"
              >
                {tick}
              </text>
            </g>
          ))}

          {SOURCES.map((source) => {
            const values = chart.cumulative[source];
            const points = values
              .map((value, index) => `${xAt(index)},${yAt(value)}`)
              .join(" ");

            return (
              <polyline
                key={source}
                fill="none"
                stroke={sourceStroke[source]}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                points={points}
              />
            );
          })}

          {chart.steps.map((step, index) => {
            const pointIndex = index + 1;
            const x = xAt(pointIndex);
            const showLabel = index % labelStride === 0 || index === chart.steps.length - 1;

            return (
              <g key={step.matchId}>
                <line
                  x1={x}
                  x2={x}
                  y1={PLOT.top}
                  y2={PLOT.top + plotHeight}
                  stroke="#404040"
                  strokeWidth={1}
                  strokeDasharray="3 4"
                  opacity={activeIndex === index ? 0.9 : 0.25}
                />
                {showLabel ? (
                  <text
                    x={x}
                    y={PLOT.height - 10}
                    textAnchor="middle"
                    className="fill-neutral-500 text-[9px]"
                  >
                    {formatMatchDate(step.kickoffUtc)}
                  </text>
                ) : null}
                <rect
                  x={x - plotWidth / chart.steps.length / 2}
                  y={PLOT.top}
                  width={plotWidth / chart.steps.length}
                  height={plotHeight}
                  fill="transparent"
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                />
              </g>
            );
          })}

          {activeIndex !== null ? (
            <>
              {SOURCES.map((source) => {
                const value = chart.cumulative[source][activeIndex + 1] ?? 0;
                return (
                  <circle
                    key={source}
                    cx={xAt(activeIndex + 1)}
                    cy={yAt(value)}
                    r={4}
                    fill={sourceStroke[source]}
                  />
                );
              })}
            </>
          ) : null}
        </svg>

        {activeIndex !== null ? (
          <div className="pointer-events-none absolute left-1/2 top-2 z-10 w-[min(100%,18rem)] -translate-x-1/2 rounded-md border border-neutral-700 bg-neutral-950/95 px-3 py-2 text-xs shadow-lg">
            <div className="font-medium text-neutral-100">
              {chart.steps[activeIndex].label}
            </div>
            <div className="mt-0.5 text-neutral-500">
              {formatMatchKickoff(chart.steps[activeIndex].kickoffUtc)}
            </div>
            <div className="mt-2 grid gap-1">
              {SOURCES.map((source) => {
                const gained = chart.steps[activeIndex].pointsBySource[source];
                const total = chart.cumulative[source][activeIndex + 1] ?? 0;
                return (
                  <div key={source} className="flex items-center justify-between gap-3">
                    <span className="text-neutral-400">{SOURCE_LABELS[source]}</span>
                    <span className="font-mono text-neutral-200">
                      +{gained} → {total}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
