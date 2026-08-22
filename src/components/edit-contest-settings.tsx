"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateContestSettingsAction,
  type ContestActionState,
} from "@/app/actions/contest";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminSwitchField } from "@/components/admin-switch-field";
import { BirthdayOffsetFields } from "@/components/birthday-offset-fields";
import {
  CHART_COUNTRY_OPTIONS,
  CONTEST_CHART_COUNTRIES,
  type ChartCountry,
} from "@/lib/charts";
import type { BirthdayOffsetUnit } from "@/lib/birthday-offset";
import { datetimeLocalToIso, isoToDatetimeLocal } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { ADMIN_SELECT_CLASS, ADMIN_RADIO_CLASS, ADMIN_CHECKBOX_CLASS, adminOptionCardClass, ADMIN_HIGHLIGHT_PANEL_CLASS } from "@/lib/admin-ui";
import {
  CANDIDATE_REVEALS,
  CANDIDATE_SORT_OPTIONS,
  CANDIDATE_SOURCES,
  CONTEST_TYPE_OPTIONS,
  RESULTS_REVEAL_OPTIONS,
  BALLOT_REVEAL_ORDER_OPTIONS,
  SONG_LINKS_OPTIONS,
  SCORING_MODELS,
  VOTE_MUTABILITY_OPTIONS,
  NOMINATOR_RANKING_WHEN_OPTIONS,
  NOMINATOR_RESULTS_REVEAL_OPTIONS,
  clampNominationsForPlan,
  contestTypeIdFromTheme,
  getPlanLimits,
  isCuratedBirthdayContest,
  isStarRatingModel,
  allowsNominatorRanking,
  parseCandidateSort,
  type BallotRevealOrder,
  type CandidateReveal,
  type CandidateSort,
  type CandidateSource,
  type ContestTheme,
  type ContestTypeId,
  type NominationKind,
  type NominatorRankingWhen,
  type NominatorResultsReveal,
  type PlanId,
  type ResultsReveal,
  type ScoringModelId,
  type SongLinksMode,
  type VoteMutability,
  type VotingCloseMode,
} from "@/lib/plans";

const initialState: ContestActionState = null;

export type EditableContestSettings = {
  id: string;
  joinCode: string;
  title: string;
  description: string | null;
  theme: ContestTheme;
  candidateSource: CandidateSource;
  maxNominationsPerParticipant: number | null;
  allowDuplicateCandidates: boolean;
  hostParticipates: boolean;
  nominationDeadline: string | null;
  candidateReveal: CandidateReveal;
  candidateSort: CandidateSort;
  voteMutability: VoteMutability;
  votingCloseMode: VotingCloseMode;
  votingClosesAt: string | null;
  scoringModel: ScoringModelId;
  showStarPoints?: boolean;
  showNominees?: boolean;
  resultsReveal: ResultsReveal;
  ballotRevealOrder: BallotRevealOrder;
  nominatorRanking: boolean;
  nominatorRankingWhen: NominatorRankingWhen;
  nominatorResultsReveal: NominatorResultsReveal;
  allowVoteOwnNominations: boolean;
  nominationsOpen: boolean;
  status: string;
  nominationKind: NominationKind;
  chartCountry: ChartCountry;
  songLinks: SongLinksMode;
  candidateTitle?: string;
  birthdayOffsetAmount?: number;
  birthdayOffsetUnit?: BirthdayOffsetUnit;
};

type EditContestSettingsProps = {
  contest: EditableContestSettings;
  planId?: PlanId;
};

