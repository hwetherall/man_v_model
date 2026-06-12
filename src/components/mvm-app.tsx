"use client";

import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FlaskConical,
  Plus,
  RefreshCw,
  Save,
  Trophy,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  REASON_CODES,
  REASON_LABELS,
  SOURCE_LABELS,
  SOURCES,
  STAGE_LABELS,
  STAGES,
  type AppShellProps,
  type DashboardData,
  type DeviationInput,
  type MatchRow,
  type Pick,
  type PredictionInput,
  type PredictionRow,
  type ReasonCode,
  type SaveMatchPayload,
  type Source,
  type Stage,
} from "@/lib/types";
import {
  differsFromModel,
  goalsForPick,
  pickFromProbabilities,
  pickFromScoreline,
  probabilitySum,
  validatePrediction,
} from "@/lib/validation";

type Tab = "picks" | "scoreboard" | "theses";
type BusyState = "idle" | "save" | "refresh" | "settle";

type EditablePrediction = {
  pick: Pick;
  pred_home_goals: number;
  pred_away_goals: number;
  p_home: string;
  p_draw: string;
  p_away: string;
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
  deviation: {
    reason_code: ReasonCode;
    thesis_tag: string;
    magnitude: number;
    note: string;
  };
};

type SaveResponse = {
  data: DashboardData;
  matchId: string;
};

type SettleResponse = {
  data: DashboardData;
  result: {
    settled: Array<{ matchId: string; externalRef: string; match: string; score: string }>;
    unmatched: Array<{ externalRef: string; match: string; score: string; reason: string }>;
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

function nowLocalInput() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function todayDateInput() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
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
    p_home: "",
    p_draw: "",
    p_away: "",
  };
}

function parseProbability(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number(trimmed);
}

function editableToInput(prediction: EditablePrediction): PredictionInput {
  return {
    pick: prediction.pick,
    pred_home_goals: prediction.pred_home_goals,
    pred_away_goals: prediction.pred_away_goals,
    p_home: parseProbability(prediction.p_home),
    p_draw: parseProbability(prediction.p_draw),
    p_away: parseProbability(prediction.p_away),
  };
}

function pickFromPredictionRow(row: PredictionRow, homeGoals: number, awayGoals: number) {
  const scorePick = pickFromScoreline(homeGoals, awayGoals);
  const input: PredictionInput = {
    pick: scorePick,
    pred_home_goals: homeGoals,
    pred_away_goals: awayGoals,
    p_home: row.p_home,
    p_draw: row.p_draw,
    p_away: row.p_away,
  };

  return pickFromProbabilities(input) ?? scorePick;
}

function predictionFromRow(row: PredictionRow | undefined): EditablePrediction {
  if (!row) return emptyPrediction();

  const fallbackPick =
    row.p_home !== null && row.p_draw !== null && row.p_away !== null
      ? row.p_home >= row.p_draw && row.p_home >= row.p_away
        ? "home"
        : row.p_away >= row.p_draw && row.p_away >= row.p_home
          ? "away"
          : "draw"
      : "home";
  const fallbackGoals = defaultGoals(fallbackPick);
  const homeGoals = row.pred_home_goals ?? fallbackGoals.homeGoals;
  const awayGoals = row.pred_away_goals ?? fallbackGoals.awayGoals;
  const pick = pickFromPredictionRow(row, homeGoals, awayGoals);

  return {
    pick,
    pred_home_goals: homeGoals,
    pred_away_goals: awayGoals,
    p_home: row.p_home === null ? "" : String(row.p_home),
    p_draw: row.p_draw === null ? "" : String(row.p_draw),
    p_away: row.p_away === null ? "" : String(row.p_away),
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
    deviation: {
      reason_code: "thesis",
      thesis_tag: "",
      magnitude: 0.05,
      note: "",
    },
  };
}

