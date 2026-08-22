"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { createContestAction, type ContestActionState } from "@/app/actions/contest";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminSwitchField } from "@/components/admin-switch-field";
import { BirthdayOffsetFields } from "@/components/birthday-offset-fields";
import { CHART_COUNTRY_OPTIONS, CONTEST_CHART_COUNTRIES, type ChartCountry } from "@/lib/charts";
import { datetimeLocalToIso } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { ADMIN_SELECT_CLASS, ADMIN_RADIO_CLASS, ADMIN_CHECKBOX_CLASS, adminOptionCardClass, ADMIN_HIGHLIGHT_PANEL_CLASS } from "@/lib/admin-ui";
import type { BirthdayOffsetUnit } from "@/lib/birthday-offset";
import {
  CANDIDATE_REVEALS,
  CANDIDATE_SORT_OPTIONS,
  CANDIDATE_SOURCES,
  CONTEST_TYPE_OPTIONS,
  DEFAULT_CONTEST_SETTINGS,
  RESULTS_REVEAL_OPTIONS,
  BALLOT_REVEAL_ORDER_OPTIONS,
  SONG_LINKS_OPTIONS,
  SCORING_MODELS,
  VOTE_MUTABILITY_OPTIONS,
  NOMINATOR_RANKING_WHEN_OPTIONS,
  NOMINATOR_RESULTS_REVEAL_OPTIONS,
  clampNominationsForPlan,
  contestTypeIdFromTheme,
  isStarRatingModel,
  allowsNominatorRanking,
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
  getPlanLimits,
} from "@/lib/plans";

const initialState: ContestActionState = null;

type CreateContestFormProps = {
  defaultHostName?: string | null;
  planId?: PlanId;
};

