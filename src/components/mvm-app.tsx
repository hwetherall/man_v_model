"use client";

import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  DownloadCloud,
  GitBranch,
  Plus,
  RefreshCw,
  Save,
  Trophy,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  SOURCE_LABELS,
  SOURCES,
  STAGE_LABELS,
  STAGES,
  type AppShellProps,
  type DashboardData,
  type MatchPointsRow,
  type MatchRow,
  type Pick,
  type PredictionInput,
  type PredictionRow,
  type SaveChampionPayload,
  type SaveMatchPayload,
  type Source,
  type Stage,
} from "@/lib/types";
import { formatMatchDate, formatMatchKickoff } from "@/lib/format-date";
import {
  defaultSidebarMatchId,
  partitionMatchesForSidebar,
} from "@/lib/match-display";
import {
  goalsForPick,
  pickFromScoreline,
  validatePrediction,
} from "@/lib/validation";
import { WormChart } from "@/components/worm-chart";
import { DriftPanel } from "@/components/drift-panel";
import { GoblinSays } from "@/components/goblin-says";

type Tab = "picks" | "bracket" | "scoreboard" | "champion";
type BusyState = "idle" | "save" | "refresh" | "sync" | "champion";

type EditablePrediction = {
  pick: Pick;
  pred_home_goals: number;
  pred_away_goals: number;
};

type MatchFormState = {
  id: string | null;
  stage: Stage;
  group_name: string;
  home_team: string;
  away_team: string;
  kickoff_local: string;
  venue: string;
  predictions: Record<Source, EditablePrediction>;
};

type ChampionFormState = {
  picks: Record<Source, string[]>;
  winner_team: string;
};

type SaveMatchResponse = {
  data: DashboardData;
  matchId: string;
};

type SaveChampionResponse = {
  data: DashboardData;
};

type SyncMatchesResponse = {
  data: DashboardData;
  result: {
    fetched: number;
    created: number;
    updated: number;
    settled: number;
    errors: Array<{ externalRef: string; match: string; reason: string }>;
  };
};

const panelClass =
  "rounded-lg border border-neutral-800 bg-neutral-950/70 shadow-xl shadow-black/20";
const inputClass =
  "h-9 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none transition placeholder:text-neutral-600 focus:border-emerald-400";
const labelClass = "text-xs font-medium uppercase tracking-normal text-neutral-400";

const sourceAccent: Record<Source, string> = {
  crowd: "border-emerald-700/70 bg-emerald-950/20",
  pele: "border-amber-700/70 bg-amber-950/20",
  harry: "border-red-800/70 bg-red-950/20",
};

const sourceDot: Record<Source, string> = {
  crowd: "bg-emerald-400",
  pele: "bg-amber-300",
  harry: "bg-red-400",
};

type ScoreboardStanding = {
  source: Source;
  rank: number;
  label: string;
  matchPoints: number;
  championPoints: number;
  total: number;
  correct: number;
  exact: number;
  matchesScored: number;
};

type BracketRound = {
  stage: Exclude<Stage, "group">;
  label: string;
  expectedMatches: number;
};

const BRACKET_ROUNDS: BracketRound[] = [
  { stage: "r32", label: "Round of 32", expectedMatches: 16 },
  { stage: "r16", label: "Round of 16", expectedMatches: 8 },
  { stage: "qf", label: "Quarterfinals", expectedMatches: 4 },
  { stage: "sf", label: "Semifinals", expectedMatches: 2 },
  { stage: "third", label: "Third place", expectedMatches: 1 },
  { stage: "final", label: "Final", expectedMatches: 1 },
];

const LIVE_MATCH_WINDOW_MS = 3 * 60 * 60 * 1000;