function formFromMatch(data: DashboardData, matchId: string | null): MatchFormState {
  if (!matchId) return emptyForm();

  const match = data.matches.find((candidate) => candidate.id === matchId);
  if (!match) return emptyForm();

  const deviation = data.deviations.find((candidate) => candidate.match_id === match.id);

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
    deviation: {
      reason_code: deviation?.reason_code ?? "thesis",
      thesis_tag: deviation?.thesis_tag ?? "",
      magnitude: deviation?.magnitude ?? 0.05,
      note: deviation?.note ?? "",
    },
  };
}

function formToPayload(form: MatchFormState): SaveMatchPayload {
  const predictions = {
    crowd: editableToInput(form.predictions.crowd),
    pele: editableToInput(form.predictions.pele),
    harry: editableToInput(form.predictions.harry),
  };
  const deviation: DeviationInput | null = differsFromModel(
    predictions.pele,
    predictions.harry,
  )
    ? {
        reason_code: form.deviation.reason_code,
        thesis_tag: form.deviation.thesis_tag.trim() || null,
        magnitude: form.deviation.magnitude,
        note: form.deviation.note,
      }
    : null;

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
    predictions,
    deviation,
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

  if (payload.deviation) {
    if (!payload.deviation.note.trim()) errors.push("Deviation note is required.");
    if (payload.deviation.magnitude < 0 || payload.deviation.magnitude > 1) {
      errors.push("Deviation magnitude must be between 0 and 1.");
    }
  }

  return errors;
}

