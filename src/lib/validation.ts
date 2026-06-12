import type { Pick, PredictionInput, Source } from "@/lib/types";

export const PROBABILITY_TOLERANCE = 0.015;
export const DEVIATION_THRESHOLD = 0.05;

export function pickFromScoreline(homeGoals: number, awayGoals: number): Pick {
  if (homeGoals > awayGoals) return "home";
  if (awayGoals > homeGoals) return "away";
  return "draw";
}

export function goalsForPick(pick: Pick, homeGoals: number, awayGoals: number) {
  if (pick === "draw") {
    return { homeGoals, awayGoals: homeGoals };
  }

  if (pick === "home" && homeGoals <= awayGoals) {
    return { homeGoals: awayGoals + 1, awayGoals };
  }

  if (pick === "away" && awayGoals <= homeGoals) {
    return { homeGoals, awayGoals: homeGoals + 1 };
  }

  return { homeGoals, awayGoals };
}

export function hasProbabilitySet(prediction: PredictionInput): boolean {
  return (
    prediction.p_home !== null &&
    prediction.p_draw !== null &&
    prediction.p_away !== null
  );
}

export function hasPartialProbabilitySet(prediction: PredictionInput): boolean {
  const values = [prediction.p_home, prediction.p_draw, prediction.p_away];
  return values.some((value) => value !== null) && values.some((value) => value === null);
}

export function probabilitySum(prediction: PredictionInput): number | null {
  if (!hasProbabilitySet(prediction)) return null;
  return (
    (prediction.p_home ?? 0) +
    (prediction.p_draw ?? 0) +
    (prediction.p_away ?? 0)
  );
}

export function pickFromProbabilities(prediction: PredictionInput): Pick | null {
  if (!hasProbabilitySet(prediction)) return null;
  const pHome = prediction.p_home ?? 0;
  const pDraw = prediction.p_draw ?? 0;
  const pAway = prediction.p_away ?? 0;

  const scorePick = pickFromScoreline(
    prediction.pred_home_goals,
    prediction.pred_away_goals,
  );
  const probabilities: Array<{ pick: Pick; value: number }> = [
    { pick: "home", value: pHome },
    { pick: "draw", value: pDraw },
    { pick: "away", value: pAway },
  ];
  const max = Math.max(...probabilities.map((probability) => probability.value));
  const tied = probabilities.filter(
    (probability) => Math.abs(probability.value - max) < 0.000001,
  );

  if (tied.length === 1) return tied[0].pick;
  return tied.some((probability) => probability.pick === scorePick)
    ? scorePick
    : tied[0].pick;
}

export function validatePrediction(source: Source, prediction: PredictionInput): string[] {
  const errors: string[] = [];
  const scorePick = pickFromScoreline(
    prediction.pred_home_goals,
    prediction.pred_away_goals,
  );

  if (
    !Number.isInteger(prediction.pred_home_goals) ||
    !Number.isInteger(prediction.pred_away_goals) ||
    prediction.pred_home_goals < 0 ||
    prediction.pred_away_goals < 0
  ) {
    errors.push(`${source}: scoreline goals must be whole numbers at least 0.`);
  }

  if (prediction.pick !== scorePick) {
    errors.push(`${source}: pick and scoreline disagree.`);
  }

  for (const [label, value] of [
    ["home", prediction.p_home],
    ["draw", prediction.p_draw],
    ["away", prediction.p_away],
  ] as const) {
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1)) {
      errors.push(`${source}: ${label} probability must be between 0 and 1.`);
    }
  }

  if (hasPartialProbabilitySet(prediction)) {
    errors.push(`${source}: enter all three probabilities or leave all three blank.`);
  }

  const sum = probabilitySum(prediction);
  if (sum !== null && Math.abs(sum - 1) > PROBABILITY_TOLERANCE) {
    errors.push(`${source}: probabilities must sum to 1.00.`);
  }

  const probabilityPick = pickFromProbabilities(prediction);
  if (probabilityPick !== null && probabilityPick !== prediction.pick) {
    errors.push(`${source}: probability favorite must match the pick.`);
  }

  return errors;
}

export function differsFromModel(
  model: PredictionInput,
  me: PredictionInput,
): boolean {
  if (model.pick !== me.pick) return true;
  if (!hasProbabilitySet(model) || !hasProbabilitySet(me)) return false;

  const gaps = [
    Math.abs((model.p_home ?? 0) - (me.p_home ?? 0)),
    Math.abs((model.p_draw ?? 0) - (me.p_draw ?? 0)),
    Math.abs((model.p_away ?? 0) - (me.p_away ?? 0)),
  ];
  return Math.max(...gaps) > DEVIATION_THRESHOLD;
}

export function sourceDirection(pick: Pick): string {
  if (pick === "home") return "toward home";
  if (pick === "away") return "toward away";
  return "toward draw";
}