export function CreateContestForm({
  defaultHostName,
  planId = "free",
}: CreateContestFormProps) {
  const [step, setStep] = useState(1);
  const [state, formAction, pending] = useActionState(createContestAction, initialState);
  const plan = getPlanLimits(planId);

  const [hostName, setHostName] = useState(defaultHostName?.trim() ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [hostParticipates, setHostParticipates] = useState(
    DEFAULT_CONTEST_SETTINGS.hostParticipates,
  );
  const [theme, setTheme] = useState<ContestTheme>(DEFAULT_CONTEST_SETTINGS.theme);
  const [contestType, setContestType] = useState<ContestTypeId>(
    contestTypeIdFromTheme(DEFAULT_CONTEST_SETTINGS.theme),
  );
  const [nominationKind, setNominationKind] = useState<NominationKind>(
    DEFAULT_CONTEST_SETTINGS.nominationKind,
  );
  const [birthdayMode, setBirthdayMode] = useState<"participant" | "curated">(
    "participant",
  );
  const [chartCountry, setChartCountry] = useState<ChartCountry>(
    DEFAULT_CONTEST_SETTINGS.chartCountry,
  );
  const [birthdayOffsetAmount, setBirthdayOffsetAmount] = useState(0);
  const [birthdayOffsetUnit, setBirthdayOffsetUnit] =
    useState<BirthdayOffsetUnit>("years");
  const [candidateSource, setCandidateSource] = useState<CandidateSource>(
    DEFAULT_CONTEST_SETTINGS.candidateSource,
  );
  const [maxNominations, setMaxNominations] = useState(
    DEFAULT_CONTEST_SETTINGS.maxNominationsPerParticipant,
  );
  const [candidateTitle, setCandidateTitle] = useState(
    DEFAULT_CONTEST_SETTINGS.candidateTitle,
  );
  const [allowDuplicates, setAllowDuplicates] = useState(
    DEFAULT_CONTEST_SETTINGS.allowDuplicateCandidates,
  );
  const [nominationDeadline, setNominationDeadline] = useState("");
  const [candidateReveal, setCandidateReveal] = useState<CandidateReveal>(
    DEFAULT_CONTEST_SETTINGS.candidateReveal,
  );
  const [songLinks, setSongLinks] = useState<SongLinksMode>(
    DEFAULT_CONTEST_SETTINGS.songLinks,
  );
  const [candidateSort, setCandidateSort] = useState<CandidateSort>(
    DEFAULT_CONTEST_SETTINGS.candidateSort,
  );
  const [voteMutability, setVoteMutability] = useState<VoteMutability>(
    DEFAULT_CONTEST_SETTINGS.voteMutability,
  );
  const [votingCloseMode, setVotingCloseMode] = useState<VotingCloseMode>(
    DEFAULT_CONTEST_SETTINGS.votingCloseMode,
  );
  const [votingClosesAt, setVotingClosesAt] = useState("");
  const [scoringModel, setScoringModel] = useState<ScoringModelId>(
    DEFAULT_CONTEST_SETTINGS.scoringModel,
  );
  const [showStarPoints, setShowStarPoints] = useState(
    DEFAULT_CONTEST_SETTINGS.showStarPoints,
  );
  const [resultsReveal, setResultsReveal] = useState<ResultsReveal>(
    DEFAULT_CONTEST_SETTINGS.resultsReveal,
  );
  const [ballotRevealOrder, setBallotRevealOrder] = useState<BallotRevealOrder>(
    DEFAULT_CONTEST_SETTINGS.ballotRevealOrder,
  );
  const [nominatorRanking, setNominatorRanking] = useState(
    DEFAULT_CONTEST_SETTINGS.nominatorRanking,
  );
  const [nominatorRankingWhen, setNominatorRankingWhen] =
    useState<NominatorRankingWhen>(DEFAULT_CONTEST_SETTINGS.nominatorRankingWhen);
  const [nominatorResultsReveal, setNominatorResultsReveal] =
    useState<NominatorResultsReveal>(DEFAULT_CONTEST_SETTINGS.nominatorResultsReveal);
  const [allowVoteOwnNominations, setAllowVoteOwnNominations] = useState(
    DEFAULT_CONTEST_SETTINGS.allowVoteOwnNominations,
  );
  const stepLockRef = useRef(false);

  function goToStep(nextStep: number) {
    // Prevent one physical click from advancing two steps when the Next button
    // remounts under the cursor after a re-render.
    if (stepLockRef.current) return;
    stepLockRef.current = true;
    setStep(nextStep);
    window.setTimeout(() => {
      stepLockRef.current = false;
    }, 400);
  }

  const clampedNoms = useMemo(
    () => clampNominationsForPlan(planId, maxNominations, candidateSource),
    [planId, maxNominations, candidateSource],
  );

  const canNextFromBasics = hostName.trim().length > 0;
  const canCreate =
    canNextFromBasics &&
    (votingCloseMode === "manual" || votingClosesAt.trim().length > 0);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="hostName" value={hostName} />
      <input type="hidden" name="title" value={title.trim() || "Contest"} />
      <input type="hidden" name="description" value={description} />
      <input
        type="hidden"
        name="hostParticipates"
        value={hostParticipates ? "true" : "false"}
      />
      <input type="hidden" name="theme" value={theme} />
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
      <input type="hidden" name="candidateSource" value={candidateSource} />
      <input type="hidden" name="maxNominationsPerParticipant" value={clampedNoms} />
      <input type="hidden" name="candidateTitle" value={candidateTitle} />
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
          showStarPoints && isStarRatingModel(scoringModel) ? "true" : "false"
        }
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
      <input type="hidden" name="nominatorRankingWhen" value={nominatorRankingWhen} />
      <input
        type="hidden"
        name="nominatorResultsReveal"
        value={nominatorResultsReveal}
      />
      <input
        type="hidden"
        name="allowVoteOwnNominations"
        value={allowVoteOwnNominations ? "true" : "false"}
      />

      <p className="text-sm text-muted-foreground">
        Step {step} of 3 · {plan.label} plan
      </p>

      {step === 1 ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hostNameVisible">Your name</Label>
            <Input
              id="hostNameVisible"
              value={hostName}
              onChange={(event) => setHostName(event.target.value)}
              placeholder="Alex"
              required
              maxLength={40}
            />
            {defaultHostName?.trim() ? (
              <p className="text-xs text-muted-foreground">
                Prefilled from your signed-in name. Change it only for this contest if
                you want.
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="titleVisible">Contest title</Label>
            <Input
              id="titleVisible"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Friday Song Showdown"
              maxLength={80}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to use &ldquo;Contest&rdquo;.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="descriptionVisible">Description (optional)</Label>
            <Input
              id="descriptionVisible"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Everyone brings one song. We vote."
              maxLength={500}
            />
          </div>
          <div className="space-y-2">
            <Label>Contest type</Label>
            <div className="space-y-2">
              {CONTEST_TYPE_OPTIONS.map((option) => {
                const selected = contestType === option.id;
                return (
                  <label
                    key={option.id}
                    className={adminOptionCardClass(selected, !option.available)}
                  >
                    <input
                      type="radio"
                      name="contestType"
                      className={ADMIN_RADIO_CLASS}
                      checked={selected}
                      disabled={!option.available}
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
                  id="birthdayContest"
                  type="checkbox"
                  checked={nominationKind === "birthday"}
                  onChange={(event) => {
                    const on = event.target.checked;
                    setNominationKind(on ? "birthday" : "standard");
                    if (on) {
                      setBirthdayMode("participant");
                      setCandidateSource("user_single");
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
                  <Label htmlFor="birthdayContest">Birthday Song Contest</Label>
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
                              name="birthdayMode"
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
                  <div className="space-y-2">
                    <Label htmlFor="chartCountry">Chart country</Label>
                    <select
                      id="chartCountry"
                      className={ADMIN_SELECT_CLASS}
                      value={chartCountry}
                      onChange={(event) =>
                        setChartCountry(event.target.value as ChartCountry)
                      }
                    >
                      {(CONTEST_CHART_COUNTRIES as readonly ChartCountry[]).map((key) => (
                          <option key={key} value={key}>
                            {CHART_COUNTRY_OPTIONS[key].label}
                          </option>
                        ))}
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
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          {nominationKind === "birthday" ? (
            <div className={ADMIN_HIGHLIGHT_PANEL_CLASS}>
              <p className="text-sm text-muted-foreground">
                Birthday Song Contest locks duplicates and ranking own
                nominations.
                {birthdayMode === "curated"
                  ? " You add people (name + birth date); chart hits are looked up when you release candidates."
                  : " Each participant submits one birthday privately."}
              </p>
              <BirthdayOffsetFields
                amount={birthdayOffsetAmount}
                unit={birthdayOffsetUnit}
                onAmountChange={setBirthdayOffsetAmount}
                onUnitChange={setBirthdayOffsetUnit}
                amountId="step2-birthdayOffsetAmount"
                unitId="step2-birthdayOffsetUnit"
              />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="candidateSource">Candidate source</Label>
            <select
              id="candidateSource"
              className={ADMIN_SELECT_CLASS}
              value={candidateSource}
              disabled={nominationKind === "birthday"}
              onChange={(event) => {
                const next = event.target.value as CandidateSource;
                setCandidateSource(next);
                if (next === "user_single") setMaxNominations(1);
                if (!allowsNominatorRanking(next, nominationKind)) {
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
            <p className="text-xs text-muted-foreground">
              {nominationKind === "birthday"
                ? birthdayMode === "curated"
                  ? "Fixed: host adds name + birth date for each person; chart #1 is looked up on release."
                  : "Fixed: each participant submits one birthday; the chart #1 is nominated."
                : CANDIDATE_SOURCES[candidateSource].description}
            </p>
          </div>

          {nominationKind !== "birthday" && candidateSource === "user_multiple" ? (
            <div className="space-y-2">
              <Label htmlFor="maxNominations">Nominations per participant</Label>
              <Input
                id="maxNominations"
                type="number"
                min={1}
                max={plan.maxNominationsPerParticipant ?? undefined}
                value={maxNominations}
                onChange={(event) => setMaxNominations(Number(event.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Plan allows{" "}
                {plan.maxNominationsPerParticipant === null
                  ? "unlimited"
                  : `up to ${plan.maxNominationsPerParticipant}`}
                . Using {clampedNoms}.
              </p>
            </div>
          ) : null}

          {nominationKind !== "birthday" &&
          theme === "generic" &&
          candidateSource !== "curated" ? (
            <div className="space-y-2">
              <Label htmlFor="candidateTitle">Candidate description</Label>
              <Input
                id="candidateTitle"
                value={candidateTitle}
                onChange={(event) => setCandidateTitle(event.target.value)}
                placeholder="Player"
                maxLength={40}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to use &ldquo;Candidate&rdquo;. Participants see Candidate 1,
                Candidate 2, … or Player 1 if you enter Player.
              </p>
            </div>
          ) : null}

          {nominationKind !== "birthday" && candidateSource === "curated" ? (
            <p className="text-xs text-muted-foreground">
              Curated cap on this plan:{" "}
              {plan.maxCuratedCandidates === null
                ? "unlimited"
                : plan.maxCuratedCandidates}{" "}
              candidates.
            </p>
          ) : null}

          {nominationKind !== "birthday" && candidateSource === "databased" ? (
            <p className="text-xs text-muted-foreground">
              Databased submission fields come later. Rules are stored now.
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <input
              id="allowDuplicates"
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
              htmlFor="allowDuplicates"
              className={nominationKind === "birthday" ? "opacity-60" : undefined}
            >
              Allow duplicate candidates
            </Label>
          </div>
          {nominationKind === "birthday" ? (
            <p className="text-xs text-muted-foreground">
              Fixed: on (same chart hit is shared across matching birthdays).
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="nominationDeadline">Nomination deadline (optional)</Label>
            <Input
              id="nominationDeadline"
              type="datetime-local"
              value={nominationDeadline}
              onChange={(event) => setNominationDeadline(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="candidateReveal">When are candidates revealed?</Label>
            <select
              id="candidateReveal"
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

          {theme === "song" ? (
            <div className="space-y-2">
              <Label htmlFor="songLinks">Show song links?</Label>
              <select
                id="songLinks"
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
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="candidateSort">Candidate order</Label>
            <select
              id="candidateSort"
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
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <AdminSwitchField
              id="hostParticipates"
              label="Host also participates"
              description="If off, you stay admin-only and cannot nominate or vote as a participant."
              checked={hostParticipates}
              onCheckedChange={setHostParticipates}
            />
            <AdminSwitchField
              id="voteMutability"
              label="Vote changes"
              description={VOTE_MUTABILITY_OPTIONS[voteMutability].description}
              checked={voteMutability === "editable_until_close"}
              onCheckedChange={(checked) =>
                setVoteMutability(checked ? "editable_until_close" : "locked_on_submit")
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="scoringModel">Scoring model</Label>
            <select
              id="scoringModel"
              className={ADMIN_SELECT_CLASS}
              value={scoringModel}
              onChange={(event) =>
                setScoringModel(event.target.value as ScoringModelId)
              }
            >
              {(Object.keys(SCORING_MODELS) as ScoringModelId[]).map((key) => (
                <option key={key} value={key}>
                  {SCORING_MODELS[key].label} — {SCORING_MODELS[key].description}
                </option>
              ))}
            </select>
          </div>
          {isStarRatingModel(scoringModel) ? (
            <AdminSwitchField
              id="showStarPoints"
              label="Show point totals"
              description="On: show the numeric point total next to the stars. Off: stars only."
              checked={showStarPoints}
              onCheckedChange={setShowStarPoints}
            />
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="allowVoteOwnNominations">
              Nominators can rank their own nominations
            </Label>
            <select
              id="allowVoteOwnNominations"
              className={ADMIN_SELECT_CLASS}
              value={allowVoteOwnNominations ? "yes" : "no"}
              disabled={nominationKind === "birthday"}
              onChange={(event) =>
                setAllowVoteOwnNominations(event.target.value === "yes")
              }
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
            <p className="text-xs text-muted-foreground">
              {nominationKind === "birthday"
                ? "Fixed: yes (birthday hits stay on every ballot)."
                : "If no, voters cannot place their own nominated candidates on their ballot."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="resultsReveal">How to show results?</Label>
            <select
              id="resultsReveal"
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
            <Label htmlFor="ballotRevealOrder">Ballot reveal order</Label>
            <select
              id="ballotRevealOrder"
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
            <Label htmlFor="nominatorRanking">Nominator ranking</Label>
            <select
              id="nominatorRanking"
              className={ADMIN_SELECT_CLASS}
              value={nominatorRanking ? "yes" : "no"}
              onChange={(event) =>
                setNominatorRanking(event.target.value === "yes")
              }
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Sum each candidate&apos;s points for their nominator and present a
              person ranking.
            </p>
          </div>
          ) : null}

          {allowsNominatorRanking(candidateSource, nominationKind) &&
          nominatorRanking ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="nominatorRankingWhen">When to show nominator ranking</Label>
                <select
                  id="nominatorRankingWhen"
                  className={ADMIN_SELECT_CLASS}
                  value={nominatorRankingWhen}
                  onChange={(event) =>
                    setNominatorRankingWhen(
                      event.target.value as NominatorRankingWhen,
                    )
                  }
                >
                  {(Object.keys(NOMINATOR_RANKING_WHEN_OPTIONS) as NominatorRankingWhen[]).map(
                    (key) => (
                      <option key={key} value={key}>
                        {NOMINATOR_RANKING_WHEN_OPTIONS[key].label}
                      </option>
                    ),
                  )}
                </select>
                <p className="text-xs text-muted-foreground">
                  {NOMINATOR_RANKING_WHEN_OPTIONS[nominatorRankingWhen].description}
                </p>
              </div>
              {nominatorRankingWhen !== "parallel" ? (
                <div className="space-y-2">
                  <Label htmlFor="nominatorResultsReveal">
                    How to show nominator ranking
                  </Label>
                  <select
                    id="nominatorResultsReveal"
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

          <div className="space-y-2">
            <Label htmlFor="votingCloseMode">How does voting end?</Label>
            <select
              id="votingCloseMode"
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
              <Label htmlFor="votingClosesAt">Voting ends at</Label>
              <Input
                id="votingClosesAt"
                type="datetime-local"
                value={votingClosesAt}
                onChange={(event) => setVotingClosesAt(event.target.value)}
                required
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {step > 1 ? (
          <Button
            key={`back-${step}`}
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => goToStep(step - 1)}
          >
            Back
          </Button>
        ) : null}
        {step < 3 ? (
          <Button
            key={`next-${step}`}
            type="button"
            disabled={step === 1 && !canNextFromBasics}
            onClick={() => goToStep(step + 1)}
          >
            Next
          </Button>
        ) : (
          <Button key="create" type="submit" disabled={pending || !canCreate}>
            {pending ? "Creating…" : "Create contest"}
          </Button>
        )}
      </div>
    </form>
  );
}