export function EditContestSettings({
  contest,
  planId = "free",
}: EditContestSettingsProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    updateContestSettingsAction,
    initialState,
  );
  const plan = getPlanLimits(planId);
  const locked = contest.status === "finished" || contest.status === "expired";

  const [title, setTitle] = useState(contest.title);
  const [description, setDescription] = useState(contest.description ?? "");
  const [theme, setTheme] = useState<ContestTheme>(contest.theme);
  const [contestType, setContestType] = useState<ContestTypeId>(
    contestTypeIdFromTheme(contest.theme),
  );
  const [hostParticipates, setHostParticipates] = useState(contest.hostParticipates);
  const [candidateSource, setCandidateSource] = useState(contest.candidateSource);
  const [maxNominations, setMaxNominations] = useState(
    contest.maxNominationsPerParticipant ?? 1,
  );
  const [allowDuplicates, setAllowDuplicates] = useState(
    contest.allowDuplicateCandidates,
  );
  const [nominationDeadline, setNominationDeadline] = useState(
    isoToDatetimeLocal(contest.nominationDeadline),
  );
  const [candidateReveal, setCandidateReveal] = useState(contest.candidateReveal);
  const [songLinks, setSongLinks] = useState<SongLinksMode>(contest.songLinks);
  const [candidateTitle, setCandidateTitle] = useState(contest.candidateTitle ?? "");
  const [candidateSort, setCandidateSort] = useState(() =>
    parseCandidateSort(contest.candidateSort),
  );
  const [voteMutability, setVoteMutability] = useState(contest.voteMutability);
  const [votingCloseMode, setVotingCloseMode] = useState(contest.votingCloseMode);
  const [votingClosesAt, setVotingClosesAt] = useState(
    isoToDatetimeLocal(contest.votingClosesAt),
  );
  const [scoringModel, setScoringModel] = useState(contest.scoringModel);
  const [showStarPoints, setShowStarPoints] = useState(
    contest.showStarPoints ?? false,
  );
  const [showNominees, setShowNominees] = useState(contest.showNominees ?? false);
  const [resultsReveal, setResultsReveal] = useState(contest.resultsReveal);
  const [ballotRevealOrder, setBallotRevealOrder] = useState(
    contest.ballotRevealOrder,
  );
  const [nominatorRanking, setNominatorRanking] = useState(contest.nominatorRanking);
  const [nominatorRankingWhen, setNominatorRankingWhen] = useState(
    contest.nominatorRankingWhen,
  );
  const [nominatorResultsReveal, setNominatorResultsReveal] = useState(
    contest.nominatorResultsReveal,
  );
  const [allowVoteOwnNominations, setAllowVoteOwnNominations] = useState(
    contest.allowVoteOwnNominations,
  );
  const [nominationsOpen, setNominationsOpen] = useState(contest.nominationsOpen);
  const [nominationKind, setNominationKind] = useState<NominationKind>(
    contest.nominationKind,
  );
  const [birthdayMode, setBirthdayMode] = useState<"participant" | "curated">(
    isCuratedBirthdayContest(contest.nominationKind, contest.candidateSource)
      ? "curated"
      : "participant",
  );
  const [chartCountry, setChartCountry] = useState<ChartCountry>(contest.chartCountry);
  const [birthdayOffsetAmount, setBirthdayOffsetAmount] = useState(
    contest.birthdayOffsetAmount ?? 0,
  );
  const [birthdayOffsetUnit, setBirthdayOffsetUnit] = useState<BirthdayOffsetUnit>(
    contest.birthdayOffsetUnit ?? "years",
  );

  useEffect(() => {
    if (!open) return;
    setTitle(contest.title);
    setDescription(contest.description ?? "");
    setTheme(contest.theme);
    setHostParticipates(contest.hostParticipates);
    setCandidateSource(contest.candidateSource);
    setMaxNominations(contest.maxNominationsPerParticipant ?? 1);
    setAllowDuplicates(contest.allowDuplicateCandidates);
    setNominationDeadline(isoToDatetimeLocal(contest.nominationDeadline));
    setCandidateReveal(contest.candidateReveal);
    setSongLinks(contest.songLinks);
    setCandidateTitle(contest.candidateTitle ?? "");
    setCandidateSort(parseCandidateSort(contest.candidateSort));
    setVoteMutability(contest.voteMutability);
    setVotingCloseMode(contest.votingCloseMode);
    setVotingClosesAt(isoToDatetimeLocal(contest.votingClosesAt));
    setScoringModel(contest.scoringModel);
    setShowStarPoints(contest.showStarPoints ?? false);
    setShowNominees(contest.showNominees ?? false);
    setResultsReveal(contest.resultsReveal);
    setBallotRevealOrder(contest.ballotRevealOrder);
    setNominatorRanking(contest.nominatorRanking);
    setNominatorRankingWhen(contest.nominatorRankingWhen);
    setNominatorResultsReveal(contest.nominatorResultsReveal);
    setAllowVoteOwnNominations(contest.allowVoteOwnNominations);
    setNominationsOpen(contest.nominationsOpen);
    setNominationKind(contest.nominationKind);
    setBirthdayMode(
      isCuratedBirthdayContest(contest.nominationKind, contest.candidateSource)
        ? "curated"
        : "participant",
    );
    setChartCountry(contest.chartCountry);
    setBirthdayOffsetAmount(contest.birthdayOffsetAmount ?? 0);
    setBirthdayOffsetUnit(contest.birthdayOffsetUnit ?? "years");
  }, [open, contest]);

  useEffect(() => {
    if (!state?.success) return;
    setOpen(false);
    router.refresh();
  }, [state?.success, router]);

  const clampedNoms = useMemo(
    () => clampNominationsForPlan(planId, maxNominations, candidateSource),
    [planId, maxNominations, candidateSource],
  );

  if (locked) {
    return (
      <p className="text-sm text-muted-foreground">
        Settings are locked because this contest is {contest.status}.
      </p>
    );
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Edit settings
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <form action={formAction} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Edit contest settings</DialogTitle>
              <DialogDescription>
                Adjust rules anytime before the contest is finished or expired.
              </DialogDescription>
            </DialogHeader>

            <input type="hidden" name="contestId" value={contest.id} />
            <input type="hidden" name="joinCode" value={contest.joinCode} />
            <input type="hidden" name="title" value={title} />
            <input type="hidden" name="description" value={description} />
            <input type="hidden" name="theme" value={theme} />
            <input
              type="hidden"
              name="hostParticipates"
              value={hostParticipates ? "true" : "false"}
            />
            <input type="hidden" name="candidateSource" value={candidateSource} />
            <input
              type="hidden"
              name="maxNominationsPerParticipant"
              value={clampedNoms}
            />
            <input
              type="hidden"
              name="allowDuplicateCandidates"
              value={allowDuplicates ? "true" : "false"}
            />
            <input
              type="hidden"
              name="nominationDeadline"
              value={datetimeLocalToIso(nominationDeadline)}
            />
            <input type="hidden" name="candidateReveal" value={candidateReveal} />
            <input type="hidden" name="songLinks" value={songLinks} />
            <input type="hidden" name="candidateTitle" value={candidateTitle} />
            <input type="hidden" name="candidateSort" value={candidateSort} />
            <input type="hidden" name="voteMutability" value={voteMutability} />
            <input type="hidden" name="votingCloseMode" value={votingCloseMode} />
            <input
              type="hidden"
              name="votingClosesAt"
              value={datetimeLocalToIso(votingClosesAt)}
            />
            <input type="hidden" name="scoringModel" value={scoringModel} />
            <input
              type="hidden"
              name="showStarPoints"
              value={
                showStarPoints && isStarRatingModel(scoringModel)
                  ? "true"
                  : "false"
              }
            />
            <input
              type="hidden"
              name="showNominees"
              value={showNominees ? "true" : "false"}
            />
            <input type="hidden" name="resultsReveal" value={resultsReveal} />
            <input type="hidden" name="ballotRevealOrder" value={ballotRevealOrder} />
            <input
              type="hidden"
              name="nominatorRanking"
              value={
                allowsNominatorRanking(candidateSource, nominationKind) &&
                nominatorRanking
                  ? "true"
                  : "false"
              }
            />
            <input
              type="hidden"
              name="nominatorRankingWhen"
              value={nominatorRankingWhen}
            />
            <input
              type="hidden"
              name="nominatorResultsReveal"
              value={nominatorResultsReveal}
            />
            <input
              type="hidden"
              name="allowVoteOwnNominations"
              value={
                candidateSource === "curated" || allowVoteOwnNominations
                  ? "true"
                  : "false"
              }
            />
            <input
              type="hidden"
              name="nominationsOpen"
              value={nominationsOpen ? "true" : "false"}
            />
            <input type="hidden" name="nominationKind" value={nominationKind} />
            <input type="hidden" name="chartCountry" value={chartCountry} />
            <input
              type="hidden"
              name="birthdayOffsetAmount"
              value={birthdayOffsetAmount}
            />
            <input
              type="hidden"
              name="birthdayOffsetUnit"
              value={birthdayOffsetUnit}
            />

            <div className="space-y-2">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={80}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Input
                id="edit-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={500}
              />
            </div>

            {nominationKind === "birthday" ? (
              <div className={ADMIN_HIGHLIGHT_PANEL_CLASS}>
                <div>
                  <p className="text-sm font-medium">Birthday chart lookup</p>
                  <p className="text-xs text-muted-foreground">
                    Which chart market and which date relative to each birthday.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-chartCountry">Chart country</Label>
                  <select
                    id="edit-chartCountry"
                    className={ADMIN_SELECT_CLASS}
                    value={chartCountry}
                    onChange={(event) =>
                      setChartCountry(event.target.value as ChartCountry)
                    }
                  >
                    {(CONTEST_CHART_COUNTRIES as readonly ChartCountry[]).map(
                      (key) => (
                        <option key={key} value={key}>
                          {CHART_COUNTRY_OPTIONS[key].label}
                        </option>
                      ),
                    )}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {CHART_COUNTRY_OPTIONS[chartCountry].description}
                  </p>
                </div>
                <BirthdayOffsetFields
                  amount={birthdayOffsetAmount}
                  unit={birthdayOffsetUnit}
                  onAmountChange={setBirthdayOffsetAmount}
                  onUnitChange={setBirthdayOffsetUnit}
                  amountId="edit-birthdayOffsetAmount"
                  unitId="edit-birthdayOffsetUnit"
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Contest type</Label>
              <div className="space-y-2">
                {CONTEST_TYPE_OPTIONS.map((option) => {
                  const selected = contestType === option.id;
                  return (
                    <label
                      key={option.id}
                      className={adminOptionCardClass(selected, !option.available || locked)}
                    >
                      <input
                        type="radio"
                        name="editContestType"
                        className={ADMIN_RADIO_CLASS}
                        checked={selected}
                        disabled={!option.available || locked}
                        onChange={() => {
                          if (!option.available || !option.theme) return;
                          setContestType(option.id);
                          setTheme(option.theme);
                          if (option.theme !== "song") {
                            setNominationKind("standard");
                          }
                          if (option.theme === "photo") {
                            setAllowDuplicates(true);
                          }
                        }}
                      />
                      <span className="space-y-0.5">
                        <span className="block text-sm font-medium">
                          {option.label}
                          {!option.available ? (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              Coming soon
                            </span>
                          ) : null}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {theme === "song" ? (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-start gap-2">
                  <input
                    id="edit-birthdayContest"
                    type="checkbox"
                    checked={nominationKind === "birthday"}
                    onChange={(event) => {
                      const on = event.target.checked;
                      setNominationKind(on ? "birthday" : "standard");
                      if (on) {
                        if (candidateSource !== "curated") {
                          setBirthdayMode("participant");
                          setCandidateSource("user_single");
                        } else {
                          setBirthdayMode("curated");
                        }
                        setMaxNominations(1);
                        setNominatorRanking(true);
                        setAllowDuplicates(true);
                        setCandidateReveal("admin_batch");
                        setAllowVoteOwnNominations(true);
                      }
                    }}
                    className={ADMIN_CHECKBOX_CLASS}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="edit-birthdayContest">Birthday Song Contest</Label>
                    <p className="text-xs text-muted-foreground">
                      Participants submit a birthday. The app nominates that week&apos;s
                      chart #1 privately. Same hit is shared if birthdays match.
                    </p>
                  </div>
                </div>
                {nominationKind === "birthday" ? (
                  <div className="space-y-3 pl-6">
                    <div className="space-y-2">
                      <Label>Who provides birthdays?</Label>
                      <div className="space-y-2">
                        {(
                          [
                            [
                              "participant",
                              "Participants submit their own",
                              "Each participant submits one birthday privately.",
                            ],
                            [
                              "curated",
                              "Host curates names and birth dates",
                              "Surprise voting. Participants do not know whose birthday each song is.",
                            ],
                          ] as const
                        ).map(([mode, label, description]) => (
                          <label
                            key={mode}
                            className={adminOptionCardClass(birthdayMode === mode)}
                          >
                            <input
                              type="radio"
                              name="editBirthdayMode"
                              className={ADMIN_RADIO_CLASS}
                              checked={birthdayMode === mode}
                              onChange={() => {
                                setBirthdayMode(mode);
                                if (mode === "participant") {
                                  setCandidateSource("user_single");
                                } else {
                                  setCandidateSource("curated");
                                }
                              }}
                            />
                            <span className="space-y-0.5">
                              <span className="block text-sm font-medium">{label}</span>
                              <span className="block text-xs text-muted-foreground">
                                {description}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Chart country and date offset are above under &quot;Birthday chart
                      lookup&quot;.
                    </p>
                  </div>
                ) : null}
                <div className="space-y-2 border-t pt-3">
                  <Label htmlFor="edit-songLinks">Show song links?</Label>
                  <select
                    id="edit-songLinks"
                    className={ADMIN_SELECT_CLASS}
                    value={songLinks}
                    onChange={(event) =>
                      setSongLinks(event.target.value as SongLinksMode)
                    }
                  >
                    {(Object.keys(SONG_LINKS_OPTIONS) as SongLinksMode[]).map(
                      (key) => (
                        <option key={key} value={key}>
                          {SONG_LINKS_OPTIONS[key].label}
                        </option>
                      ),
                    )}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {SONG_LINKS_OPTIONS[songLinks].description}
                  </p>
                </div>
              </div>
            ) : null}

            <div className="flex items-start gap-2 rounded-lg border p-3">
              <input
                id="edit-nominationsOpen"
                type="checkbox"
                checked={nominationsOpen}
                onChange={(event) => setNominationsOpen(event.target.checked)}
                className={ADMIN_CHECKBOX_CLASS}
              />
              <Label htmlFor="edit-nominationsOpen">Nominations open</Label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-source">Candidate source</Label>
              <select
                id="edit-source"
                className={ADMIN_SELECT_CLASS}
                value={candidateSource}
                disabled={nominationKind === "birthday"}
                onChange={(event) => {
                  const next = event.target.value as CandidateSource;
                  setCandidateSource(next);
                  if (next === "user_single") setMaxNominations(1);
                  if (
                    !allowsNominatorRanking(next, nominationKind)
                  ) {
                    setNominatorRanking(false);
                  }
                }}
              >
                {nominationKind === "birthday" ? (
                  birthdayMode === "curated" ? (
                    <option value="curated">Curated birthday (host adds people)</option>
                  ) : (
                    <option value="user_single">Birthday chart lookup</option>
                  )
                ) : (
                  (Object.keys(CANDIDATE_SOURCES) as CandidateSource[]).map((key) => (
                    <option key={key} value={key}>
                      {CANDIDATE_SOURCES[key].label}
                    </option>
                  ))
                )}
              </select>
              {nominationKind === "birthday" ? (
                <p className="text-xs text-muted-foreground">
                  {birthdayMode === "curated"
                    ? "Curated birthday: host adds people; chart hits on release."
                    : "Fixed for participant-driven Birthday Song Contest."}
                </p>
              ) : null}
            </div>

            {nominationKind !== "birthday" &&
            (candidateSource === "user_multiple" ||
              candidateSource === "combined") ? (
              <div className="space-y-2">
                <Label htmlFor="edit-maxNoms">Nominations per participant</Label>
                <Input
                  id="edit-maxNoms"
                  type="number"
                  min={1}
                  max={plan.maxNominationsPerParticipant ?? undefined}
                  value={maxNominations}
                  onChange={(event) => setMaxNominations(Number(event.target.value))}
                />
                <p className="text-xs text-muted-foreground">Using {clampedNoms}.</p>
              </div>
            ) : null}

            {nominationKind !== "birthday" &&
            theme === "generic" &&
            candidateSource !== "curated" ? (
              <div className="space-y-2">
                <Label htmlFor="edit-candidateTitle">Candidate description</Label>
                <Input
                  id="edit-candidateTitle"
                  value={candidateTitle}
                  onChange={(event) => setCandidateTitle(event.target.value)}
                  placeholder="Player"
                  maxLength={40}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to use &ldquo;Candidate&rdquo;. Participants see the label
                  plus a number, e.g. Player 1.
                </p>
              </div>
            ) : null}

            <div className="flex items-center gap-2">
              <input
                id="edit-dupes"
                type="checkbox"
                checked={allowDuplicates}
                disabled={nominationKind === "birthday"}
                onChange={(event) => setAllowDuplicates(event.target.checked)}
                className={cn(
                  ADMIN_CHECKBOX_CLASS,
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              />
              <Label
                htmlFor="edit-dupes"
                className={nominationKind === "birthday" ? "opacity-60" : undefined}
              >
                Allow duplicate candidates
              </Label>
            </div>
            {nominationKind === "birthday" ? (
              <p className="text-xs text-muted-foreground">
                Fixed: on (shared chart hits).
              </p>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="edit-nomDeadline">Nomination deadline</Label>
              <Input
                id="edit-nomDeadline"
                type="datetime-local"
                value={nominationDeadline}
                onChange={(event) => setNominationDeadline(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-reveal">When are candidates revealed?</Label>
              <select
                id="edit-reveal"
                className={ADMIN_SELECT_CLASS}
                value={candidateReveal}
                onChange={(event) =>
                  setCandidateReveal(event.target.value as CandidateReveal)
                }
              >
                {(Object.keys(CANDIDATE_REVEALS) as CandidateReveal[]).map((key) => (
                  <option key={key} value={key}>
                    {CANDIDATE_REVEALS[key].label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {CANDIDATE_REVEALS[candidateReveal].description}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-candidateSort">Candidate order</Label>
              <select
                id="edit-candidateSort"
                className={ADMIN_SELECT_CLASS}
                value={candidateSort}
                onChange={(event) =>
                  setCandidateSort(event.target.value as CandidateSort)
                }
              >
                {(
                  Object.keys(CANDIDATE_SORT_OPTIONS) as Array<
                    keyof typeof CANDIDATE_SORT_OPTIONS
                  >
                ).map((key) => (
                    <option key={key} value={key}>
                      {CANDIDATE_SORT_OPTIONS[key].label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {
                    CANDIDATE_SORT_OPTIONS[
                      candidateSort as keyof typeof CANDIDATE_SORT_OPTIONS
                    ]?.description
                  }
                </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-scoring">Scoring model</Label>
              <select
                id="edit-scoring"
                className={ADMIN_SELECT_CLASS}
                value={scoringModel}
                onChange={(event) =>
                  setScoringModel(event.target.value as ScoringModelId)
                }
              >
                {(Object.keys(SCORING_MODELS) as ScoringModelId[]).map((key) => (
                  <option key={key} value={key}>
                    {SCORING_MODELS[key].label}
                  </option>
                ))}
              </select>
            </div>
            {isStarRatingModel(scoringModel) ? (
              <AdminSwitchField
                id="edit-showStarPoints"
                label="Show point totals"
                description="On: show the numeric point total next to the stars. Off: stars only."
                checked={showStarPoints}
                onCheckedChange={setShowStarPoints}
              />
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="edit-resultsReveal">How to show results</Label>
              <select
                id="edit-resultsReveal"
                className={ADMIN_SELECT_CLASS}
                value={resultsReveal}
                onChange={(event) =>
                  setResultsReveal(event.target.value as ResultsReveal)
                }
              >
                {(Object.keys(RESULTS_REVEAL_OPTIONS) as ResultsReveal[]).map((key) => (
                  <option key={key} value={key}>
                    {RESULTS_REVEAL_OPTIONS[key].label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {RESULTS_REVEAL_OPTIONS[resultsReveal].description}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-ballotRevealOrder">Ballot reveal order</Label>
              <select
                id="edit-ballotRevealOrder"
                className={ADMIN_SELECT_CLASS}
                value={ballotRevealOrder}
                disabled={resultsReveal !== "by_participant"}
                onChange={(event) =>
                  setBallotRevealOrder(event.target.value as BallotRevealOrder)
                }
              >
                {(Object.keys(BALLOT_REVEAL_ORDER_OPTIONS) as BallotRevealOrder[]).map(
                  (key) => (
                    <option key={key} value={key}>
                      {BALLOT_REVEAL_ORDER_OPTIONS[key].label}
                    </option>
                  ),
                )}
              </select>
              <p className="text-xs text-muted-foreground">
                {resultsReveal === "by_participant"
                  ? BALLOT_REVEAL_ORDER_OPTIONS[ballotRevealOrder].description
                  : "Only applies to ballot-by-ballot (manual) results."}
              </p>
            </div>

            {allowsNominatorRanking(candidateSource, nominationKind) ? (
            <div className="space-y-2">
              <Label htmlFor="edit-nominatorRanking">Nominator ranking</Label>
              <select
                id="edit-nominatorRanking"
                className={ADMIN_SELECT_CLASS}
                value={nominatorRanking ? "yes" : "no"}
                onChange={(event) =>
                  setNominatorRanking(event.target.value === "yes")
                }
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </div>
            ) : null}

            {allowsNominatorRanking(candidateSource, nominationKind) &&
            nominatorRanking ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="edit-nominatorWhen">Nominator ranking timing</Label>
                  <select
                    id="edit-nominatorWhen"
                    className={ADMIN_SELECT_CLASS}
                    value={nominatorRankingWhen}
                    onChange={(event) =>
                      setNominatorRankingWhen(
                        event.target.value as NominatorRankingWhen,
                      )
                    }
                  >
                    {(
                      Object.keys(NOMINATOR_RANKING_WHEN_OPTIONS) as NominatorRankingWhen[]
                    ).map((key) => (
                      <option key={key} value={key}>
                        {NOMINATOR_RANKING_WHEN_OPTIONS[key].label}
                      </option>
                    ))}
                  </select>
                </div>
                {nominatorRankingWhen !== "parallel" ? (
                  <div className="space-y-2">
                    <Label htmlFor="edit-nominatorResultsReveal">
                      How to show nominator ranking
                    </Label>
                    <select
                      id="edit-nominatorResultsReveal"
                      className={ADMIN_SELECT_CLASS}
                      value={nominatorResultsReveal}
                      onChange={(event) =>
                        setNominatorResultsReveal(
                          event.target.value as NominatorResultsReveal,
                        )
                      }
                    >
                      {(
                        Object.keys(
                          NOMINATOR_RESULTS_REVEAL_OPTIONS,
                        ) as NominatorResultsReveal[]
                      ).map((key) => (
                        <option key={key} value={key}>
                          {NOMINATOR_RESULTS_REVEAL_OPTIONS[key].label}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      {NOMINATOR_RESULTS_REVEAL_OPTIONS[nominatorResultsReveal].description}
                    </p>
                  </div>
                ) : null}
              </>
            ) : null}

            {candidateSource !== "curated" && nominationKind !== "birthday" ? (
              <>
                <AdminSwitchField
                  id="edit-showNominees"
                  label="Show nominees"
                  description={
                    showNominees
                      ? "List who nominated each candidate in the Candidates tab."
                      : "Hide nominator names — your own picks stay highlighted in the list."
                  }
                  checked={showNominees}
                  onCheckedChange={setShowNominees}
                />
                <div className="space-y-2">
                  <Label htmlFor="edit-allowOwnNoms">Rank own nominations</Label>
                  <select
                    id="edit-allowOwnNoms"
                    className={ADMIN_SELECT_CLASS}
                    value={allowVoteOwnNominations ? "yes" : "no"}
                    onChange={(event) =>
                      setAllowVoteOwnNominations(event.target.value === "yes")
                    }
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
              </>
            ) : null}

            {candidateSource !== "curated" && nominationKind === "birthday" ? (
              <div className="space-y-2">
                <Label htmlFor="edit-allowOwnNoms">Rank own nominations</Label>
                <select
                  id="edit-allowOwnNoms"
                  className={ADMIN_SELECT_CLASS}
                  value={allowVoteOwnNominations ? "yes" : "no"}
                  disabled
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  Fixed: yes (birthday hits stay on every ballot).
                </p>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <AdminSwitchField
                id="edit-hostParticipates"
                label="Host also participates"
                description="If off, the host stays admin-only and cannot nominate or vote."
                checked={hostParticipates}
                onCheckedChange={setHostParticipates}
              />
              <AdminSwitchField
                id="edit-mutability"
                label="Vote changes"
                description={VOTE_MUTABILITY_OPTIONS[voteMutability].description}
                checked={voteMutability === "editable_until_close"}
                onCheckedChange={(checked) =>
                  setVoteMutability(checked ? "editable_until_close" : "locked_on_submit")
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-closeMode">Voting ends</Label>
              <select
                id="edit-closeMode"
                className={ADMIN_SELECT_CLASS}
                value={votingCloseMode}
                onChange={(event) =>
                  setVotingCloseMode(event.target.value as VotingCloseMode)
                }
              >
                <option value="manual">Host ends manually</option>
                <option value="scheduled">Scheduled end time</option>
              </select>
            </div>

            {votingCloseMode === "scheduled" ? (
              <div className="space-y-2">
                <Label htmlFor="edit-closesAt">Voting ends at</Label>
                <Input
                  id="edit-closesAt"
                  type="datetime-local"
                  value={votingClosesAt}
                  onChange={(event) => setVotingClosesAt(event.target.value)}
                  required
                />
              </div>
            ) : null}

            {state?.error ? (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !title.trim()}>
                {pending ? "Saving…" : "Save settings"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