function nowLocalInput() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function toLocalInput(iso: string) {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function toIsoFromLocal(value: string) {
  return new Date(value).toISOString();
}

function defaultGoals(pick: Pick) {
  if (pick === "away") return { homeGoals: 0, awayGoals: 1 };
  if (pick === "draw") return { homeGoals: 0, awayGoals: 0 };
  return { homeGoals: 1, awayGoals: 0 };
}

function emptyPrediction(pick: Pick = "home"): EditablePrediction {
  const goals = defaultGoals(pick);
  return {
    pick,
    pred_home_goals: goals.homeGoals,
    pred_away_goals: goals.awayGoals,
  };
}

function editableToInput(prediction: EditablePrediction): PredictionInput {
  return {
    pick: prediction.pick,
    pred_home_goals: prediction.pred_home_goals,
    pred_away_goals: prediction.pred_away_goals,
  };
}

function predictionFromRow(row: PredictionRow | undefined): EditablePrediction {
  if (!row || row.pred_home_goals === null || row.pred_away_goals === null) {
    return emptyPrediction();
  }

  return {
    pick: pickFromScoreline(row.pred_home_goals, row.pred_away_goals),
    pred_home_goals: row.pred_home_goals,
    pred_away_goals: row.pred_away_goals,
  };
}

function emptyForm(): MatchFormState {
  return {
    id: null,
    stage: "group",
    group_name: "",
    home_team: "",
    away_team: "",
    kickoff_local: nowLocalInput(),
    venue: "",
    predictions: {
      crowd: emptyPrediction("home"),
      pele: emptyPrediction("home"),
      harry: emptyPrediction("home"),
    },
  };
}

function formFromMatch(data: DashboardData, matchId: string | null): MatchFormState {
  if (!matchId) return emptyForm();

  const match = data.matches.find((candidate) => candidate.id === matchId);
  if (!match) return emptyForm();

  return {
    id: match.id,
    stage: match.stage,
    group_name: match.group_name ?? "",
    home_team: match.home_team,
    away_team: match.away_team,
    kickoff_local: toLocalInput(match.kickoff_utc),
    venue: match.venue ?? "",
    predictions: {
      crowd: predictionFromRow(
        data.predictions.find(
          (prediction) => prediction.match_id === match.id && prediction.source === "crowd",
        ),
      ),
      pele: predictionFromRow(
        data.predictions.find(
          (prediction) => prediction.match_id === match.id && prediction.source === "pele",
        ),
      ),
      harry: predictionFromRow(
        data.predictions.find(
          (prediction) => prediction.match_id === match.id && prediction.source === "harry",
        ),
      ),
    },
  };
}

function formToPayload(form: MatchFormState): SaveMatchPayload {
  return {
    match: {
      id: form.id,
      stage: form.stage,
      group_name: form.group_name.trim() || null,
      home_team: form.home_team,
      away_team: form.away_team,
      kickoff_utc: toIsoFromLocal(form.kickoff_local),
      venue: form.venue.trim() || null,
    },
    predictions: {
      crowd: editableToInput(form.predictions.crowd),
      pele: editableToInput(form.predictions.pele),
      harry: editableToInput(form.predictions.harry),
    },
  };
}

function validatePayload(payload: SaveMatchPayload) {
  const errors: string[] = [];

  if (!payload.match.home_team.trim()) errors.push("Home team is required.");
  if (!payload.match.away_team.trim()) errors.push("Away team is required.");
  if (payload.match.home_team.trim() === payload.match.away_team.trim()) {
    errors.push("Home and away teams must differ.");
  }
  if (Number.isNaN(new Date(payload.match.kickoff_utc).getTime())) {
    errors.push("Kickoff must be valid.");
  }

  for (const source of SOURCES) {
    errors.push(
      ...validatePrediction(source, payload.predictions[source]).map((error) =>
        error.replace(source, SOURCE_LABELS[source]),
      ),
    );
  }

  return errors;
}

function championFormFromData(data: DashboardData): ChampionFormState {
  const picks: Record<Source, string[]> = {
    crowd: Array.from({ length: 10 }, () => ""),
    pele: Array.from({ length: 10 }, () => ""),
    harry: Array.from({ length: 10 }, () => ""),
  };

  for (const row of data.championPicks) {
    if (row.rank >= 1 && row.rank <= 10) {
      picks[row.source][row.rank - 1] = row.team_name;
    }
  }

  return {
    picks,
    winner_team: data.championResult?.winner_team ?? "",
  };
}

function formatKickoff(value: string) {
  return formatMatchKickoff(value);
}

function formatDate(value: string) {
  return formatMatchDate(value);
}

function pickLabel(pick: Pick | null | undefined) {
  if (pick === "home") return "Home";
  if (pick === "away") return "Away";
  if (pick === "draw") return "Draw";
  return "Unset";
}

function wentToExtraTime(match: MatchRow) {
  // In knockout stages a 90-min draw always leads to ET/pens.
  return match.stage !== "group" && match.result_90 === "draw";
}

function resultText(match: MatchRow) {
  if (match.home_goals === null || match.away_goals === null) return "Open";
  const score = `${match.home_goals}-${match.away_goals}`;
  return wentToExtraTime(match) ? `${score} (aet)` : score;
}

function predictionPick(prediction: PredictionRow | undefined) {
  if (
    !prediction ||
    prediction.pred_home_goals === null ||
    prediction.pred_away_goals === null
  ) {
    return null;
  }

  return pickFromScoreline(prediction.pred_home_goals, prediction.pred_away_goals);
}

function predictionScore(prediction: PredictionRow | undefined) {
  if (
    !prediction ||
    prediction.pred_home_goals === null ||
    prediction.pred_away_goals === null
  ) {
    return "-";
  }

  return `${prediction.pred_home_goals}-${prediction.pred_away_goals}`;
}

function championPointsForRank(rank: number) {
  if (rank === 1) return 10;
  if (rank >= 2 && rank <= 10) return Math.max(0, 10 - rank);
  return 0;
}

function championBonusForSource(form: ChampionFormState, source: Source) {
  const winner = form.winner_team.trim().toLowerCase();
  if (!winner) return 0;

  const index = form.picks[source].findIndex(
    (team) => team.trim().toLowerCase() === winner,
  );
  return index === -1 ? 0 : championPointsForRank(index + 1);
}

function isPlaceholderTeam(team: string) {
  return /\b(group|winner|loser|place|round|quarterfinal|semifinal)\b/i.test(team);
}

function sortMatchesByKickoff(matches: MatchRow[]) {
  return [...matches].sort(
    (left, right) =>
      new Date(left.kickoff_utc).getTime() - new Date(right.kickoff_utc).getTime(),
  );
}

function knockoutMatches(matches: MatchRow[]) {
  return sortMatchesByKickoff(matches.filter((match) => match.stage !== "group"));
}

function advancingSide(match: MatchRow) {
  if (match.advanced) return match.advanced;
  if (match.result_90 === "home") return "home";
  if (match.result_90 === "away") return "away";
  return null;
}

function advancingTeam(match: MatchRow) {
  const side = advancingSide(match);
  if (side === "home") return match.home_team;
  if (side === "away") return match.away_team;
  return null;
}

function isLiveWindow(match: MatchRow, nowMs: number) {
  const kickoffMs = new Date(match.kickoff_utc).getTime();
  return (
    match.result_90 === null &&
    Number.isFinite(kickoffMs) &&
    nowMs >= kickoffMs &&
    nowMs < kickoffMs + LIVE_MATCH_WINDOW_MS
  );
}

function bracketStatus(match: MatchRow, nowMs: number) {
  if (match.result_90 !== null) return "Final";

  const kickoffMs = new Date(match.kickoff_utc).getTime();
  if (!Number.isFinite(kickoffMs)) return "Scheduled";
  if (nowMs >= kickoffMs && nowMs < kickoffMs + LIVE_MATCH_WINDOW_MS) return "Live";
  if (nowMs > kickoffMs) return "Pending";
  return formatKickoff(match.kickoff_utc);
}

function bracketFeedLabel(stage: Stage, index: number) {
  if (stage === "r32") return `Winner to R16 ${Math.floor(index / 2) + 1}`;
  if (stage === "r16") return `Winner to QF ${Math.floor(index / 2) + 1}`;
  if (stage === "qf") return `Winner to SF ${Math.floor(index / 2) + 1}`;
  if (stage === "sf") return index === 0 ? "Winner to Final" : "Winner to Final";
  if (stage === "third") return "Third place";
  if (stage === "final") return "Champion";
  return "";
}

function nextKnockoutMatch(matches: MatchRow[], nowMs: number) {
  const upcoming = knockoutMatches(matches).filter((match) => {
    const kickoffMs = new Date(match.kickoff_utc).getTime();
    return match.result_90 === null && Number.isFinite(kickoffMs) && kickoffMs >= nowMs;
  });
  return upcoming[0] ?? null;
}

function activeBracketRound(matches: MatchRow[]) {
  for (const round of BRACKET_ROUNDS) {
    const roundMatches = matches.filter((match) => match.stage === round.stage);
    if (roundMatches.some((match) => match.result_90 === null)) return round;
  }

  return [...BRACKET_ROUNDS].reverse().find((round) =>
    matches.some((match) => match.stage === round.stage),
  );
}

export function MvmApp({ initialData, authControl }: AppShellProps) {
  const [data, setData] = useState(initialData);
  const [tab, setTab] = useState<Tab>("picks");
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(() =>
    defaultSidebarMatchId(initialData.matches),
  );
  const [form, setForm] = useState<MatchFormState>(() =>
    formFromMatch(initialData, defaultSidebarMatchId(initialData.matches)),
  );
  const [championForm, setChampionForm] = useState<ChampionFormState>(() =>
    championFormFromData(initialData),
  );
  const [busy, setBusy] = useState<BusyState>("idle");
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(
    null,
  );
  const [syncResult, setSyncResult] = useState<SyncMatchesResponse["result"] | null>(
    null,
  );

  const matchById = useMemo(
    () => new Map(data.matches.map((match) => [match.id, match])),
    [data.matches],
  );
  const predictionByKey = useMemo(
    () =>
      new Map(
        data.predictions.map((prediction) => [
          `${prediction.match_id}:${prediction.source}`,
          prediction,
        ]),
      ),
    [data.predictions],
  );
  const pointsByKey = useMemo(
    () =>
      new Map(
        data.matchPoints.map((points) => [`${points.match_id}:${points.source}`, points]),
      ),
    [data.matchPoints],
  );
  const teamOptions = useMemo(
    () =>
      Array.from(
        new Set(
          data.matches
            .flatMap((match) => [match.home_team, match.away_team])
            .filter((team) => !isPlaceholderTeam(team)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [data.matches],
  );
  const eliminatedTeams = useMemo(() => {
    const set = new Set<string>();
    for (const match of data.matches) {
      if (match.stage === "group" || !match.advanced) continue;
      const loser = match.advanced === "home" ? match.away_team : match.home_team;
      if (!isPlaceholderTeam(loser)) {
        set.add(loser.toLowerCase());
      }
    }
    return set;
  }, [data.matches]);
  const payload = useMemo(() => formToPayload(form), [form]);
  const formErrors = useMemo(() => validatePayload(payload), [payload]);

  const championBonus = useMemo(
    () =>
      Object.fromEntries(
        SOURCES.map((source) => [source, championBonusForSource(championForm, source)]),
      ) as Record<Source, number>,
    [championForm],
  );

  function applyData(nextData: DashboardData, preferredMatchId = selectedMatchId) {
    setData(nextData);
    setChampionForm(championFormFromData(nextData));

    const nextSelected =
      preferredMatchId && nextData.matches.some((match) => match.id === preferredMatchId)
        ? preferredMatchId
        : defaultSidebarMatchId(nextData.matches);

    setSelectedMatchId(nextSelected);
    setForm(formFromMatch(nextData, nextSelected));
  }

  function selectMatch(matchId: string) {
    setSelectedMatchId(matchId);
    setForm(formFromMatch(data, matchId));
    setNotice(null);
  }

  function createNewMatch() {
    setSelectedMatchId(null);
    setForm(emptyForm());
    setNotice(null);
  }

  function updatePrediction(
    source: Source,
    updater: (prediction: EditablePrediction) => EditablePrediction,
  ) {
    setForm((current) => ({
      ...current,
      predictions: {
        ...current.predictions,
        [source]: updater(current.predictions[source]),
      },
    }));
  }

  function setPredictionPick(source: Source, pick: Pick) {
    updatePrediction(source, (prediction) => {
      const goals = goalsForPick(
        pick,
        prediction.pred_home_goals,
        prediction.pred_away_goals,
      );
      return {
        ...prediction,
        pick,
        pred_home_goals: goals.homeGoals,
        pred_away_goals: goals.awayGoals,
      };
    });
  }

  function setPredictionGoal(
    source: Source,
    field: "pred_home_goals" | "pred_away_goals",
    value: number,
  ) {
    updatePrediction(source, (prediction) => {
      const next = {
        ...prediction,
        [field]: Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0,
      };
      return {
        ...next,
        pick: pickFromScoreline(next.pred_home_goals, next.pred_away_goals),
      };
    });
  }

  async function refreshData() {
    setBusy("refresh");
    setNotice(null);

    try {
      const response = await fetch("/api/matches", { cache: "no-store" });
      const nextData = (await response.json()) as DashboardData | { error: string };

      if (!response.ok || "error" in nextData) {
        throw new Error("error" in nextData ? nextData.error : "Unable to refresh.");
      }

      applyData(nextData);
      setNotice({ tone: "good", text: "Data refreshed." });
    } catch (error) {
      setNotice({
        tone: "bad",
        text: error instanceof Error ? error.message : "Unable to refresh.",
      });
    } finally {
      setBusy("idle");
    }
  }

  async function syncMatches() {
    setBusy("sync");
    setNotice(null);
    setSyncResult(null);

    try {
      const response = await fetch("/api/sync-matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dates: "2026" }),
      });
      const result = (await response.json()) as SyncMatchesResponse | { error: string };

      if (!response.ok || "error" in result) {
        throw new Error("error" in result ? result.error : "Unable to sync ESPN.");
      }

      applyData(result.data);
      setSyncResult(result.result);
      setNotice({
        tone: result.result.errors.length > 0 ? "bad" : "good",
        text: `ESPN sync fetched ${result.result.fetched}, created ${result.result.created}, updated ${result.result.updated}.`,
      });
    } catch (error) {
      setNotice({
        tone: "bad",
        text: error instanceof Error ? error.message : "Unable to sync ESPN.",
      });
    } finally {
      setBusy("idle");
    }
  }

  async function saveMatch() {
    setNotice(null);

    if (formErrors.length > 0) {
      setNotice({ tone: "bad", text: formErrors.join(" ") });
      return;
    }

    setBusy("save");
    try {
      const response = await fetch("/api/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as SaveMatchResponse | { error: string };

      if (!response.ok || "error" in result) {
        throw new Error("error" in result ? result.error : "Unable to save match.");
      }

      applyData(result.data, result.matchId);
      setNotice({ tone: "good", text: "Saved." });
    } catch (error) {
      setNotice({
        tone: "bad",
        text: error instanceof Error ? error.message : "Unable to save match.",
      });
    } finally {
      setBusy("idle");
    }
  }

  async function saveChampion() {
    setBusy("champion");
    setNotice(null);

    const payload: SaveChampionPayload = {
      picks: championForm.picks,
      winner_team: championForm.winner_team.trim() || null,
    };

    try {
      const response = await fetch("/api/champion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as SaveChampionResponse | { error: string };

      if (!response.ok || "error" in result) {
        throw new Error("error" in result ? result.error : "Unable to save champion picks.");
      }

      applyData(result.data);
      setNotice({ tone: "good", text: "Champion picks saved." });
    } catch (error) {
      setNotice({
        tone: "bad",
        text: error instanceof Error ? error.message : "Unable to save champion picks.",
      });
    } finally {
      setBusy("idle");
    }
  }

  return (
    <main className="min-h-screen px-4 py-4 text-neutral-100 sm:px-6 lg:px-8">
      <header className="mb-4 flex flex-col gap-3 border-b border-neutral-800 pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            Beat the Model
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal text-neutral-50">
            Man v Model
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TabButton
            active={tab === "picks"}
            icon={<ClipboardList size={16} />}
            label="Picks"
            onClick={() => setTab("picks")}
          />
          <TabButton
            active={tab === "bracket"}
            icon={<GitBranch size={16} />}
            label="Bracket"
            onClick={() => setTab("bracket")}
          />
          <TabButton
            active={tab === "scoreboard"}
            icon={<Trophy size={16} />}
            label="Scoreboard"
            onClick={() => setTab("scoreboard")}
          />
          <TabButton
            active={tab === "champion"}
            icon={<Trophy size={16} />}
            label="Champion"
            onClick={() => setTab("champion")}
          />
          <button
            type="button"
            onClick={syncMatches}
            disabled={busy !== "idle"}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-700 px-3 text-sm text-emerald-100 transition hover:border-emerald-400 hover:bg-emerald-950/40 disabled:opacity-60"
            title="Sync ESPN matches and results"
          >
            <DownloadCloud size={16} />
            Sync ESPN
          </button>
          <button
            type="button"
            onClick={refreshData}
            disabled={busy !== "idle"}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-neutral-700 px-3 text-sm text-neutral-200 transition hover:border-neutral-500 hover:bg-neutral-800 disabled:opacity-60"
            title="Refresh"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
          {authControl}
        </div>
      </header>

      {notice ? (
        <div
          className={`mb-4 flex items-start gap-2 rounded-lg border p-3 text-sm ${
            notice.tone === "good"
              ? "border-emerald-800 bg-emerald-950/30 text-emerald-100"
              : "border-red-900 bg-red-950/30 text-red-100"
          }`}
        >
          {notice.tone === "good" ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
          <span>{notice.text}</span>
        </div>
      ) : null}

      {tab === "picks" ? (
        <PicksScreen
          data={data}
          selectedMatchId={selectedMatchId}
          form={form}
          formErrors={formErrors}
          busy={busy}
          syncResult={syncResult}
          onSelectMatch={selectMatch}
          onNewMatch={createNewMatch}
          onSave={saveMatch}
          onSync={syncMatches}
          onFormChange={setForm}
          onPickChange={setPredictionPick}
          onGoalChange={setPredictionGoal}
        />
      ) : null}

      {tab === "bracket" ? (
        <BracketScreen data={data} busy={busy} onSync={syncMatches} />
      ) : null}

      {tab === "scoreboard" ? (
        <ScoreboardScreen
          data={data}
          predictionByKey={predictionByKey}
          pointsByKey={pointsByKey}
          championBonus={championBonus}
          busy={busy}
          onSync={syncMatches}
        />
      ) : null}

      {tab === "champion" ? (
        <ChampionScreen
          form={championForm}
          teamOptions={teamOptions}
          eliminatedTeams={eliminatedTeams}
          championBonus={championBonus}
          busy={busy}
          onSave={saveChampion}
          onFormChange={setChampionForm}
        />
      ) : null}
    </main>
  );
}

function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition ${
        active
          ? "border-emerald-500 bg-emerald-500 text-neutral-950"
          : "border-neutral-700 text-neutral-200 hover:border-neutral-500 hover:bg-neutral-800"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function MatchListItem({
  match,
  selected,
  saved,
  onSelect,
}: {
  match: MatchRow;
  selected: boolean;
  saved: boolean;
  onSelect: () => void;
}) {
  const settled = match.result_90 !== null;
  const matchStatus = settled ? resultText(match) : saved ? "Saved" : "Open";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`mb-2 w-full rounded-lg border p-3 text-left transition ${
        selected
          ? "border-emerald-500 bg-emerald-950/30"
          : "border-neutral-800 bg-neutral-900/70 hover:border-neutral-600"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-neutral-400">
          {formatDate(match.kickoff_utc)} · {STAGE_LABELS[match.stage]}
          {match.group_name ? ` ${match.group_name}` : ""}
        </span>
        <span
          className={`rounded px-1.5 py-0.5 text-xs ${
            settled
              ? "bg-emerald-950 text-emerald-200"
              : saved
                ? "bg-sky-950 text-sky-200"
                : "bg-neutral-800 text-neutral-300"
          }`}
        >
          {matchStatus}
        </span>
      </div>
      <div className="mt-2 text-sm font-semibold text-neutral-100">{match.home_team}</div>
      <div className="text-sm text-neutral-400">{match.away_team}</div>
    </button>
  );
}

function PicksScreen({
  data,
  selectedMatchId,
  form,
  formErrors,
  busy,
  syncResult,
  onSelectMatch,
  onNewMatch,
  onSave,
  onSync,
  onFormChange,
  onPickChange,
  onGoalChange,
}: {
  data: DashboardData;
  selectedMatchId: string | null;
  form: MatchFormState;
  formErrors: string[];
  busy: BusyState;
  syncResult: SyncMatchesResponse["result"] | null;
  onSelectMatch: (matchId: string) => void;
  onNewMatch: () => void;
  onSave: () => void;
  onSync: () => void;
  onFormChange: React.Dispatch<React.SetStateAction<MatchFormState>>;
  onPickChange: (source: Source, pick: Pick) => void;
  onGoalChange: (
    source: Source,
    field: "pred_home_goals" | "pred_away_goals",
    value: number,
  ) => void;
}) {
  const [earlierExpanded, setEarlierExpanded] = useState(false);
  const savedMatchIds = useMemo(
    () =>
      new Set(
        data.predictions
          .filter(
            (prediction) =>
              prediction.pred_home_goals !== null &&
              prediction.pred_away_goals !== null,
          )
          .map((prediction) => prediction.match_id),
      ),
    [data.predictions],
  );
  const { primary, earlier } = useMemo(
    () => partitionMatchesForSidebar(data.matches),
    [data.matches],
  );

  return (
    <section className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <aside className={`${panelClass} overflow-hidden`}>
        <div className="flex items-center justify-between gap-2 border-b border-neutral-800 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CalendarDays size={16} className="text-emerald-300" />
            Matches
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onSync}
              disabled={busy !== "idle"}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-emerald-700 px-2.5 text-sm text-emerald-100 transition hover:border-emerald-500 hover:bg-emerald-950/30 disabled:opacity-60"
            >
              <DownloadCloud size={15} />
              ESPN
            </button>
            <button
              type="button"
              onClick={onNewMatch}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-neutral-700 px-2.5 text-sm text-neutral-200 transition hover:border-emerald-500 hover:bg-emerald-950/30"
            >
              <Plus size={15} />
              Add
            </button>
          </div>
        </div>
        {syncResult ? (
          <div className="border-b border-neutral-800 px-3 py-2 text-xs text-neutral-400">
            {syncResult.fetched} fetched, {syncResult.created} created,{" "}
            {syncResult.updated} updated
          </div>
        ) : null}
        <div className="max-h-[calc(100vh-190px)] overflow-y-auto p-2">
          {data.matches.length === 0 ? (
            <p className="p-3 text-sm text-neutral-400">No matches yet.</p>
          ) : (
            <>
              {primary.map((match) => (
                <MatchListItem
                  key={match.id}
                  match={match}
                  selected={selectedMatchId === match.id}
                  saved={savedMatchIds.has(match.id)}
                  onSelect={() => onSelectMatch(match.id)}
                />
              ))}
              {earlier.length > 0 ? (
                <div className="mt-1 border-t border-neutral-800 pt-2">
                  <button
                    type="button"
                    onClick={() => setEarlierExpanded((current) => !current)}
                    className="mb-2 flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs font-medium uppercase tracking-normal text-neutral-400 transition hover:bg-neutral-900/70 hover:text-neutral-200"
                  >
                    <span>Earlier matches ({earlier.length})</span>
                    <ChevronDown
                      size={14}
                      className={`transition ${earlierExpanded ? "rotate-180" : ""}`}
                    />
                  </button>
                  {earlierExpanded
                    ? earlier.map((match) => (
                        <MatchListItem
                          key={match.id}
                          match={match}
                          selected={selectedMatchId === match.id}
                          saved={savedMatchIds.has(match.id)}
                          onSelect={() => onSelectMatch(match.id)}
                        />
                      ))
                    : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </aside>

      <div className={`${panelClass} p-4`}>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm text-neutral-400">
              {form.id ? "Edit match" : "New match"}
            </p>
            <h2 className="text-xl font-semibold">
              {form.home_team || "Home"} v {form.away_team || "Away"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={busy !== "idle"}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            <Save size={17} />
            Save
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <Field label="Home team" className="xl:col-span-2">
            <input
              className={inputClass}
              value={form.home_team}
              onChange={(event) =>
                onFormChange((current) => ({ ...current, home_team: event.target.value }))
              }
            />
          </Field>
          <Field label="Away team" className="xl:col-span-2">
            <input
              className={inputClass}
              value={form.away_team}
              onChange={(event) =>
                onFormChange((current) => ({ ...current, away_team: event.target.value }))
              }
            />
          </Field>
          <Field label="Kickoff">
            <input
              className={inputClass}
              type="datetime-local"
              value={form.kickoff_local}
              onChange={(event) =>
                onFormChange((current) => ({
                  ...current,
                  kickoff_local: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Stage">
            <select
              className={inputClass}
              value={form.stage}
              onChange={(event) =>
                onFormChange((current) => ({
                  ...current,
                  stage: event.target.value as Stage,
                }))
              }
            >
              {STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {STAGE_LABELS[stage]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Group">
            <input
              className={inputClass}
              value={form.group_name}
              onChange={(event) =>
                onFormChange((current) => ({ ...current, group_name: event.target.value }))
              }
            />
          </Field>
          <Field label="Venue" className="md:col-span-2 xl:col-span-5">
            <input
              className={inputClass}
              value={form.venue}
              onChange={(event) =>
                onFormChange((current) => ({ ...current, venue: event.target.value }))
              }
            />
          </Field>
        </div>

        <div className="mt-5 grid gap-3 xl:grid-cols-3">
          {SOURCES.map((source) => (
            <PredictionCard
              key={source}
              source={source}
              prediction={form.predictions[source]}
              onPickChange={(pick) => onPickChange(source, pick)}
              onGoalChange={(field, value) => onGoalChange(source, field, value)}
            />
          ))}
        </div>

        {formErrors.length > 0 ? (
          <div className="mt-4 rounded-lg border border-amber-800 bg-amber-950/20 p-3 text-sm text-amber-100">
            {formErrors[0]}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className={labelClass}>{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function PredictionCard({
  source,
  prediction,
  onPickChange,
  onGoalChange,
}: {
  source: Source;
  prediction: EditablePrediction;
  onPickChange: (pick: Pick) => void;
  onGoalChange: (
    field: "pred_home_goals" | "pred_away_goals",
    value: number,
  ) => void;
}) {
  return (
    <div className={`rounded-lg border p-3 ${sourceAccent[source]}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className={`h-2.5 w-2.5 rounded-full ${sourceDot[source]}`} />
          {SOURCE_LABELS[source]}
        </div>
        <span className="rounded bg-neutral-950/70 px-2 py-1 font-mono text-xs text-neutral-300">
          {pickLabel(prediction.pick)}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1 rounded-md bg-neutral-950/50 p-1">
        {(["home", "draw", "away"] as Pick[]).map((pick) => (
          <button
            key={pick}
            type="button"
            onClick={() => onPickChange(pick)}
            className={`h-8 rounded text-sm transition ${
              prediction.pick === pick
                ? "bg-neutral-100 text-neutral-950"
                : "text-neutral-300 hover:bg-neutral-800"
            }`}
          >
            {pickLabel(pick)}
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Field label="Home goals">
          <input
            className={inputClass}
            type="number"
            min={0}
            value={prediction.pred_home_goals}
            onChange={(event) =>
              onGoalChange("pred_home_goals", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Away goals">
          <input
            className={inputClass}
            type="number"
            min={0}
            value={prediction.pred_away_goals}
            onChange={(event) =>
              onGoalChange("pred_away_goals", Number(event.target.value))
            }
          />
        </Field>
      </div>
    </div>
  );
}

function BracketScreen({
  data,
  busy,
  onSync,
}: {
  data: DashboardData;
  busy: BusyState;
  onSync: () => void;
}) {
  const [clientNowMs, setClientNowMs] = useState<number | null>(null);
  const nowMs = clientNowMs ?? 0;
  const matches = knockoutMatches(data.matches);
  const settledCount = matches.filter((match) => match.result_90 !== null).length;
  const liveCount = matches.filter((match) => isLiveWindow(match, nowMs)).length;
  const nextMatch = nextKnockoutMatch(data.matches, nowMs);
  const activeRound = activeBracketRound(matches);
  const finalMatch = matches.find((match) => match.stage === "final");
  const champion = finalMatch ? advancingTeam(finalMatch) : null;

  useEffect(() => {
    const updateNow = () => setClientNowMs(Date.now());
    updateNow();

    const interval = window.setInterval(updateNow, 30000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <section className="grid gap-4">
      <div className={`${panelClass} p-4`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm text-neutral-400">Knockout phase</p>
            <h2 className="text-xl font-semibold">Tournament bracket</h2>
          </div>
          <button
            type="button"
            onClick={onSync}
            disabled={busy !== "idle"}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-500 px-3 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            <DownloadCloud size={16} />
            Sync ESPN
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <BracketMetric
            label="Active round"
            value={activeRound?.label ?? "No knockout matches"}
          />
          <BracketMetric
            label="Live"
            value={liveCount > 0 ? `${liveCount} in window` : "None"}
          />
          <BracketMetric
            label="Settled"
            value={`${settledCount} / ${matches.length || 0}`}
          />
          <BracketMetric
            label={champion ? "Champion" : "Next match"}
            value={
              champion ??
              (nextMatch
                ? `${nextMatch.home_team} v ${nextMatch.away_team}`
                : matches.length > 0
                  ? "Awaiting schedule"
                  : "Awaiting sync")
            }
          />
        </div>
      </div>

      <div className={`${panelClass} overflow-hidden`}>
        {matches.length === 0 ? (
          <div className="p-5 text-sm text-neutral-400">
            No knockout matches have been synced yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex min-w-[1120px] gap-3 p-4">
              {BRACKET_ROUNDS.map((round) => {
                const roundMatches = sortMatchesByKickoff(
                  matches.filter((match) => match.stage === round.stage),
                );

                return (
                  <BracketRoundColumn
                    key={round.stage}
                    round={round}
                    matches={roundMatches}
                    nowMs={nowMs}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function BracketMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2">
      <div className="text-xs font-medium uppercase tracking-normal text-neutral-500">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-neutral-100">{value}</div>
    </div>
  );
}

function BracketRoundColumn({
  round,
  matches,
  nowMs,
}: {
  round: BracketRound;
  matches: MatchRow[];
  nowMs: number;
}) {
  return (
    <div className="min-w-[250px] flex-1">
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-neutral-800 pb-2">
        <div>
          <h3 className="text-sm font-semibold text-neutral-100">{round.label}</h3>
          <p className="text-xs text-neutral-500">
            {matches.length} / {round.expectedMatches}
          </p>
        </div>
        <span className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono text-xs text-neutral-400">
          {matches.filter((match) => match.result_90 !== null).length}
        </span>
      </div>

      <div className="grid gap-3">
        {matches.length === 0 ? (
          <div className="min-h-28 rounded-lg border border-dashed border-neutral-800 bg-neutral-950/40 p-3 text-sm text-neutral-500">
            Awaiting fixtures
          </div>
        ) : (
          matches.map((match, index) => (
            <BracketMatchCard
              key={match.id}
              match={match}
              index={index}
              nowMs={nowMs}
            />
          ))
        )}
      </div>
    </div>
  );
}

function BracketMatchCard({
  match,
  index,
  nowMs,
}: {
  match: MatchRow;
  index: number;
  nowMs: number;
}) {
  const winner = advancingSide(match);
  const live = isLiveWindow(match, nowMs);
  const final = match.result_90 !== null;
  const score =
    match.home_goals !== null && match.away_goals !== null ? resultText(match) : null;
  const feedLabel = bracketFeedLabel(match.stage, index);

  return (
    <div
      className={`relative rounded-lg border bg-neutral-950/70 p-3 ${
        live
          ? "border-emerald-500/80 ring-1 ring-emerald-400/30"
          : final
            ? "border-neutral-700"
            : "border-neutral-800"
      }`}
    >
      <div className="absolute left-full top-1/2 hidden h-px w-3 bg-neutral-700 xl:block" />
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-neutral-500">
          {formatDate(match.kickoff_utc)} · Match {index + 1}
        </span>
        <span
          className={`rounded px-1.5 py-0.5 ${
            live
              ? "bg-emerald-500 text-neutral-950"
              : final
                ? "bg-neutral-800 text-neutral-200"
                : "bg-neutral-900 text-neutral-400"
          }`}
        >
          {bracketStatus(match, nowMs)}
        </span>
      </div>

      <div className="mt-3 grid gap-1.5">
        <BracketTeamRow
          team={match.home_team}
          score={match.home_goals}
          winner={winner === "home"}
          dimmed={final && winner !== null && winner !== "home"}
        />
        <BracketTeamRow
          team={match.away_team}
          score={match.away_goals}
          winner={winner === "away"}
          dimmed={final && winner !== null && winner !== "away"}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
        <span className="truncate text-neutral-500">{feedLabel}</span>
        <span className="shrink-0 font-mono text-neutral-300">{score ?? "TBD"}</span>
      </div>
    </div>
  );
}

function BracketTeamRow({
  team,
  score,
  winner,
  dimmed,
}: {
  team: string;
  score: number | null;
  winner: boolean;
  dimmed: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_32px] items-center gap-2 rounded-md px-2 py-1.5 ${
        winner
          ? "bg-emerald-950/50 text-emerald-100"
          : dimmed
            ? "bg-neutral-950 text-neutral-500"
            : "bg-neutral-900/80 text-neutral-200"
      }`}
    >
      <span className="truncate text-sm font-medium">{team}</span>
      <span className="text-right font-mono text-sm">{score ?? "-"}</span>
    </div>
  );
}

function ScoreboardScreen({
  data,
  predictionByKey,
  pointsByKey,
  championBonus,
  busy,
  onSync,
}: {
  data: DashboardData;
  predictionByKey: Map<string, PredictionRow>;
  pointsByKey: Map<string, MatchPointsRow>;
  championBonus: Record<Source, number>;
  busy: BusyState;
  onSync: () => void;
}) {
  const settledMatches = data.matches.filter((match) => match.result_90 !== null);
  const sortedStandings = SOURCES.map<ScoreboardStanding>((source) => {
    const row = data.pointsLeaderboard.find(
      (leaderboard) => leaderboard.source === source,
    );
    const matchPoints = row?.points ?? 0;

    return {
      source,
      rank: 0,
      label: SOURCE_LABELS[source],
      matchPoints,
      championPoints: championBonus[source],
      total: matchPoints + championBonus[source],
      correct: row?.correct_picks ?? 0,
      exact: row?.exact_scores ?? 0,
      matchesScored: row?.matches_scored ?? 0,
    };
  }).sort((left, right) => {
    if (right.total !== left.total) return right.total - left.total;
    if (right.exact !== left.exact) return right.exact - left.exact;
    if (right.correct !== left.correct) return right.correct - left.correct;
    return SOURCES.indexOf(left.source) - SOURCES.indexOf(right.source);
  });
  let previousTotal: number | null = null;
  let previousRank = 0;
  const rankedStandings = sortedStandings.map((standing, index) => {
    const rank =
      previousTotal !== null && standing.total === previousTotal
        ? previousRank
        : index + 1;
    previousTotal = standing.total;
    previousRank = rank;
    return { ...standing, rank };
  });
  const leader = rankedStandings[0];
  const topPack = rankedStandings.filter((standing) => standing.total === leader.total);
  const leadMargin = Math.max(0, leader.total - (rankedStandings[1]?.total ?? 0));
  const leaderSummary =
    topPack.length > 1
      ? `${topPack.map((standing) => standing.label).join(" / ")} tied at ${leader.total}`
      : `${leader.label} leads by ${leadMargin}`;
  const maxTotal = Math.max(0, ...rankedStandings.map((standing) => standing.total));
  const podiumStandings: ScoreboardStanding[] = [
    rankedStandings[1],
    rankedStandings[0],
    rankedStandings[2],
  ].filter((standing): standing is ScoreboardStanding => Boolean(standing));

  return (
    <section className="grid gap-4">
      <div className={`${panelClass} p-4`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm text-neutral-400">Running points</p>
            <h2 className="text-xl font-semibold">Scoreboard</h2>
          </div>
          <button
            type="button"
            onClick={onSync}
            disabled={busy !== "idle"}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-500 px-3 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            <DownloadCloud size={16} />
            Sync ESPN
          </button>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-normal text-neutral-500">
                  Current leader
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold text-neutral-100">
                  <Trophy size={20} className="text-amber-200" />
                  <span>{leaderSummary}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-right sm:min-w-44">
                <ScoreMetric label="Settled" value={settledMatches.length} />
                <ScoreMetric label="Top score" value={leader.total} />
              </div>
            </div>

            <div className="mt-5 grid min-h-[230px] gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.18fr)_minmax(0,1fr)] md:items-end">
              {podiumStandings.map((standing, index) => (
                <PodiumSlot
                  key={standing.source}
                  standing={standing}
                  leaderTotal={leader.total}
                  placement={index === 1 ? "center" : index === 0 ? "left" : "right"}
                />
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-normal text-neutral-500">
                  Race view
                </p>
                <h3 className="mt-1 text-base font-semibold">Total points</h3>
              </div>
              <span className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono text-xs text-neutral-300">
                max {maxTotal}
              </span>
            </div>

            <div className="mt-4 grid gap-4">
              {rankedStandings.map((standing) => (
                <RaceBar
                  key={standing.source}
                  standing={standing}
                  leaderTotal={leader.total}
                  maxTotal={maxTotal}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <DriftPanel matches={data.matches} pointsLeaderboard={data.pointsLeaderboard} />

      <GoblinSays matches={data.matches} pointsLeaderboard={data.pointsLeaderboard} />

      <WormChart matchPoints={data.matchPoints} />

      <div className={`${panelClass} overflow-hidden`}>
        <div className="border-b border-neutral-800 p-4">
          <h2 className="text-lg font-semibold">Match breakdown</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead className="bg-neutral-900 text-left text-xs uppercase tracking-normal text-neutral-400">
              <tr>
                <th className="px-4 py-3">Match</th>
                <th className="px-4 py-3">Actual</th>
                {SOURCES.map((source) => (
                  <th key={source} className="px-4 py-3">
                    {SOURCE_LABELS[source]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {settledMatches.length === 0 ? (
                <tr>
                  <td className="px-4 py-5 text-neutral-400" colSpan={5}>
                    No settled matches.
                  </td>
                </tr>
              ) : (
                settledMatches.map((match) => (
                  <tr key={match.id} className="border-t border-neutral-800">
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-100">
                        {match.home_team} v {match.away_team}
                      </div>
                      <div className="text-xs text-neutral-500">
                        {formatKickoff(match.kickoff_utc)}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {resultText(match)} · {pickLabel(match.result_90)}
                    </td>
                    {SOURCES.map((source) => {
                      const prediction = predictionByKey.get(`${match.id}:${source}`);
                      const points = pointsByKey.get(`${match.id}:${source}`);
                      return (
                        <td key={source} className="px-4 py-3">
                          <div className="font-medium">
                            {pickLabel(points?.pick ?? predictionPick(prediction))}
                          </div>
                          <div className="font-mono text-xs text-neutral-400">
                            {predictionScore(prediction)} · {points?.points ?? 0} pts
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function PodiumSlot({
  standing,
  leaderTotal,
  placement,
}: {
  standing: ScoreboardStanding;
  leaderTotal: number;
  placement: "left" | "center" | "right";
}) {
  const gap = leaderTotal - standing.total;
  const isLeader = gap === 0;
  const orderClass = placement === "center" ? "order-first md:order-none" : "";

  return (
    <div className={`grid min-w-0 content-end gap-2 ${orderClass}`}>
      <div className="flex items-center justify-between gap-2 px-1 text-xs">
        <span className="rounded-md bg-neutral-900 px-2 py-1 font-mono font-semibold text-neutral-200">
          {rankLabel(standing.rank)}
        </span>
        <span className="text-neutral-400">{isLeader ? "Leader" : `${gap} back`}</span>
      </div>

      <div
        className={`relative flex ${podiumHeight(standing.rank)} flex-col justify-between overflow-hidden rounded-lg border p-3 ${sourceAccent[standing.source]} ${
          isLeader ? "ring-1 ring-amber-200/40" : ""
        }`}
      >
        <div className="flex items-center justify-between gap-2 text-sm font-semibold">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${sourceDot[standing.source]}`} />
            <span className="truncate">{standing.label}</span>
          </div>
          {standing.rank === 1 ? (
            <Trophy size={16} className="shrink-0 text-amber-200" />
          ) : null}
        </div>

        <div>
          <div className="font-mono text-4xl font-semibold text-neutral-100">
            {standing.total}
          </div>
          <div className="mt-1 text-xs text-neutral-400">
            {standing.matchPoints} match + {standing.championPoints} bonus
          </div>
        </div>
      </div>
    </div>
  );
}

function RaceBar({
  standing,
  leaderTotal,
  maxTotal,
}: {
  standing: ScoreboardStanding;
  leaderTotal: number;
  maxTotal: number;
}) {
  const width = maxTotal <= 0 ? 0 : Math.max(8, (standing.total / maxTotal) * 100);
  const gap = leaderTotal - standing.total;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${sourceDot[standing.source]}`} />
          <span className="truncate text-sm font-semibold">{standing.label}</span>
        </div>
        <div className="shrink-0 font-mono text-sm font-semibold">{standing.total}</div>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-900">
        <div
          className={`h-full rounded-full ${sourceDot[standing.source]}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400">
        <span>
          {standing.correct} correct / {standing.exact} exact
        </span>
        <span>
          {standing.matchPoints} match + {standing.championPoints} bonus
          {gap > 0 ? ` · ${gap} back` : ""}
        </span>
      </div>
    </div>
  );
}

function ScoreMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2">
      <div className="font-mono text-base text-neutral-100">{value}</div>
      <div className="text-xs text-neutral-400">{label}</div>
    </div>
  );
}

function rankLabel(rank: number) {
  if (rank === 1) return "1st";
  if (rank === 2) return "2nd";
  if (rank === 3) return "3rd";
  return `${rank}th`;
}

function podiumHeight(rank: number) {
  if (rank === 1) return "h-40";
  if (rank === 2) return "h-32";
  return "h-28";
}

function ChampionScreen({
  form,
  teamOptions,
  eliminatedTeams,
  championBonus,
  busy,
  onSave,
  onFormChange,
}: {
  form: ChampionFormState;
  teamOptions: string[];
  eliminatedTeams: Set<string>;
  championBonus: Record<Source, number>;
  busy: BusyState;
  onSave: () => void;
  onFormChange: React.Dispatch<React.SetStateAction<ChampionFormState>>;
}) {
  function updatePick(source: Source, index: number, value: string) {
    onFormChange((current) => ({
      ...current,
      picks: {
        ...current.picks,
        [source]: current.picks[source].map((team, teamIndex) =>
          teamIndex === index ? value : team,
        ),
      },
    }));
  }

  function isEliminated(teamName: string) {
    return teamName.trim().length > 0 && eliminatedTeams.has(teamName.trim().toLowerCase());
  }

  return (
    <section className="grid gap-4">
      <div className={`${panelClass} p-4`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm text-neutral-400">Tournament winner bonus</p>
            <h2 className="text-xl font-semibold">Champion</h2>
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={busy !== "idle"}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            <Save size={17} />
            Save champion
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_260px]">
          <Field label="Tournament winner">
            <input
              className={inputClass}
              list="champion-team-options"
              value={form.winner_team}
              onChange={(event) =>
                onFormChange((current) => ({
                  ...current,
                  winner_team: event.target.value,
                }))
              }
            />
          </Field>
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
            <div className="text-xs uppercase tracking-normal text-neutral-400">
              Current bonuses
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
              {SOURCES.map((source) => (
                <div key={source}>
                  <div className="font-mono text-lg">{championBonus[source]}</div>
                  <div className="text-xs text-neutral-400">{SOURCE_LABELS[source]}</div>
                </div>
              ))}
            </div>
          </div>
          <datalist id="champion-team-options">
            {teamOptions.map((team) => (
              <option key={team} value={team} />
            ))}
          </datalist>
        </div>
      </div>

      {eliminatedTeams.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-400">
          <XCircle size={13} className="shrink-0" />
          Eliminated teams are highlighted in red.
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-3">
        {SOURCES.map((source) => (
          <div key={source} className={`rounded-lg border p-3 ${sourceAccent[source]}`}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className={`h-2.5 w-2.5 rounded-full ${sourceDot[source]}`} />
              {SOURCE_LABELS[source]}
            </div>
            <div className="mt-3 space-y-2">
              {Array.from({ length: 10 }, (_, index) => {
                const teamName = form.picks[source][index] ?? "";
                const eliminated = isEliminated(teamName);
                return (
                  <label
                    key={index}
                    className="grid grid-cols-[42px_minmax(0,1fr)_20px_42px] items-center gap-2"
                  >
                    <span className={`font-mono text-xs ${eliminated ? "text-red-400" : "text-neutral-400"}`}>
                      #{index + 1}
                    </span>
                    <input
                      className={`${inputClass} ${eliminated ? "border-red-500/60 bg-red-950/20 text-red-300" : ""}`}
                      list="champion-team-options"
                      value={teamName}
                      onChange={(event) => updatePick(source, index, event.target.value)}
                    />
                    <span className="flex items-center justify-center">
                      {eliminated && (
                        <XCircle size={14} className="text-red-500" aria-label="Eliminated" />
                      )}
                    </span>
                    <span className={`text-right font-mono text-xs ${eliminated ? "text-red-500/60 line-through" : "text-neutral-400"}`}>
                      {championPointsForRank(index + 1)}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
