import type { Pick, PredictionInput, Source } from "@/lib/types";

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

  return errors;
}