function formatKickoff(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function pickLabel(pick: Pick | null | undefined) {
  if (pick === "home") return "Home";
  if (pick === "away") return "Away";
  if (pick === "draw") return "Draw";
  return "Unset";
}

function resultText(match: MatchRow) {
  if (match.home_goals === null || match.away_goals === null) return "Open";
  return `${match.home_goals}-${match.away_goals}`;
}

function predictionPick(prediction: PredictionRow | undefined) {
  if (!prediction) return null;
  const homeGoals = prediction.pred_home_goals ?? 0;
  const awayGoals = prediction.pred_away_goals ?? 0;
  return pickFromPredictionRow(prediction, homeGoals, awayGoals);
}

function predictionScore(prediction: PredictionRow | undefined) {
  if (!prediction) return "—";
  if (
    prediction.pred_home_goals === null ||
    prediction.pred_away_goals === null
  ) {
    return "—";
  }

  return `${prediction.pred_home_goals}-${prediction.pred_away_goals}`;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function numberText(value: number | null) {
  return value === null ? "—" : value.toFixed(3);
}

export function MvmApp({ initialData, authControl }: AppShellProps) {
  const [data, setData] = useState(initialData);
  const [tab, setTab] = useState<Tab>("picks");
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(
    initialData.matches[0]?.id ?? null,
  );
  const [form, setForm] = useState<MatchFormState>(() =>
    formFromMatch(initialData, initialData.matches[0]?.id ?? null),
  );
  const [busy, setBusy] = useState<BusyState>("idle");
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(
    null,
  );
  const [settleDate, setSettleDate] = useState(todayDateInput);
  const [settleResult, setSettleResult] = useState<SettleResponse["result"] | null>(null);

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
  const scoreByKey = useMemo(
    () =>
      new Map(
        data.predictionScores.map((score) => [`${score.match_id}:${score.source}`, score]),
      ),
    [data.predictionScores],
  );
  const thesisTags = useMemo(
    () =>
      Array.from(
        new Set(
          data.deviations
            .map((deviation) => deviation.thesis_tag?.trim())
            .filter((tag): tag is string => Boolean(tag)),
        ),
      ).sort(),
    [data.deviations],
  );

  const payload = useMemo(() => formToPayload(form), [form]);
  const formErrors = useMemo(() => validatePayload(payload), [payload]);
  const deviationRequired = payload.deviation !== null;

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

  function setPredictionProbability(
    source: Source,
    field: "p_home" | "p_draw" | "p_away",
    value: string,
  ) {
    updatePrediction(source, (prediction) => {
      const next = { ...prediction, [field]: value };
      const input = editableToInput(next);
      const probabilityPick = pickFromProbabilities(input);

      if (!probabilityPick) return next;

      const goals = goalsForPick(
        probabilityPick,
        next.pred_home_goals,
        next.pred_away_goals,
      );
      return {
        ...next,
        pick: probabilityPick,
        pred_home_goals: goals.homeGoals,
        pred_away_goals: goals.awayGoals,
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

      setData(nextData);
      setForm(formFromMatch(nextData, selectedMatchId));
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
      const result = (await response.json()) as SaveResponse | { error: string };

      if (!response.ok || "error" in result) {
        throw new Error("error" in result ? result.error : "Unable to save match.");
      }

      setData(result.data);
      setSelectedMatchId(result.matchId);
      setForm(formFromMatch(result.data, result.matchId));
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

  async function settleMatches() {
    setBusy("settle");
    setNotice(null);
    setSettleResult(null);

    try {
      const response = await fetch("/api/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: settleDate }),
      });
      const result = (await response.json()) as SettleResponse | { error: string };

      if (!response.ok || "error" in result) {
        throw new Error("error" in result ? result.error : "Unable to settle.");
      }

      setData(result.data);
      setSettleResult(result.result);
      setForm(formFromMatch(result.data, selectedMatchId));
      setNotice({
        tone: result.result.unmatched.length > 0 ? "bad" : "good",
        text: `${result.result.settled.length} settled, ${result.result.unmatched.length} unmatched.`,
      });
    } catch (error) {
      setNotice({
        tone: "bad",
        text: error instanceof Error ? error.message : "Unable to settle.",
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
            active={tab === "scoreboard"}
            icon={<Trophy size={16} />}
            label="Scoreboard"
            onClick={() => setTab("scoreboard")}
          />
          <TabButton
            active={tab === "theses"}
            icon={<FlaskConical size={16} />}
            label="Theses"
            onClick={() => setTab("theses")}
          />
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
          deviationRequired={deviationRequired}
          thesisTags={thesisTags}
          busy={busy}
          onSelectMatch={selectMatch}
          onNewMatch={createNewMatch}
          onSave={saveMatch}
          onFormChange={setForm}
          onPickChange={setPredictionPick}
          onGoalChange={setPredictionGoal}
          onProbabilityChange={setPredictionProbability}
        />
      ) : null}

      {tab === "scoreboard" ? (
        <ScoreboardScreen
          data={data}
          predictionByKey={predictionByKey}
          pointsByKey={pointsByKey}
          settleDate={settleDate}
          settleResult={settleResult}
          busy={busy}
          onDateChange={setSettleDate}
          onSettle={settleMatches}
        />
      ) : null}

      {tab === "theses" ? (
        <ThesesScreen
          data={data}
          matchById={matchById}
          pointsByKey={pointsByKey}
          scoreByKey={scoreByKey}
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

function PicksScreen({
  data,
  selectedMatchId,
  form,
  formErrors,
  deviationRequired,
  thesisTags,
  busy,
  onSelectMatch,
  onNewMatch,
  onSave,
  onFormChange,
  onPickChange,
  onGoalChange,
  onProbabilityChange,
}: {
  data: DashboardData;
  selectedMatchId: string | null;
  form: MatchFormState;
  formErrors: string[];
  deviationRequired: boolean;
  thesisTags: string[];
  busy: BusyState;
  onSelectMatch: (matchId: string) => void;
  onNewMatch: () => void;
  onSave: () => void;
  onFormChange: React.Dispatch<React.SetStateAction<MatchFormState>>;
  onPickChange: (source: Source, pick: Pick) => void;
  onGoalChange: (
    source: Source,
    field: "pred_home_goals" | "pred_away_goals",
    value: number,
  ) => void;
  onProbabilityChange: (
    source: Source,
    field: "p_home" | "p_draw" | "p_away",
    value: string,
  ) => void;
}) {
  return (
    <section className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className={`${panelClass} overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-neutral-800 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CalendarDays size={16} className="text-emerald-300" />
            Matches
          </div>
          <button
            type="button"
            onClick={onNewMatch}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-neutral-700 px-2.5 text-sm text-neutral-200 transition hover:border-emerald-500 hover:bg-emerald-950/30"
          >
            <Plus size={15} />
            Add
          </button>
        </div>
        <div className="max-h-[calc(100vh-168px)] overflow-y-auto p-2">
          {data.matches.length === 0 ? (
            <p className="p-3 text-sm text-neutral-400">No matches yet.</p>
          ) : (
            data.matches.map((match) => (
              <button
                key={match.id}
                type="button"
                onClick={() => onSelectMatch(match.id)}
                className={`mb-2 w-full rounded-lg border p-3 text-left transition ${
                  selectedMatchId === match.id
                    ? "border-emerald-500 bg-emerald-950/30"
                    : "border-neutral-800 bg-neutral-900/70 hover:border-neutral-600"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-neutral-400">
                    {formatDate(match.kickoff_utc)} · {STAGE_LABELS[match.stage]}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      match.result_90
                        ? "bg-emerald-950 text-emerald-200"
                        : "bg-neutral-800 text-neutral-300"
                    }`}
                  >
                    {resultText(match)}
                  </span>
                </div>
                <div className="mt-2 text-sm font-semibold text-neutral-100">
                  {match.home_team}
                </div>
                <div className="text-sm text-neutral-400">{match.away_team}</div>
              </button>
            ))
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
              onProbabilityChange={(field, value) =>
                onProbabilityChange(source, field, value)
              }
            />
          ))}
        </div>

        {deviationRequired ? (
          <div className="mt-4 rounded-lg border border-red-800 bg-red-950/20 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-200">
              <AlertTriangle size={16} />
              Deviation required
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-[180px_180px_140px_minmax(0,1fr)]">
              <Field label="Reason">
                <select
                  className={inputClass}
                  value={form.deviation.reason_code}
                  onChange={(event) =>
                    onFormChange((current) => ({
                      ...current,
                      deviation: {
                        ...current.deviation,
                        reason_code: event.target.value as ReasonCode,
                      },
                    }))
                  }
                >
                  {REASON_CODES.map((reason) => (
                    <option key={reason} value={reason}>
                      {REASON_LABELS[reason]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Thesis tag">
                <input
                  className={inputClass}
                  list="thesis-tags"
                  value={form.deviation.thesis_tag}
                  onChange={(event) =>
                    onFormChange((current) => ({
                      ...current,
                      deviation: {
                        ...current.deviation,
                        thesis_tag: event.target.value,
                      },
                    }))
                  }
                />
                <datalist id="thesis-tags">
                  {thesisTags.map((tag) => (
                    <option key={tag} value={tag} />
                  ))}
                </datalist>
              </Field>
              <Field label="Magnitude">
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={form.deviation.magnitude}
                  onChange={(event) =>
                    onFormChange((current) => ({
                      ...current,
                      deviation: {
                        ...current.deviation,
                        magnitude: Number(event.target.value),
                      },
                    }))
                  }
                />
              </Field>
              <Field label="Note">
                <textarea
                  className="min-h-9 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none transition placeholder:text-neutral-600 focus:border-emerald-400"
                  value={form.deviation.note}
                  onChange={(event) =>
                    onFormChange((current) => ({
                      ...current,
                      deviation: { ...current.deviation, note: event.target.value },
                    }))
                  }
                />
              </Field>
            </div>
          </div>
        ) : null}

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
  onProbabilityChange,
}: {
  source: Source;
  prediction: EditablePrediction;
  onPickChange: (pick: Pick) => void;
  onGoalChange: (
    field: "pred_home_goals" | "pred_away_goals",
    value: number,
  ) => void;
  onProbabilityChange: (field: "p_home" | "p_draw" | "p_away", value: string) => void;
}) {
  const input = editableToInput(prediction);
  const sum = probabilitySum(input);
  const probabilityPick = pickFromProbabilities(input);

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

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Field label="P home">
          <input
            className={inputClass}
            inputMode="decimal"
            value={prediction.p_home}
            onChange={(event) => onProbabilityChange("p_home", event.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Field label="P draw">
          <input
            className={inputClass}
            inputMode="decimal"
            value={prediction.p_draw}
            onChange={(event) => onProbabilityChange("p_draw", event.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Field label="P away">
          <input
            className={inputClass}
            inputMode="decimal"
            value={prediction.p_away}
            onChange={(event) => onProbabilityChange("p_away", event.target.value)}
            placeholder="0.00"
          />
        </Field>
      </div>

      <div className="mt-3 flex min-h-5 items-center justify-between text-xs text-neutral-400">
        <span>{sum === null ? "No Brier input" : `Sum ${sum.toFixed(3)}`}</span>
        <span>{probabilityPick ? `Argmax ${pickLabel(probabilityPick)}` : ""}</span>
      </div>
    </div>
  );
}

function ScoreboardScreen({
  data,
  predictionByKey,
  pointsByKey,
  settleDate,
  settleResult,
  busy,
  onDateChange,
  onSettle,
}: {
  data: DashboardData;
  predictionByKey: Map<string, PredictionRow>;
  pointsByKey: Map<string, { points: number; pick: Pick }>;
  settleDate: string;
  settleResult: SettleResponse["result"] | null;
  busy: BusyState;
  onDateChange: (value: string) => void;
  onSettle: () => void;
}) {
  const settledMatches = data.matches.filter((match) => match.result_90 !== null);

  return (
    <section className="grid gap-4">
      <div className={`${panelClass} p-4`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm text-neutral-400">Running points</p>
            <h2 className="text-xl font-semibold">Scoreboard</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="h-9 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none transition focus:border-emerald-400"
              type="date"
              value={settleDate}
              onChange={(event) => onDateChange(event.target.value)}
            />
            <button
              type="button"
              onClick={onSettle}
              disabled={busy !== "idle"}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-500 px-3 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60"
            >
              <RefreshCw size={16} />
              Settle results
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {SOURCES.map((source) => {
            const row = data.pointsLeaderboard.find(
              (leaderboard) => leaderboard.source === source,
            );
            return (
              <div key={source} className={`rounded-lg border p-4 ${sourceAccent[source]}`}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className={`h-2.5 w-2.5 rounded-full ${sourceDot[source]}`} />
                  {SOURCE_LABELS[source]}
                </div>
                <div className="mt-3 font-mono text-4xl font-semibold">
                  {row?.points ?? 0}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-neutral-300">
                  <Metric label="Scored" value={row?.matches_scored ?? 0} />
                  <Metric label="Correct" value={row?.correct_picks ?? 0} />
                  <Metric label="Exact" value={row?.exact_scores ?? 0} />
                </div>
              </div>
            );
          })}
        </div>

        {settleResult ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <SettleList
              title="Settled"
              rows={settleResult.settled.map((row) => ({
                key: row.externalRef,
                text: `${row.match} ${row.score}`,
              }))}
            />
            <SettleList
              title="Unmatched"
              rows={settleResult.unmatched.map((row) => ({
                key: row.externalRef,
                text: `${row.match} ${row.score} · ${row.reason}`,
              }))}
            />
          </div>
        ) : null}
      </div>

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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-mono text-base text-neutral-100">{value}</div>
      <div>{label}</div>
    </div>
  );
}

function SettleList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; text: string }>;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-3">
      <div className="text-sm font-semibold">{title}</div>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">None.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm text-neutral-300">
          {rows.map((row) => (
            <li key={row.key}>{row.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ThesesScreen({
  data,
  matchById,
  pointsByKey,
  scoreByKey,
}: {
  data: DashboardData;
  matchById: Map<string, MatchRow>;
  pointsByKey: Map<string, { points: number }>;
  scoreByKey: Map<string, { brier: number | null }>;
}) {
  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        tag: string;
        deviations: typeof data.deviations;
        harryPoints: number;
        modelPoints: number;
        harryBrier: number[];
        modelBrier: number[];
      }
    >();

    for (const deviation of data.deviations) {
      const tag =
        deviation.thesis_tag?.trim() ||
        (deviation.reason_code === "thesis"
          ? "untagged thesis"
          : REASON_LABELS[deviation.reason_code]);
      const group =
        map.get(tag) ??
        {
          tag,
          deviations: [],
          harryPoints: 0,
          modelPoints: 0,
          harryBrier: [],
          modelBrier: [],
        };

      group.deviations.push(deviation);
      group.harryPoints += pointsByKey.get(`${deviation.match_id}:harry`)?.points ?? 0;
      group.modelPoints += pointsByKey.get(`${deviation.match_id}:pele`)?.points ?? 0;

      const harryBrier = scoreByKey.get(`${deviation.match_id}:harry`)?.brier;
      const modelBrier = scoreByKey.get(`${deviation.match_id}:pele`)?.brier;
      if (harryBrier !== null && harryBrier !== undefined) {
        group.harryBrier.push(harryBrier);
      }
      if (modelBrier !== null && modelBrier !== undefined) {
        group.modelBrier.push(modelBrier);
      }

      map.set(tag, group);
    }

    return Array.from(map.values()).sort(
      (a, b) => b.deviations.length - a.deviations.length,
    );
  }, [data.deviations, pointsByKey, scoreByKey]);

  return (
    <section className={`${panelClass} overflow-hidden`}>
      <div className="border-b border-neutral-800 p-4">
        <p className="text-sm text-neutral-400">Private lab notebook</p>
        <h2 className="text-xl font-semibold">Theses tracker</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead className="bg-neutral-900 text-left text-xs uppercase tracking-normal text-neutral-400">
            <tr>
              <th className="px-4 py-3">Thesis</th>
              <th className="px-4 py-3">Matches</th>
              <th className="px-4 py-3">Me pts</th>
              <th className="px-4 py-3">Model pts</th>
              <th className="px-4 py-3">Me Brier</th>
              <th className="px-4 py-3">Model Brier</th>
              <th className="px-4 py-3">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 ? (
              <tr>
                <td className="px-4 py-5 text-neutral-400" colSpan={7}>
                  No deviations yet.
                </td>
              </tr>
            ) : (
              groups.map((group) => {
                const harryBrier = average(group.harryBrier);
                const modelBrier = average(group.modelBrier);
                const scored = group.harryPoints + group.modelPoints > 0;
                const verdict =
                  !scored && harryBrier === null
                    ? "Pending"
                    : group.harryPoints > group.modelPoints ||
                        (harryBrier !== null &&
                          modelBrier !== null &&
                          harryBrier < modelBrier)
                      ? "Earning"
                      : group.harryPoints < group.modelPoints ||
                          (harryBrier !== null &&
                            modelBrier !== null &&
                            harryBrier > modelBrier)
                        ? "Needs proof"
                        : "Even";

                return (
                  <tr key={group.tag} className="border-t border-neutral-800 align-top">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-neutral-100">{group.tag}</div>
                      <div className="mt-1 text-xs text-neutral-500">
                        {group.deviations.length} invocation
                        {group.deviations.length === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-2">
                        {group.deviations.map((deviation) => {
                          const match = matchById.get(deviation.match_id);
                          return (
                            <div key={deviation.id}>
                              <div className="font-medium">
                                {match
                                  ? `${match.home_team} v ${match.away_team}`
                                  : deviation.match_id}
                              </div>
                              <div className="text-xs text-neutral-500">
                                {REASON_LABELS[deviation.reason_code]} ·{" "}
                                {deviation.magnitude.toFixed(2)}
                              </div>
                              {deviation.note ? (
                                <div className="mt-1 max-w-xl text-xs leading-5 text-neutral-400">
                                  {deviation.note}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono">{group.harryPoints}</td>
                    <td className="px-4 py-3 font-mono">{group.modelPoints}</td>
                    <td className="px-4 py-3 font-mono">{numberText(harryBrier)}</td>
                    <td className="px-4 py-3 font-mono">{numberText(modelBrier)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded px-2 py-1 text-xs ${
                          verdict === "Earning"
                            ? "bg-emerald-950 text-emerald-200"
                            : verdict === "Needs proof"
                              ? "bg-red-950 text-red-200"
                              : "bg-neutral-800 text-neutral-300"
                        }`}
                      >
                        {verdict}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
