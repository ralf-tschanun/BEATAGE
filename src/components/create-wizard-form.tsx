"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { flushSync } from "react-dom";
import { PaperclipIcon, XIcon } from "@phosphor-icons/react";
import { createContestAction, type ContestActionState } from "@/app/actions/contest";
import { BirthdayOffsetFields } from "@/components/birthday-offset-fields";
import { SongPickFields, type SongPickValue } from "@/components/song-pick-fields";
import { AdminSwitchField } from "@/components/admin-switch-field";
import { LocalPhotoFilePreview } from "@/components/photo-candidate-image";
import {
  CREATE_PHOTO_BODY_BUDGET_BYTES,
  PHOTOS_TOO_MANY_OR_LARGE_MESSAGE,
  prepareContestPhotoForUpload,
} from "@/lib/contest-photos";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
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
import {
  NominationsPerParticipantPicker,
  NominationDurationPicker,
  WizardAddAnotherButton,
  WizardOptionsDivider,
} from "@/components/wizard-step-ui";
import { CHART_COUNTRY_OPTIONS, CONTEST_CHART_COUNTRIES, type ChartCountry } from "@/lib/charts";
import { datetimeLocalToIso } from "@/lib/datetime";
import {
  CreateUnlockSummaryDialog,
  CreateParticipantLimitDialog,
  OverPlanWarningDialog,
  overPlanAckStorageKey,
  unlockSummaryUpgradeOptions,
  type OverPlanPendingAction,
  type OverPlanWarningKind,
} from "@/components/create-unlock-summary-dialog";
import {
  activeContestLimitMessage,
  canUpgradePlanForWizard,
  summarizePlanLimitOverage,
  wizardExceedsPlanLimits,
} from "@/lib/contest-unlock";
import { ADMIN_SELECT_CLASS, ADMIN_RADIO_CLASS, ADMIN_CHECKBOX_CLASS, adminOptionCardClass } from "@/lib/admin-ui";
import type { BirthdayOffsetUnit } from "@/lib/birthday-offset";
import { useWizardInputFocus } from "@/lib/wizard-input-focus";
import { cn } from "@/lib/utils";
import {
  applyAnythingCandidatePreset,
  anythingCandidateHasExtras,
  anythingCandidateRowCount,
  anythingDraftHasFilledCandidates,
  anythingUsesSharedCandidates,
  applyWizardEntrySource,
  candidateSourceForMode,
  clearWizardState,
  curatedCandidateCount,
  deleteAnythingCandidatePreset,
  displayStep,
  displayStepTotal,
  effectiveContestTitle,
  effectiveCandidateTitle,
  DEFAULT_CANDIDATE_TITLE,
  effectiveTopicName,
  emptyAnythingCandidate,
  hasMeaningfulWizardDraft,
  isAnythingContest,
  listAnythingCandidatePresets,
  loadWizardState,
  defaultWizardState,
  newAnythingCandidateId,
  newQuestionId,
  nextStep,
  nominationCloseModeDescription,
  normalizeWizardToSingleTopic,
  prevStep,
  saveAnythingCandidatePreset,
  saveWizardState,
  topicPlaceholder,
  validateStep,
  wizardEntrySource,
  wizardSettingsSummary,
  wizardSourcePickerLabel,
  wizardStepTitle,
  wizardCandidateRevealQuestion,
  wizardCandidateRevealOption,
  coerceWizardCandidateReveal,
  type AnythingCandidatePreset,
  type CreateWizardState,
  type DraftAnythingCandidate,
  type WizardEntrySource,
} from "@/lib/create-wizard";
import {
  BALLOT_REVEAL_ORDER_OPTIONS,
  CANDIDATE_SORT_OPTIONS,
  CREATE_CONTEST_TYPE_INTRO,
  CONTEST_TYPE_OPTIONS,
  NOMINATOR_RANKING_WHEN_OPTIONS,
  NOMINATOR_RESULTS_REVEAL_OPTIONS,
  RESULTS_REVEAL_OPTIONS,
  SCORING_MODELS,
  SONG_LINKS_OPTIONS,
  VOTE_MUTABILITY_OPTIONS,
  WIZARD_CANDIDATE_REVEAL_KEYS,
  WIZARD_NOMINATOR_RESULTS_REVEAL_KEYS,
  clampNominationsForPlan,
  isStarRatingModel,
  allowsNominatorRanking,
  type ContestTypeId,
  type PlanId,
  getPlanLimits,
} from "@/lib/plans";

const initialState: ContestActionState = null;

function PhotoFileThumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="size-14 rounded object-cover" />
  );
}

type CreateWizardFormProps = {
  defaultHostName?: string | null;
  planId?: PlanId;
  activeHostedCount?: number;
  hasSession?: boolean;
  isAnonymous?: boolean;
};

export function CreateWizardForm({
  defaultHostName,
  planId = "free",
  activeHostedCount = 0,
  hasSession = false,
  isAnonymous = true,
}: CreateWizardFormProps) {
  const [state, formAction] = useActionState(createContestAction, initialState);
  const [pending, startTransition] = useTransition();
  const plan = getPlanLimits(planId);
  const hostName = defaultHostName?.trim() ?? "";
  const [hydrated, setHydrated] = useState(false);
  const [draftChoiceOpen, setDraftChoiceOpen] = useState(false);
  const [unlockSummaryOpen, setUnlockSummaryOpen] = useState(false);
  const [participantLimitOpen, setParticipantLimitOpen] = useState(false);
  const [overPlanWarningOpen, setOverPlanWarningOpen] = useState(false);
  const [overPlanPending, setOverPlanPending] = useState<OverPlanPendingAction | null>(
    null,
  );
  const [overPlanPendingKind, setOverPlanPendingKind] =
    useState<OverPlanWarningKind>("curated");
  const [wizard, setWizard] = useState<CreateWizardState>(() =>
    defaultWizardState(hostName, planId),
  );
  const [stepError, setStepError] = useState<string | null>(null);
  /** Explicitly opened optional fields (link/comment/file) per Anything candidate. */
  const [anythingDetailsOpenIds, setAnythingDetailsOpenIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [anythingPresets, setAnythingPresets] = useState<AnythingCandidatePreset[]>(
    [],
  );
  const [presetMessage, setPresetMessage] = useState<string | null>(null);
  const [pendingPresetLoad, setPendingPresetLoad] =
    useState<AnythingCandidatePreset | null>(null);
  const stepLockRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const wizardRef = useRef(wizard);
  wizardRef.current = wizard;
  /** Prevent double-create from the participant-limit dialog (two RPCs → false ACTIVE_CONTEST_LIMIT). */
  const createSubmitLockRef = useRef(false);

  const { register: registerFocus, focusKey, focusById } = useWizardInputFocus([
    wizard.step,
    wizard.questions,
    wizard.draftAnything,
    wizard.draftAnythingByQuestion,
    wizard.anythingSharedCandidates,
    wizard.draftSongs,
    wizard.draftPhotos,
    wizard.draftBirthdayEntries,
  ]);

  useEffect(() => {
    if (hasMeaningfulWizardDraft(hostName, planId)) {
      setDraftChoiceOpen(true);
      return;
    }
    setWizard(loadWizardState(hostName, planId));
    setHydrated(true);
  }, [hostName, planId]);

  useEffect(() => {
    if (hydrated) saveWizardState(wizard);
  }, [wizard, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    setAnythingPresets(listAnythingCandidatePresets());
  }, [hydrated, wizard.step]);

  function continueSavedDraft() {
    const loaded = loadWizardState(hostName, planId);
    setWizard({
      ...loaded,
      hostName: loaded.hostName.trim() || hostName,
    });
    setStepError(null);
    setDraftChoiceOpen(false);
    setHydrated(true);
  }

  function startFreshDraft() {
    clearWizardState();
    setWizard(defaultWizardState(hostName, planId));
    setStepError(null);
    setDraftChoiceOpen(false);
    setHydrated(true);
  }

  const patchWizard = useCallback((patch: Partial<CreateWizardState>) => {
    setWizard((prev) => ({ ...prev, ...patch }));
  }, []);

  const candidateSource = useMemo(
    () =>
      candidateSourceForMode(
        wizard.candidateSourceMode,
        wizard.maxNominationsPerParticipant,
      ),
    [wizard.candidateSourceMode, wizard.maxNominationsPerParticipant],
  );

  const clampedNoms = useMemo(
    () =>
      clampNominationsForPlan(planId, wizard.maxNominationsPerParticipant, candidateSource),
    [planId, wizard.maxNominationsPerParticipant, candidateSource],
  );

  const anything = isAnythingContest(wizard);
  const curatedOnly = wizard.candidateSourceMode === "curated";
  const curatedSection =
    wizard.candidateSourceMode === "curated" ||
    wizard.candidateSourceMode === "combined";
  const userSection =
    wizard.candidateSourceMode === "user" ||
    wizard.candidateSourceMode === "combined";
  const showNominationExtras = !curatedOnly;
  const nominationCloseIsTimed =
    wizard.nominationCloseMode === "scheduled" ||
    wizard.nominationCloseMode === "duration";
  /** Curated poll (start on create) or timed noms (auto-start when noms close). */
  const showStartVotingImmediately = curatedOnly || nominationCloseIsTimed;

  // Focus the topmost control whenever the step changes (Next and Back).
  useEffect(() => {
    if (!hydrated) return;
    const current = wizardRef.current;
    const top = { pageTop: true } as const;

    if (current.step === 0) {
      const firstType = CONTEST_TYPE_OPTIONS[0]?.id;
      if (firstType) focusById(`contest-type-${firstType}`, top);
      return;
    }

    if (current.step === 1) {
      focusKey("contest-title", top);
      return;
    }

    if (current.step === 2) {
      if (current.nominationKind === "birthday") {
        focusById("birthday-mode-participant", top);
        return;
      }
      if (
        current.candidateSourceMode === "curated" ||
        current.candidateSourceMode === "combined"
      ) {
        if (current.theme === "song") {
          focusById("draft-song-0-search", top);
          return;
        }
        if (current.theme === "photo") {
          focusById("photo-file-0", top);
          return;
        }
        if (isAnythingContest(current)) {
          focusById("anything-title-0", top);
          return;
        }
      }
      focusById("candidateReveal", top);
      return;
    }

    if (current.step === 3) {
      focusById("scoringModel", top);
      return;
    }

    if (current.step === 4) {
      focusById("resultsReveal", top);
    }
  }, [hydrated, wizard.step, focusById, focusKey]);

  function goToStep(next: number) {
    if (stepLockRef.current) return;
    stepLockRef.current = true;
    patchWizard({ step: next });
    setStepError(null);
    window.setTimeout(() => {
      stepLockRef.current = false;
    }, 400);
  }

  function handleNext() {
    const err = validateStep(wizard, wizard.step, planId);
    if (err) {
      setStepError(err);
      return;
    }
    goToStep(nextStep(wizard));
  }

  function handleBack() {
    goToStep(prevStep(wizard));
  }

  function handleContestTypeChange(
    optionId: ContestTypeId,
    theme: CreateWizardState["theme"],
  ) {
    setWizard((prev) =>
      normalizeWizardToSingleTopic({
        ...prev,
        contestType: optionId,
        theme,
        title: "",
        nominationKind: "standard",
        birthdayMode: "participant",
        candidateSourceMode: "curated",
        nominatorRanking: true,
        candidateTitle: "",
        questions: [prev.questions[0] ?? { id: newQuestionId(), name: "" }],
        step: 1,
      }),
    );
    setStepError(null);
  }

  function handleEntrySourceChange(source: WizardEntrySource) {
    setWizard((prev) => ({
      ...prev,
      ...applyWizardEntrySource(prev, source),
      step: 2,
    }));
    setStepError(null);
  }

  async function submitWithState(
    nextWizard: CreateWizardState,
    options?: { quickPoll?: boolean; requiresContestUnlock?: boolean },
  ) {
    const form = formRef.current;
    if (!form) return;
    if (createSubmitLockRef.current || pending) return;

    const errSource = validateStep(nextWizard, 2, planId);
    if (errSource) {
      setStepError(errSource);
      setWizard({ ...nextWizard, step: 2 });
      setParticipantLimitOpen(false);
      setUnlockSummaryOpen(false);
      return;
    }

    const errResults = validateStep(nextWizard, 4, planId);
    if (errResults) {
      setStepError(errResults);
      setWizard({ ...nextWizard, step: 4 });
      setParticipantLimitOpen(false);
      setUnlockSummaryOpen(false);
      return;
    }

    createSubmitLockRef.current = true;
    setStepError(null);
    // Keep unlock dialog open (shows Creating…); close the participant tip dialog.
    setParticipantLimitOpen(false);
    const fd = new FormData(form);
    // Override hidden fields from the snapshot used for quick poll.
    fd.set("hostName", nextWizard.hostName.trim() || hostName);
    fd.set(
      "title",
      effectiveContestTitle(nextWizard.title, nextWizard.contestType),
    );
    fd.set("description", nextWizard.description);
    fd.set("theme", nextWizard.theme);
    fd.set("nominationKind", nextWizard.nominationKind);
    fd.set("chartCountry", nextWizard.chartCountry);
    fd.set("birthdayOffsetAmount", String(nextWizard.birthdayOffsetAmount));
    fd.set("birthdayOffsetUnit", nextWizard.birthdayOffsetUnit);
    const requiresContestUnlock = options?.requiresContestUnlock === true;
    const source = candidateSourceForMode(
      nextWizard.candidateSourceMode,
      nextWizard.maxNominationsPerParticipant,
    );
    fd.set("candidateSource", source);
    fd.set("requiresContestUnlock", requiresContestUnlock ? "true" : "false");
    fd.set(
      "maxNominationsPerParticipant",
      String(
        requiresContestUnlock
          ? nextWizard.maxNominationsPerParticipant
          : clampNominationsForPlan(
              planId,
              nextWizard.maxNominationsPerParticipant,
              source,
            ),
      ),
    );
    fd.set("candidateTitle", nextWizard.candidateTitle);
    fd.set(
      "allowDuplicateCandidates",
      nextWizard.allowDuplicates ? "true" : "false",
    );
    fd.set("nominationCloseMode", nextWizard.nominationCloseMode);
    fd.set("nominationClosesAt", datetimeLocalToIso(nextWizard.nominationClosesAt));
    fd.set(
      "nominationDurationSeconds",
      String(nextWizard.nominationDurationSeconds),
    );
    fd.set("candidateReveal", coerceWizardCandidateReveal(nextWizard.candidateReveal));
    fd.set("songLinks", nextWizard.songLinks);
    fd.set("candidateSort", nextWizard.candidateSort);
    fd.set("hostParticipates", nextWizard.hostParticipates ? "true" : "false");
    fd.set("voteMutability", nextWizard.voteMutability);
    fd.set("scoringModel", nextWizard.scoringModel);
    fd.set("resultsReveal", nextWizard.resultsReveal);
    fd.set("ballotRevealOrder", nextWizard.ballotRevealOrder);
    fd.set(
      "nominatorRanking",
      nextWizard.nominatorRanking &&
        !nextWizard.resultsAnonymous &&
        allowsNominatorRanking(
          candidateSourceForMode(
            nextWizard.candidateSourceMode,
            nextWizard.maxNominationsPerParticipant,
          ),
          nextWizard.nominationKind,
        )
        ? "true"
        : "false",
    );
    fd.set("nominatorRankingWhen", nextWizard.nominatorRankingWhen);
    fd.set("nominatorResultsReveal", nextWizard.nominatorResultsReveal);
    fd.set(
      "allowVoteOwnNominations",
      nextWizard.candidateSourceMode === "curated" ||
        nextWizard.allowVoteOwnNominations
        ? "true"
        : "false",
    );
    fd.set("resultsAnonymous", nextWizard.resultsAnonymous ? "true" : "false");
    fd.set(
      "showStarPoints",
      nextWizard.showStarPoints && isStarRatingModel(nextWizard.scoringModel)
        ? "true"
        : "false",
    );
    fd.set("showNominees", nextWizard.showNominees ? "true" : "false");

    const curated =
      nextWizard.candidateSourceMode === "curated" ||
      nextWizard.candidateSourceMode === "combined";
    const seedCurated =
      curated &&
      (nextWizard.nominationKind !== "birthday" ||
        nextWizard.birthdayMode === "curated" ||
        nextWizard.theme !== "song");
    const maxCurated = curatedCandidateCount(nextWizard);
    const seedAllCurated = requiresContestUnlock || maxCurated > 0;

    fd.set(
      "maxCuratedCandidates",
      requiresContestUnlock && maxCurated > 0 ? String(maxCurated) : "0",
    );

    const questionsForSeed = nextWizard.questions.slice(0, 1).map((question) => ({
      ...question,
      name: effectiveTopicName(question.name),
    }));

    const stripAnythingSeed = (
      list: typeof nextWizard.draftAnything,
    ) =>
      list.map(({ id, title, url, description }) => ({
        id,
        title,
        url,
        description,
      }));

    const useSharedAnything = anythingUsesSharedCandidates(nextWizard);
    const anythingSharedSeed =
      isAnythingContest(nextWizard) && curated && useSharedAnything
        ? stripAnythingSeed(nextWizard.draftAnything)
        : [];
    const anythingByQuestionSeed =
      isAnythingContest(nextWizard) && curated && !useSharedAnything
        ? Object.fromEntries(
            Object.entries(nextWizard.draftAnythingByQuestion).map(([key, list]) => [
              key,
              stripAnythingSeed(list),
            ]),
          )
        : {};

    fd.set(
      "wizardSeed",
      JSON.stringify({
        questions: questionsForSeed,
        draftAnything: anythingSharedSeed,
        // Effective shared mode (single-topic Always uses draftAnything).
        anythingSharedCandidates: useSharedAnything,
        draftAnythingByQuestion: anythingByQuestionSeed,
        draftSongs:
          nextWizard.theme === "song" && curated ? nextWizard.draftSongs : [],
        draftBirthdayEntries:
          nextWizard.nominationKind === "birthday" &&
          nextWizard.birthdayMode === "curated"
            ? nextWizard.draftBirthdayEntries
            : [],
        maxCuratedCandidates: requiresContestUnlock
          ? maxCurated
          : maxCurated > 0
            ? maxCurated
            : null,
        seedCurated: seedCurated && seedAllCurated,
        photoCount:
          nextWizard.theme === "photo" && curated ? nextWizard.draftPhotos.length : 0,
        // Curated: start on create. Timed noms: persist auto_start_voting for close hook.
        quickPoll:
          options?.quickPoll === true &&
          nextWizard.candidateSourceMode === "curated",
        startVotingImmediately:
          nextWizard.startVotingImmediately &&
          (nextWizard.candidateSourceMode === "curated" ||
            nextWizard.nominationCloseMode === "scheduled" ||
            nextWizard.nominationCloseMode === "duration"),
      }),
    );

    nextWizard.draftPhotos.forEach((photo, index) => {
      fd.set(`photoTitle_${index}`, photo.title);
    });

    const photoFiles: Array<{ key: string; file: File }> = [];
    nextWizard.draftPhotos.forEach((photo, index) => {
      if (photo.file) {
        photoFiles.push({ key: `photoFile_${index}`, file: photo.file });
      }
    });

    const appendAnythingFiles = (list: typeof nextWizard.draftAnything) => {
      for (const candidate of list) {
        if (candidate.file) {
          photoFiles.push({
            key: `anythingFile_${candidate.id}`,
            file: candidate.file,
          });
        }
      }
    };
    if (anythingSharedSeed.length > 0) {
      appendAnythingFiles(nextWizard.draftAnything);
    } else {
      for (const list of Object.values(nextWizard.draftAnythingByQuestion)) {
        appendAnythingFiles(list);
      }
    }

    let preparedBytes = 0;
    const rawTotal = photoFiles.reduce((sum, entry) => sum + entry.file.size, 0);
    // Even before compression, refuse obviously oversized batches with a clear tip.
    if (rawTotal > CREATE_PHOTO_BODY_BUDGET_BYTES * 2) {
      createSubmitLockRef.current = false;
      setStepError(PHOTOS_TOO_MANY_OR_LARGE_MESSAGE);
      setUnlockSummaryOpen(false);
      return;
    }
    try {
      for (const entry of photoFiles) {
        const prepared = await prepareContestPhotoForUpload(entry.file);
        if ("error" in prepared) {
          createSubmitLockRef.current = false;
          setStepError(prepared.error);
          setUnlockSummaryOpen(false);
          return;
        }
        preparedBytes += prepared.size;
        if (preparedBytes > CREATE_PHOTO_BODY_BUDGET_BYTES) {
          createSubmitLockRef.current = false;
          setStepError(PHOTOS_TOO_MANY_OR_LARGE_MESSAGE);
          setUnlockSummaryOpen(false);
          return;
        }
        fd.set(entry.key, prepared);
      }
    } catch {
      createSubmitLockRef.current = false;
      setStepError(PHOTOS_TOO_MANY_OR_LARGE_MESSAGE);
      setUnlockSummaryOpen(false);
      return;
    }

    if (!requiresContestUnlock) {
      clearWizardState();
    }
    startTransition(() => {
      formAction(fd);
    });
  }

  const overPlanSummary = useMemo(
    () => summarizePlanLimitOverage(wizard, planId),
    [wizard, planId],
  );

  const upgradeOptions = useMemo(() => {
    const fitsPlus = canUpgradePlanForWizard(wizard, "plus", activeHostedCount);
    const fitsPro = canUpgradePlanForWizard(wizard, "pro", activeHostedCount);
    return unlockSummaryUpgradeOptions(planId, fitsPlus, fitsPro);
  }, [wizard, planId, activeHostedCount]);

  function requestOverPlanAction(
    action: OverPlanPendingAction,
    kind: OverPlanWarningKind = "curated",
  ) {
    if (typeof window !== "undefined") {
      if (window.sessionStorage.getItem(overPlanAckStorageKey(kind)) === "1") {
        action.apply();
        return;
      }
    }
    setOverPlanPending(action);
    setOverPlanPendingKind(kind);
    setOverPlanWarningOpen(true);
  }

  function confirmOverPlanWarning() {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(overPlanAckStorageKey(overPlanPendingKind), "1");
    }
    overPlanPending?.apply();
    setOverPlanPending(null);
    setOverPlanWarningOpen(false);
  }

  function cancelOverPlanWarning() {
    overPlanPending?.revert();
    setOverPlanPending(null);
    setOverPlanWarningOpen(false);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = wizardRef.current;
    const err = validateStep(current, 4, planId);
    if (err) {
      setStepError(err);
      patchWizard({ step: 4 });
      return;
    }

    if (wizardExceedsPlanLimits(current, planId)) {
      setUnlockSummaryOpen(true);
      return;
    }

    if (
      plan.maxActiveContests != null &&
      activeHostedCount >= plan.maxActiveContests
    ) {
      setStepError(activeContestLimitMessage(planId, current));
      patchWizard({ step: 4 });
      return;
    }

    if (plan.maxMembers != null) {
      setParticipantLimitOpen(true);
      return;
    }

    submitWithState(current);
  }

  useEffect(() => {
    if (state?.error) {
      createSubmitLockRef.current = false;
      saveWizardState(wizardRef.current);
    }
  }, [state?.error]);

  useEffect(() => {
    const nextUrl = state?.checkoutUrl ?? state?.redirectTo;
    if (!nextUrl || typeof window === "undefined") return;
    window.location.assign(nextUrl);
  }, [state?.checkoutUrl, state?.redirectTo]);

  function handleClearDraft() {
    clearWizardState();
    setWizard(defaultWizardState(hostName, planId));
    setStepError(null);
  }

  const candidateLabel = effectiveCandidateTitle(wizard.candidateTitle);
  /** Native date inputs: only past dates (and today) selectable. */
  const birthdayDateMax = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const candidateNounPlural =
    wizard.theme === "song"
      ? "songs"
      : wizard.theme === "photo"
        ? "photos"
        : `${candidateLabel.toLowerCase()}s`;
  const resultsNoun =
    wizard.theme === "song"
      ? "song"
      : wizard.theme === "photo"
        ? "photo"
        : candidateLabel.toLowerCase();
  const titlePlaceholder =
    wizard.contestType === "song"
      ? "e.g. My Song Contest"
      : wizard.contestType === "photo"
        ? "e.g. My Photo Contest"
        : "e.g. Football";
  const curatedUsed = anything
    ? anythingCandidateRowCount(wizard)
    : wizard.theme === "song" && wizard.nominationKind !== "birthday"
      ? wizard.draftSongs.length
      : wizard.theme === "photo"
        ? wizard.draftPhotos.length
        : wizard.draftBirthdayEntries.length;
  const curatedOverPlan =
    plan.maxCuratedCandidates != null && curatedUsed > plan.maxCuratedCandidates;
  const curatedLeft =
    plan.maxCuratedCandidates === null
      ? null
      : Math.max(0, plan.maxCuratedCandidates - curatedUsed);
  const curatedPlanHintText =
    plan.maxCuratedCandidates === null
      ? `Using ${curatedUsed} ${candidateNounPlural}.`
      : curatedOverPlan
        ? `${curatedUsed} ${candidateNounPlural} (${curatedUsed - plan.maxCuratedCandidates} above your plan — unlock at create)`
        : `${curatedLeft} ${candidateNounPlural} left on your plan`;

  // Same Candidate Names for all topics — disabled for now (may restore later).
  // const useSameCandidateNames = wizard.anythingSharedCandidates;
  //
  // function setSharedAnythingCount(count: number) {
  //   const max =
  //     plan.maxCuratedCandidates === null
  //       ? 100
  //       : Math.max(1, plan.maxCuratedCandidates);
  //   const nextCount = Math.min(max, Math.max(1, Math.floor(count) || 2));
  //   setWizard((prev) => ({
  //     ...prev,
  //     draftAnything: syncSharedAnythingDraft(
  //       prev.draftAnything,
  //       nextCount,
  //       prev.anythingSharedBaseName,
  //     ),
  //   }));
  // }
  //
  // function setSharedAnythingBaseName(baseName: string) {
  //   setWizard((prev) => ({
  //     ...prev,
  //     anythingSharedBaseName: baseName,
  //     draftAnything: syncSharedAnythingDraft(
  //       prev.draftAnything,
  //       Math.max(1, prev.draftAnything.length),
  //       baseName,
  //     ),
  //   }));
  // }

  function updateAnythingCandidates(
    _questionId: string,
    updater: (list: DraftAnythingCandidate[]) => DraftAnythingCandidate[],
  ) {
    setWizard((prev) => {
      const draftAnything = updater(prev.draftAnything);
      const firstId = prev.questions[0]?.id;
      return {
        ...prev,
        draftAnything,
        draftAnythingByQuestion: firstId
          ? { ...prev.draftAnythingByQuestion, [firstId]: draftAnything }
          : prev.draftAnythingByQuestion,
      };
    });
  }

  function renderAnythingCandidateSection(questionId: string, heading: string) {
    // Single-topic Anything always edits the shared draftAnything list.
    const candidates = wizard.draftAnything;

    return (
      <div key={questionId} className="space-y-3">
        <p className="text-sm font-medium">{heading}</p>
        {candidates.map((candidate, index) => {
          const hasExtras = anythingCandidateHasExtras(candidate);
          const detailsOpen =
            hasExtras || anythingDetailsOpenIds.has(candidate.id);

          return (
            <div
              key={candidate.id}
              className="space-y-2 rounded-lg border p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={`anything-title-${index}`}>
                  {candidateLabel} {index + 1}
                </Label>
                {candidates.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() =>
                      updateAnythingCandidates(questionId, (list) =>
                        list.filter((entry) => entry.id !== candidate.id),
                      )
                    }
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
              <Input
                id={`anything-title-${index}`}
                ref={registerFocus(`anything-title:${index}`)}
                value={candidate.title}
                placeholder={`Type a ${candidateLabel.toLowerCase()}…`}
                maxLength={120}
                onChange={(event) => {
                  const title = event.target.value;
                  updateAnythingCandidates(questionId, (list) =>
                    list.map((entry) =>
                      entry.id === candidate.id ? { ...entry, title } : entry,
                    ),
                  );
                }}
              />
              {detailsOpen ? (
                <div className="space-y-2">
                  <Input
                    value={candidate.url}
                    placeholder="Link (optional)"
                    maxLength={500}
                    onChange={(event) => {
                      const url = event.target.value;
                      updateAnythingCandidates(questionId, (list) =>
                        list.map((entry) =>
                          entry.id === candidate.id ? { ...entry, url } : entry,
                        ),
                      );
                    }}
                  />
                  <Input
                    value={candidate.description}
                    placeholder="Comment (optional)"
                    maxLength={500}
                    onChange={(event) => {
                      const description = event.target.value;
                      updateAnythingCandidates(questionId, (list) =>
                        list.map((entry) =>
                          entry.id === candidate.id
                            ? { ...entry, description }
                            : entry,
                        ),
                      );
                    }}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <label
                      className={cn(
                        "inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border border-input",
                        "bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                      title="Attach pic/file"
                    >
                      <PaperclipIcon className="size-4" weight="bold" />
                      <span className="sr-only">Attach pic/file</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0] ?? null;
                          event.target.value = "";
                          if (!file) {
                            updateAnythingCandidates(questionId, (list) =>
                              list.map((entry) =>
                                entry.id === candidate.id
                                  ? { ...entry, file: null }
                                  : entry,
                              ),
                            );
                            return;
                          }
                          void prepareContestPhotoForUpload(file).then((prepared) => {
                            if ("error" in prepared) {
                              setStepError(prepared.error);
                              return;
                            }
                            setStepError(null);
                            updateAnythingCandidates(questionId, (list) =>
                              list.map((entry) =>
                                entry.id === candidate.id
                                  ? { ...entry, file: prepared }
                                  : entry,
                              ),
                            );
                          });
                        }}
                      />
                    </label>
                    {candidate.file ? (
                      <>
                        <span className="max-w-[12rem] truncate text-xs text-muted-foreground">
                          {candidate.file.name}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() =>
                            updateAnythingCandidates(questionId, (list) =>
                              list.map((entry) =>
                                entry.id === candidate.id
                                  ? { ...entry, file: null }
                                  : entry,
                              ),
                            )
                          }
                          aria-label="Remove attachment"
                        >
                          <XIcon className="size-3.5" />
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Attach pic/file
                      </span>
                    )}
                  </div>
                  {candidate.file ? (
                    <LocalPhotoFilePreview
                      file={candidate.file}
                      alt={candidate.title.trim() || candidateLabel}
                    />
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() =>
                    setAnythingDetailsOpenIds((prev) => {
                      const next = new Set(prev);
                      next.add(candidate.id);
                      return next;
                    })
                  }
                >
                  Add link, comment, or file
                </button>
              )}
            </div>
          );
        })}
        <div className="space-y-1.5">
            <WizardAddAnotherButton
              overPlan={
                plan.maxCuratedCandidates != null &&
                curatedUsed >= plan.maxCuratedCandidates
              }
              onClick={() => {
                const addCandidate = () => {
                  const newId = newAnythingCandidateId();
                  let nextIndex = 0;
                  // Commit row + expanded optional fields in one paint so scroll
                  // clearance is measured against the final card height.
                  flushSync(() => {
                    setWizard((prev) => {
                      nextIndex = prev.draftAnything.length;
                      const draftAnything = [
                        ...prev.draftAnything,
                        { ...emptyAnythingCandidate(), id: newId },
                      ];
                      const firstId = prev.questions[0]?.id;
                      return {
                        ...prev,
                        draftAnything,
                        draftAnythingByQuestion: firstId
                          ? {
                              ...prev.draftAnythingByQuestion,
                              [firstId]: draftAnything,
                            }
                          : prev.draftAnythingByQuestion,
                      };
                    });
                  });
                  focusById(`anything-title-${nextIndex}`, { keyboardSafe: true });
                };
                if (
                  plan.maxCuratedCandidates != null &&
                  curatedUsed >= plan.maxCuratedCandidates
                ) {
                  requestOverPlanAction({ apply: addCandidate, revert: () => {} });
                  return;
                }
                addCandidate();
              }}
            >
              Add another {candidateLabel.toLowerCase()}
            </WizardAddAnotherButton>
            <p className="text-xs text-muted-foreground">{curatedPlanHintText}</p>
          </div>
          <div className="space-y-2 rounded-lg border border-dashed border-border/80 p-3">
            <p className="text-xs font-medium text-foreground">
              Saved {candidateLabel.toLowerCase()} lists
            </p>
            <p className="text-xs text-muted-foreground">
              Save this squad once, then load it for the next match in a click.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const defaultName =
                    wizard.title.trim() ||
                    wizard.questions[0]?.name.trim() ||
                    `${candidateLabel} list`;
                  const name =
                    typeof window !== "undefined"
                      ? window.prompt(
                          `Name for this ${candidateLabel.toLowerCase()} list`,
                          defaultName,
                        )
                      : null;
                  if (!name?.trim()) return;
                  const saved = saveAnythingCandidatePreset({
                    name,
                    candidateTitle: wizard.candidateTitle,
                    candidates: wizard.draftAnything,
                  });
                  if (!saved) {
                    setPresetMessage(
                      `Add at least one ${candidateLabel.toLowerCase()} before saving.`,
                    );
                    return;
                  }
                  setAnythingPresets(listAnythingCandidatePresets());
                  setPresetMessage(`Saved “${saved.name}”.`);
                }}
              >
                Save list
              </Button>
            </div>
            {anythingPresets.length > 0 ? (
              <ul className="space-y-1.5">
                {anythingPresets.map((preset) => (
                  <li
                    key={preset.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      {preset.name}
                      <span className="text-muted-foreground">
                        {" "}
                        · {preset.candidates.length}
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2"
                        onClick={() => {
                          if (anythingDraftHasFilledCandidates(wizard)) {
                            setPendingPresetLoad(preset);
                            return;
                          }
                          setWizard((prev) =>
                            applyAnythingCandidatePreset(prev, preset, "replace"),
                          );
                          setPresetMessage(`Loaded “${preset.name}”.`);
                        }}
                      >
                        Load
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-muted-foreground"
                        onClick={() => {
                          deleteAnythingCandidatePreset(preset.id);
                          setAnythingPresets(listAnythingCandidatePresets());
                          setPresetMessage(null);
                        }}
                      >
                        Delete
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {presetMessage ? (
              <p className="text-xs text-muted-foreground">{presetMessage}</p>
            ) : null}
          </div>
      </div>
    );
  }

  function renderCandidateRevealField(id = "candidateReveal") {
    const value = coerceWizardCandidateReveal(wizard.candidateReveal);
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{wizardCandidateRevealQuestion(wizard)}</Label>
        <select
          id={id}
          className={ADMIN_SELECT_CLASS}
          value={value}
          onChange={(event) =>
            patchWizard({
              candidateReveal: event.target
                .value as CreateWizardState["candidateReveal"],
            })
          }
        >
          {WIZARD_CANDIDATE_REVEAL_KEYS.map((key) => (
            <option key={key} value={key}>
              {wizardCandidateRevealOption(wizard, key).label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          {wizardCandidateRevealOption(wizard, value).description}
        </p>
      </div>
    );
  }

  return (
    <>
      <Dialog
        open={draftChoiceOpen}
        onOpenChange={(open) => {
          // Require an explicit New / Continue choice.
          if (open) setDraftChoiceOpen(true);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Saved draft found</DialogTitle>
            <DialogDescription>
              There is already data in the create form from a previous visit.
              Continue where you left off, or start a new contest (saved data will
              be lost).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={startFreshDraft}>
              New
            </Button>
            <Button type="button" onClick={continueSavedDraft}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingPresetLoad != null}
        onOpenChange={(open) => {
          if (!open) setPendingPresetLoad(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Load “{pendingPresetLoad?.name ?? "saved list"}”?
            </DialogTitle>
            <DialogDescription>
              You already have {candidateLabel.toLowerCase()}s entered. Replace
              them all with this list, or add the saved {candidateLabel.toLowerCase()}s
              at the end?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
            <Button
              type="button"
              onClick={() => {
                const preset = pendingPresetLoad;
                if (!preset) return;
                setWizard((prev) =>
                  applyAnythingCandidatePreset(prev, preset, "replace"),
                );
                setPendingPresetLoad(null);
                setPresetMessage(`Replaced with “${preset.name}”.`);
              }}
            >
              Replace all
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const preset = pendingPresetLoad;
                if (!preset) return;
                setWizard((prev) =>
                  applyAnythingCandidatePreset(prev, preset, "append"),
                );
                setPendingPresetLoad(null);
                setPresetMessage(`Added “${preset.name}” at the end.`);
              }}
            >
              Add at the end
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPendingPresetLoad(null)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!hydrated ? (
        <p className="text-sm text-muted-foreground">
          {draftChoiceOpen
            ? "Choose whether to continue your draft or start fresh."
            : "Loading…"}
        </p>
      ) : (
    <div className="space-y-4">

      <div
        data-wizard-sticky-chrome
        className={cn(
          "sticky top-14 z-40 -mx-6 space-y-1.5 border-b border-border/60 px-6 py-3",
          "bg-background/90 backdrop-blur-sm supports-[backdrop-filter]:bg-background/75",
        )}
      >
        <h1 className="truncate text-lg font-semibold tracking-tight text-foreground sm:text-xl">
          {wizard.step === 0
            ? "What contest do you want to create?"
            : effectiveContestTitle(wizard.title, wizard.contestType)}
        </h1>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {wizard.step === 0 ? (
            <p className="text-sm text-muted-foreground">
              {plan.label} plan
              {plan.maxActiveContests === null
                ? " · unlimited active contests"
                : ` · ${activeHostedCount} of ${plan.maxActiveContests} active contests used`}
            </p>
          ) : (
            <p className="text-sm font-medium text-foreground">
              Step {displayStep(wizard)} of {displayStepTotal(wizard)} ·{" "}
              {wizardStepTitle(
                wizard.step,
                wizard.contestType,
                wizard.candidateTitle,
              )}
            </p>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={handleClearDraft}>
            Clear draft
          </Button>
        </div>
        {wizard.step > 0 ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {wizardSettingsSummary(wizard)}
          </p>
        ) : null}
      </div>

    <Card className="overflow-visible">
      <CardContent className="pt-6">
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="hostName" value={wizard.hostName.trim() || hostName} />
      <input
        type="hidden"
        name="title"
        value={effectiveContestTitle(wizard.title, wizard.contestType)}
      />
      <input type="hidden" name="description" value={wizard.description} />
      <input type="hidden" name="theme" value={wizard.theme} />
      <input type="hidden" name="nominationKind" value={wizard.nominationKind} />
      <input type="hidden" name="chartCountry" value={wizard.chartCountry} />
      <input
        type="hidden"
        name="birthdayOffsetAmount"
        value={wizard.birthdayOffsetAmount}
      />
      <input type="hidden" name="birthdayOffsetUnit" value={wizard.birthdayOffsetUnit} />
      <input type="hidden" name="candidateSource" value={candidateSource} />
      <input type="hidden" name="maxNominationsPerParticipant" value={clampedNoms} />
      <input type="hidden" name="candidateTitle" value={wizard.candidateTitle} />
      <input
        type="hidden"
        name="allowDuplicateCandidates"
        value={wizard.allowDuplicates ? "true" : "false"}
      />
      <input type="hidden" name="nominationCloseMode" value={wizard.nominationCloseMode} />
      <input
        type="hidden"
        name="nominationClosesAt"
        value={datetimeLocalToIso(wizard.nominationClosesAt)}
      />
      <input
        type="hidden"
        name="nominationDurationSeconds"
        value={wizard.nominationDurationSeconds}
      />
      <input
        type="hidden"
        name="candidateReveal"
        value={coerceWizardCandidateReveal(wizard.candidateReveal)}
      />
      <input type="hidden" name="songLinks" value={wizard.songLinks} />
      <input type="hidden" name="candidateSort" value={wizard.candidateSort} />
      <input
        type="hidden"
        name="hostParticipates"
        value={wizard.hostParticipates ? "true" : "false"}
      />
      <input type="hidden" name="voteMutability" value={wizard.voteMutability} />
      <input type="hidden" name="scoringModel" value={wizard.scoringModel} />
      <input type="hidden" name="resultsReveal" value={wizard.resultsReveal} />
      <input type="hidden" name="ballotRevealOrder" value={wizard.ballotRevealOrder} />
      <input
        type="hidden"
        name="nominatorRanking"
        value={
          wizard.nominatorRanking && !wizard.resultsAnonymous ? "true" : "false"
        }
      />
      <input type="hidden" name="nominatorRankingWhen" value={wizard.nominatorRankingWhen} />
      <input
        type="hidden"
        name="nominatorResultsReveal"
        value={wizard.nominatorResultsReveal}
      />
      <input
        type="hidden"
        name="allowVoteOwnNominations"
        value={
          curatedOnly || wizard.allowVoteOwnNominations ? "true" : "false"
        }
      />
      <input
        type="hidden"
        name="resultsAnonymous"
        value={wizard.resultsAnonymous ? "true" : "false"}
      />
      <input
        type="hidden"
        name="showStarPoints"
        value={
          wizard.showStarPoints && isStarRatingModel(wizard.scoringModel)
            ? "true"
            : "false"
        }
      />
      <input
        type="hidden"
        name="showNominees"
        value={wizard.showNominees ? "true" : "false"}
      />
      <input
        type="hidden"
        name="startVotingImmediately"
        value={
          showStartVotingImmediately && wizard.startVotingImmediately
            ? "true"
            : "false"
        }
      />

      {wizard.step === 0 ? (
        <div className="space-y-5">
          <div className="space-y-3">
            {CONTEST_TYPE_OPTIONS.map((option) => (
              <button
                key={option.id}
                id={`contest-type-${option.id}`}
                type="button"
                className={cn(
                  "flex h-16 w-full items-center justify-center rounded-xl border-2 border-primary/35",
                  "bg-primary/8 px-6 text-lg font-semibold tracking-tight text-foreground",
                  "shadow-sm transition-colors",
                  "hover:border-primary/55 hover:bg-primary/14 hover:shadow-md",
                  "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                )}
                onClick={() => handleContestTypeChange(option.id, option.theme)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {CREATE_CONTEST_TYPE_INTRO}
          </p>
        </div>
      ) : null}

      {wizard.step === 1 ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="titleVisible">Contest title</Label>
            <Input
              id="titleVisible"
              ref={registerFocus("contest-title")}
              value={wizard.title}
              onChange={(event) => patchWizard({ title: event.target.value })}
              placeholder={titlePlaceholder}
              maxLength={80}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to use &ldquo;
              {effectiveContestTitle("", wizard.contestType)}
              &rdquo;.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="topic-0">Topic / Question</Label>
            <Input
              id="topic-0"
              ref={registerFocus("topic-0")}
              value={wizard.questions[0]?.name ?? ""}
              placeholder={topicPlaceholder(wizard)}
              maxLength={120}
              onChange={(event) => {
                const name = event.target.value;
                setWizard((prev) => ({
                  ...prev,
                  questions: [
                    {
                      id: prev.questions[0]?.id ?? newQuestionId(),
                      name,
                    },
                  ],
                }));
              }}
            />
            <p className="text-xs text-muted-foreground">
              Shown on the ballot as the voting question. Leave blank to use
              &ldquo;Vote one of the following&rdquo;.
            </p>
          </div>

          {wizard.contestType === "anything" ? (
            <div className="space-y-2">
              <Label htmlFor="candidateTitleSetup">Candidate description</Label>
              <Input
                id="candidateTitleSetup"
                ref={registerFocus("candidate-title")}
                value={wizard.candidateTitle}
                onChange={(event) =>
                  patchWizard({ candidateTitle: event.target.value })
                }
                placeholder="e.g. Player"
                maxLength={40}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to use &ldquo;{DEFAULT_CANDIDATE_TITLE}&rdquo;. Participants
                see {candidateLabel} 1, {candidateLabel} 2, …
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>
              {wizardSourcePickerLabel(wizard.contestType, wizard.candidateTitle)}
            </Label>
            <div className="space-y-2">
              {(
                wizard.contestType === "song"
                  ? ([
                      [
                        "birthday",
                        "Birthday Song Contest",
                        "The app nominates each participant’s chart #1 hit from their date of birth.",
                      ],
                      [
                        "curated",
                        "Curated",
                        "You curate the list of songs participants will vote on.",
                      ],
                      [
                        "user",
                        "User nominated",
                        "Participants nominate their favorite songs to be voted on.",
                      ],
                      [
                        "combined",
                        "Combined",
                        "You curate some songs; participants can nominate more favorites too.",
                      ],
                    ] as const)
                  : wizard.contestType === "photo"
                    ? ([
                        [
                          "curated",
                          "Curated",
                          "You curate the list of photos participants will vote on.",
                        ],
                        [
                          "user",
                          "User nominated",
                          "Participants nominate their favorite photos to be voted on.",
                        ],
                        [
                          "combined",
                          "Combined",
                          "You curate some photos; participants can nominate more favorites too.",
                        ],
                      ] as const)
                    : ([
                        [
                          "curated",
                          "Curated",
                          `You curate the list of ${candidateLabel.toLowerCase()}s participants will vote on.`,
                        ],
                        [
                          "user",
                          "User nominated",
                          `Participants nominate their favorite ${candidateLabel.toLowerCase()}s to be voted on.`,
                        ],
                        [
                          "combined",
                          "Combined",
                          `You curate some ${candidateLabel.toLowerCase()}s; participants can nominate more favorites too.`,
                        ],
                      ] as const)
              ).map(([mode, label, description]) => {
                const selected = wizardEntrySource(wizard) === mode;
                return (
                  <label
                    key={mode}
                    className={cn(adminOptionCardClass(selected), "w-full cursor-pointer")}
                  >
                    <input
                      type="radio"
                      name="wizardEntrySource"
                      className={ADMIN_RADIO_CLASS}
                      checked={selected}
                      onChange={() => handleEntrySourceChange(mode)}
                    />
                    <span className="space-y-0.5">
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {wizard.step === 2 ? (
        <div className="space-y-5">
          {wizard.nominationKind === "birthday" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Who provides birth dates?</Label>
                <div className="space-y-2">
                  {(
                    [
                      [
                        "participant",
                        "Users themselves",
                        "Invited participants will be asked to submit their birth dates as part of the song contest flow.",
                      ],
                      [
                        "curated",
                        "Host",
                        "You enter every participant’s name and birthday before the contest starts.",
                      ],
                    ] as const
                  ).map(([mode, label, description]) => (
                    <label
                      key={mode}
                      className={adminOptionCardClass(wizard.birthdayMode === mode)}
                    >
                      <input
                        id={mode === "participant" ? "birthday-mode-participant" : undefined}
                        type="radio"
                        name="birthdayMode"
                        className={ADMIN_RADIO_CLASS}
                        checked={wizard.birthdayMode === mode}
                        onChange={() =>
                          patchWizard({
                            birthdayMode: mode,
                            candidateSourceMode:
                              mode === "participant" ? "user" : "curated",
                            ...(mode === "participant"
                              ? { maxNominationsPerParticipant: 1 }
                              : {
                                  draftBirthdayEntries:
                                    wizard.draftBirthdayEntries.length >= 2
                                      ? wizard.draftBirthdayEntries
                                      : [
                                          ...wizard.draftBirthdayEntries,
                                          ...Array.from(
                                            {
                                              length:
                                                2 - wizard.draftBirthdayEntries.length,
                                            },
                                            () => ({
                                              displayName: "",
                                              birthday: "",
                                            }),
                                          ),
                                        ],
                                }),
                          })
                        }
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
                  value={wizard.chartCountry}
                  onChange={(event) =>
                    patchWizard({ chartCountry: event.target.value })
                  }
                >
                  {(CONTEST_CHART_COUNTRIES as readonly ChartCountry[]).map((key) => (
                    <option key={key} value={key}>
                      {CHART_COUNTRY_OPTIONS[key].label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {CHART_COUNTRY_OPTIONS[wizard.chartCountry as ChartCountry]
                    ?.description}
                </p>
              </div>

              <WizardOptionsDivider />

              <AdminSwitchField
                id="birthdayOffsetEnabled"
                label="Birthday offset"
                description={
                  wizard.birthdayOffsetAmount !== 0
                    ? "Shift the chart date relative to each birthday (e.g. +18 years for an 18th-birthday hit, or −9 months for what parents may have heard)."
                    : "Use the chart #1 from the exact birth week — no offset."
                }
                checked={wizard.birthdayOffsetAmount !== 0}
                onCheckedChange={(enabled) => {
                  if (!enabled) {
                    patchWizard({ birthdayOffsetAmount: 0 });
                    return;
                  }
                  if (wizard.birthdayOffsetAmount === 0) {
                    patchWizard({
                      birthdayOffsetAmount: 18,
                      birthdayOffsetUnit: "years",
                    });
                  }
                }}
              />
              {wizard.birthdayOffsetAmount !== 0 ? (
                <BirthdayOffsetFields
                  amount={wizard.birthdayOffsetAmount}
                  unit={wizard.birthdayOffsetUnit}
                  onAmountChange={(amount) =>
                    patchWizard({ birthdayOffsetAmount: amount })
                  }
                  onUnitChange={(unit) =>
                    patchWizard({ birthdayOffsetUnit: unit as BirthdayOffsetUnit })
                  }
                />
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="nominationCloseMode">When do nominations close?</Label>
                <select
                  id="nominationCloseMode"
                  className={ADMIN_SELECT_CLASS}
                  value={wizard.nominationCloseMode}
                  onChange={(event) => {
                    const nominationCloseMode = event.target
                      .value as CreateWizardState["nominationCloseMode"];
                    patchWizard({
                      nominationCloseMode,
                      ...(nominationCloseMode === "manual" && !curatedOnly
                        ? { startVotingImmediately: false }
                        : {}),
                    });
                  }}
                >
                  <option value="manual">Host closes manually</option>
                  <option value="scheduled">Scheduled time</option>
                  <option value="duration">Host timed window</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  {nominationCloseModeDescription(wizard.nominationCloseMode)}
                </p>
              </div>
              {wizard.nominationCloseMode === "scheduled" ? (
                <div className="space-y-2">
                  <Label htmlFor="nominationClosesAt">Nominations close at</Label>
                  <Input
                    id="nominationClosesAt"
                    type="datetime-local"
                    value={wizard.nominationClosesAt}
                    onChange={(event) =>
                      patchWizard({ nominationClosesAt: event.target.value })
                    }
                  />
                </div>
              ) : null}
              {wizard.nominationCloseMode === "duration" ? (
                <NominationDurationPicker
                  valueSeconds={wizard.nominationDurationSeconds}
                  onChange={(nominationDurationSeconds) =>
                    patchWizard({ nominationDurationSeconds })
                  }
                />
              ) : null}
              {nominationCloseIsTimed ? (
                <AdminSwitchField
                  id="startVotingImmediatelyBirthday"
                  label="Start voting immediately"
                  description={
                    wizard.startVotingImmediately
                      ? "When nominations close automatically, voting opens right away."
                      : "Voting stays closed until the host starts it after nominations."
                  }
                  checked={wizard.startVotingImmediately}
                  onCheckedChange={(checked) =>
                    patchWizard({ startVotingImmediately: checked })
                  }
                />
              ) : null}

              {renderCandidateRevealField("candidateRevealBirthday")}

              <div className="space-y-2">
                <Label htmlFor="songLinks">Song links</Label>
                <select
                  id="songLinks"
                  className={ADMIN_SELECT_CLASS}
                  value={wizard.songLinks}
                  onChange={(event) =>
                    patchWizard({
                      songLinks: event.target.value as CreateWizardState["songLinks"],
                    })
                  }
                >
                  {(Object.keys(SONG_LINKS_OPTIONS) as CreateWizardState["songLinks"][]).map(
                    (key) => (
                      <option key={key} value={key}>
                        {SONG_LINKS_OPTIONS[key].label}
                      </option>
                    ),
                  )}
                </select>
                <p className="text-xs text-muted-foreground">
                  {SONG_LINKS_OPTIONS[wizard.songLinks].description}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="candidateSort">Song order</Label>
                <select
                  id="candidateSort"
                  className={ADMIN_SELECT_CLASS}
                  value={wizard.candidateSort}
                  onChange={(event) =>
                    patchWizard({
                      candidateSort: event.target.value as CreateWizardState["candidateSort"],
                    })
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
                      wizard.candidateSort as keyof typeof CANDIDATE_SORT_OPTIONS
                    ]?.description
                  }
                </p>
              </div>

              {wizard.birthdayMode === "curated" ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium">Participants’ birth dates</p>
                  <p className="text-xs text-muted-foreground">
                    Add at least two birth dates. A name is required for each date
                    you enter; empty rows are ignored.
                  </p>
                  {wizard.draftBirthdayEntries.map((entry, index) => (
                    <div
                      key={`bd-${index}`}
                      className="grid gap-2 rounded-md border p-3 sm:grid-cols-2"
                    >
                      <div className="flex justify-between sm:col-span-2 space-y-1">
                        <Label>Participant {index + 1}</Label>
                        {wizard.draftBirthdayEntries.length > 2 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setWizard((prev) => ({
                                ...prev,
                                draftBirthdayEntries: prev.draftBirthdayEntries.filter(
                                  (_, i) => i !== index,
                                ),
                              }))
                            }
                          >
                            Remove
                          </Button>
                        ) : null}
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`bd-name-${index}`}>Name</Label>
                        <Input
                          id={`bd-name-${index}`}
                          ref={registerFocus(`birthday-name:${index}`)}
                          value={entry.displayName}
                          placeholder="e.g. Anna"
                          onChange={(event) =>
                            setWizard((prev) => ({
                              ...prev,
                              draftBirthdayEntries: prev.draftBirthdayEntries.map((e, i) =>
                                i === index ? { ...e, displayName: event.target.value } : e,
                              ),
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`bd-date-${index}`}>Birth date</Label>
                        <Input
                          id={`bd-date-${index}`}
                          type="date"
                          min="1900-01-01"
                          max={birthdayDateMax}
                          value={entry.birthday}
                          onChange={(event) =>
                            setWizard((prev) => ({
                              ...prev,
                              draftBirthdayEntries: prev.draftBirthdayEntries.map((e, i) =>
                                i === index ? { ...e, birthday: event.target.value } : e,
                              ),
                            }))
                          }
                        />
                      </div>
                    </div>
                  ))}
                  <div className="space-y-1">
                      <WizardAddAnotherButton
                        overPlan={
                          plan.maxCuratedCandidates != null &&
                          curatedUsed >= plan.maxCuratedCandidates
                        }
                        onClick={() => {
                          const addPerson = () => {
                            const newIndex = wizard.draftBirthdayEntries.length;
                            setWizard((prev) => ({
                              ...prev,
                              draftBirthdayEntries: [
                                ...prev.draftBirthdayEntries,
                                { displayName: "", birthday: "" },
                              ],
                            }));
                            focusKey(`birthday-name:${newIndex}`, { keyboardSafe: true });
                          };
                          if (
                            plan.maxCuratedCandidates != null &&
                            curatedUsed >= plan.maxCuratedCandidates
                          ) {
                            requestOverPlanAction({ apply: addPerson, revert: () => {} });
                            return;
                          }
                          addPerson();
                        }}
                      >
                        Add another person
                      </WizardAddAnotherButton>
                      {curatedPlanHintText ? (
                        <p className="text-xs text-muted-foreground">{curatedPlanHintText}</p>
                      ) : null}
                    </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {wizard.nominationKind !== "birthday" &&
          curatedSection &&
          wizard.theme === "song" ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">Host nominated Songs</p>
              {wizard.draftSongs.map((song, index) => (
                <div key={`song-${index}`} className="space-y-2 rounded-md border p-3">
                  {wizard.draftSongs.length > 1 ? (
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setWizard((prev) => ({
                            ...prev,
                            draftSongs: prev.draftSongs.filter((_, i) => i !== index),
                          }))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  ) : null}
                  <SongPickFields
                    compact
                    idPrefix={`draft-song-${index}`}
                    searchLabel={`Song ${index + 1}`}
                    value={song}
                    onChange={(value: SongPickValue) =>
                      setWizard((prev) => ({
                        ...prev,
                        draftSongs: prev.draftSongs.map((s, i) =>
                          i === index ? value : s,
                        ),
                      }))
                    }
                  />
                </div>
              ))}
              <div className="space-y-1">
                  <WizardAddAnotherButton
                    overPlan={
                      plan.maxCuratedCandidates != null &&
                      curatedUsed >= plan.maxCuratedCandidates
                    }
                    onClick={() => {
                      const addSong = () => {
                        const newIndex = wizard.draftSongs.length;
                        setWizard((prev) => ({
                          ...prev,
                          draftSongs: [
                            ...prev.draftSongs,
                            { title: "", artist: "", previewUrl: "" },
                          ],
                        }));
                        focusById(`draft-song-${newIndex}-search`, { keyboardSafe: true });
                      };
                      if (
                        plan.maxCuratedCandidates != null &&
                        curatedUsed >= plan.maxCuratedCandidates
                      ) {
                        requestOverPlanAction({ apply: addSong, revert: () => {} });
                        return;
                      }
                      addSong();
                    }}
                  >
                    Add another song
                  </WizardAddAnotherButton>
                  {curatedPlanHintText ? (
                    <p className="text-xs text-muted-foreground">{curatedPlanHintText}</p>
                  ) : null}
                </div>

              {curatedOnly ? (
                <>
                  <WizardOptionsDivider />
                  {renderCandidateRevealField("candidateReveal")}
                  <div className="space-y-2">
                    <Label htmlFor="songLinksCurated">Song links</Label>
                    <select
                      id="songLinksCurated"
                      className={ADMIN_SELECT_CLASS}
                      value={wizard.songLinks}
                      onChange={(event) =>
                        patchWizard({
                          songLinks: event.target.value as CreateWizardState["songLinks"],
                        })
                      }
                    >
                      {(Object.keys(SONG_LINKS_OPTIONS) as CreateWizardState["songLinks"][]).map(
                        (key) => (
                          <option key={key} value={key}>
                            {SONG_LINKS_OPTIONS[key].label}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="candidateSortCuratedSong">Song order</Label>
                    <select
                      id="candidateSortCuratedSong"
                      className={ADMIN_SELECT_CLASS}
                      value={wizard.candidateSort}
                      onChange={(event) =>
                        patchWizard({
                          candidateSort:
                            event.target.value as CreateWizardState["candidateSort"],
                        })
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
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {wizard.nominationKind !== "birthday" &&
          curatedSection &&
          wizard.theme === "photo" ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">Host nominated Photos</p>
              {wizard.draftPhotos.map((photo, index) => (
                  <div key={`photo-${index}`} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Label>Photo {index + 1}</Label>
                      {wizard.draftPhotos.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setWizard((prev) => ({
                              ...prev,
                              draftPhotos: prev.draftPhotos.filter((_, i) => i !== index),
                            }))
                          }
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label
                        className={cn(
                          "inline-flex cursor-pointer items-center justify-center rounded-lg border border-input px-3 py-2 text-sm",
                          "bg-background hover:bg-muted/60",
                        )}
                      >
                        Select a photo
                        <input
                          id={`photo-file-${index}`}
                          ref={registerFocus(`photo-file:${index}`)}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="sr-only"
                          onChange={(event) => {
                            const file = event.target.files?.[0] ?? null;
                            event.target.value = "";
                            if (!file) {
                              setWizard((prev) => ({
                                ...prev,
                                draftPhotos: prev.draftPhotos.map((p, i) =>
                                  i === index
                                    ? {
                                        title: p.title,
                                        file: null,
                                      }
                                    : p,
                                ),
                              }));
                              return;
                            }
                            void prepareContestPhotoForUpload(file).then((prepared) => {
                              if ("error" in prepared) {
                                setStepError(prepared.error);
                                return;
                              }
                              setStepError(null);
                              setWizard((prev) => ({
                                ...prev,
                                draftPhotos: prev.draftPhotos.map((p, i) =>
                                  i === index
                                    ? {
                                        title: p.title,
                                        file: prepared,
                                      }
                                    : p,
                                ),
                              }));
                              window.setTimeout(() => {
                                focusKey(`photo-title:${index}`);
                              }, 0);
                            });
                          }}
                        />
                      </label>
                      {photo.file ? <PhotoFileThumb file={photo.file} /> : null}
                    </div>
                    {photo.file ? (
                      <Input
                        ref={registerFocus(`photo-title:${index}`)}
                        value={photo.title}
                        placeholder="Title (optional)"
                        onChange={(event) =>
                          setWizard((prev) => ({
                            ...prev,
                            draftPhotos: prev.draftPhotos.map((p, i) =>
                              i === index ? { ...p, title: event.target.value } : p,
                            ),
                          }))
                        }
                      />
                    ) : null}
                  </div>
              ))}
              <div className="space-y-1">
                  <WizardAddAnotherButton
                    overPlan={
                      plan.maxCuratedCandidates != null &&
                      curatedUsed >= plan.maxCuratedCandidates
                    }
                    onClick={() => {
                      const addPhoto = () => {
                        const newIndex = wizard.draftPhotos.length;
                        setWizard((prev) => ({
                          ...prev,
                          draftPhotos: [...prev.draftPhotos, { title: "", file: null }],
                        }));
                        window.requestAnimationFrame(() => {
                          window.setTimeout(() => {
                            document.getElementById(`photo-file-${newIndex}`)?.click();
                          }, 0);
                        });
                      };
                      if (
                        plan.maxCuratedCandidates != null &&
                        curatedUsed >= plan.maxCuratedCandidates
                      ) {
                        requestOverPlanAction({ apply: addPhoto, revert: () => {} });
                        return;
                      }
                      addPhoto();
                    }}
                  >
                    Add another photo
                  </WizardAddAnotherButton>
                  {curatedPlanHintText ? (
                    <p className="text-xs text-muted-foreground">{curatedPlanHintText}</p>
                  ) : null}
                  {wizard.theme === "photo" ? (
                    <p className="text-xs text-muted-foreground">
                      Photo files are not kept in the draft. After you unlock, add photos
                      again in the contest if needed.
                    </p>
                  ) : null}
                </div>

              {curatedOnly ? (
                <>
                  <WizardOptionsDivider />
                  {renderCandidateRevealField("candidateReveal")}
                  <div className="space-y-2">
                    <Label htmlFor="candidateSortCuratedPhoto">Photo order</Label>
                    <select
                      id="candidateSortCuratedPhoto"
                      className={ADMIN_SELECT_CLASS}
                      value={wizard.candidateSort}
                      onChange={(event) =>
                        patchWizard({
                          candidateSort:
                            event.target.value as CreateWizardState["candidateSort"],
                        })
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
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {wizard.nominationKind !== "birthday" && curatedSection && anything ? (
            <div className="space-y-4">
              {renderAnythingCandidateSection(
                wizard.questions[0]?.id ?? "",
                `Host nominated ${candidateLabel}s`,
              )}
              {curatedOnly ? (
                <>
                  <WizardOptionsDivider />
                  {renderCandidateRevealField("candidateReveal")}
                  <div className="space-y-2">
                    <Label htmlFor="candidateSortCuratedAnything">
                      {candidateLabel} order
                    </Label>
                    <select
                      id="candidateSortCuratedAnything"
                      className={ADMIN_SELECT_CLASS}
                      value={wizard.candidateSort}
                      onChange={(event) =>
                        patchWizard({
                          candidateSort:
                            event.target.value as CreateWizardState["candidateSort"],
                        })
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
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {wizard.nominationKind !== "birthday" && userSection ? (
            <div className="space-y-3">
              {curatedSection ? <div className="border-t border-border" /> : null}
              <NominationsPerParticipantPicker
                planId={planId}
                value={wizard.maxNominationsPerParticipant}
                hasSession={hasSession}
                isAnonymous={isAnonymous}
                onOverPlanAttempt={(action) =>
                  requestOverPlanAction(action, "nominations")
                }
                onChange={(value) =>
                  patchWizard({ maxNominationsPerParticipant: value })
                }
              />
            </div>
          ) : null}

          {wizard.nominationKind !== "birthday" && !curatedOnly ? (
            <>
              <WizardOptionsDivider />
              {renderCandidateRevealField("candidateReveal")}
              {wizard.theme === "song" ? (
                <div className="flex items-center gap-2">
                  <input
                    id="allowDuplicates"
                    type="checkbox"
                    checked={wizard.allowDuplicates}
                    onChange={(event) =>
                      patchWizard({ allowDuplicates: event.target.checked })
                    }
                    className={ADMIN_CHECKBOX_CLASS}
                  />
                  <Label htmlFor="allowDuplicates">Allow duplicate songs</Label>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="nominationCloseModeUser">When do nominations close?</Label>
                <select
                  id="nominationCloseModeUser"
                  className={ADMIN_SELECT_CLASS}
                  value={wizard.nominationCloseMode}
                  onChange={(event) => {
                    const nominationCloseMode = event.target
                      .value as CreateWizardState["nominationCloseMode"];
                    patchWizard({
                      nominationCloseMode,
                      ...(nominationCloseMode === "manual"
                        ? { startVotingImmediately: false }
                        : {}),
                    });
                  }}
                >
                  <option value="manual">Host closes manually</option>
                  <option value="scheduled">Scheduled time</option>
                  <option value="duration">Host timed window</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  {nominationCloseModeDescription(wizard.nominationCloseMode)}
                </p>
              </div>
              {wizard.nominationCloseMode === "scheduled" ? (
                <div className="space-y-2">
                  <Label htmlFor="nominationClosesAtUser">Nominations close at</Label>
                  <Input
                    id="nominationClosesAtUser"
                    type="datetime-local"
                    value={wizard.nominationClosesAt}
                    onChange={(event) =>
                      patchWizard({ nominationClosesAt: event.target.value })
                    }
                  />
                </div>
              ) : null}
              {wizard.nominationCloseMode === "duration" ? (
                <NominationDurationPicker
                  valueSeconds={wizard.nominationDurationSeconds}
                  onChange={(nominationDurationSeconds) =>
                    patchWizard({ nominationDurationSeconds })
                  }
                />
              ) : null}
              {nominationCloseIsTimed ? (
                <AdminSwitchField
                  id="startVotingImmediatelyNoms"
                  label="Start voting immediately"
                  description={
                    wizard.startVotingImmediately
                      ? "When nominations close automatically, voting opens right away."
                      : "Voting stays closed until the host starts it after nominations."
                  }
                  checked={wizard.startVotingImmediately}
                  onCheckedChange={(checked) =>
                    patchWizard({ startVotingImmediately: checked })
                  }
                />
              ) : null}

              {wizard.theme === "song" ? (
                <div className="space-y-2">
                  <Label htmlFor="songLinksUser">Song links</Label>
                  <select
                    id="songLinksUser"
                    className={ADMIN_SELECT_CLASS}
                    value={wizard.songLinks}
                    onChange={(event) =>
                      patchWizard({
                        songLinks: event.target.value as CreateWizardState["songLinks"],
                      })
                    }
                  >
                    {(Object.keys(SONG_LINKS_OPTIONS) as CreateWizardState["songLinks"][]).map(
                      (key) => (
                        <option key={key} value={key}>
                          {SONG_LINKS_OPTIONS[key].label}
                        </option>
                      ),
                    )}
                  </select>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="candidateSortUser">
                  {wizard.theme === "song"
                    ? "Song order"
                    : wizard.theme === "photo"
                      ? "Photo order"
                      : `${candidateLabel} order`}
                </Label>
                <select
                  id="candidateSortUser"
                  className={ADMIN_SELECT_CLASS}
                  value={wizard.candidateSort}
                  onChange={(event) =>
                    patchWizard({
                      candidateSort:
                        event.target.value as CreateWizardState["candidateSort"],
                    })
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
              </div>

              <AdminSwitchField
                id="showNominees"
                label="Show nominees"
                description={
                  wizard.showNominees
                    ? "List who nominated each candidate in the Candidates tab."
                    : "Hide nominator names — your own picks stay highlighted in the list."
                }
                checked={wizard.showNominees}
                onCheckedChange={(checked) => patchWizard({ showNominees: checked })}
              />
            </>
          ) : null}
        </div>
      ) : null}

      {wizard.step === 3 ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="scoringModel">Scoring model</Label>
            <select
              id="scoringModel"
              className={ADMIN_SELECT_CLASS}
              value={wizard.scoringModel}
              onChange={(event) =>
                patchWizard({
                  scoringModel: event.target.value as CreateWizardState["scoringModel"],
                })
              }
            >
              {(Object.keys(SCORING_MODELS) as CreateWizardState["scoringModel"][]).map(
                (key) => (
                  <option key={key} value={key}>
                    {SCORING_MODELS[key].label}
                  </option>
                ),
              )}
            </select>
            <p className="text-xs text-muted-foreground">
              {SCORING_MODELS[wizard.scoringModel].description}
            </p>
          </div>
          {isStarRatingModel(wizard.scoringModel) ? (
            <AdminSwitchField
              id="showStarPoints"
              label="Show point totals"
              description={
                wizard.showStarPoints
                  ? "Show the numeric point total next to the stars."
                  : "Show stars only — hide numeric point totals."
              }
              checked={wizard.showStarPoints}
              onCheckedChange={(checked) =>
                patchWizard({ showStarPoints: checked })
              }
            />
          ) : null}

          <WizardOptionsDivider />

          <AdminSwitchField
            id="hostParticipates"
            label="Host participates"
            description={
              wizard.hostParticipates
                ? `The host leads the event and can also participate — nominate and vote on ${candidateNounPlural} like any other user.`
                : "The host leads the event and will not participate in voting."
            }
            checked={wizard.hostParticipates}
            onCheckedChange={(checked) => patchWizard({ hostParticipates: checked })}
          />
          {wizard.hostParticipates ? (
            <div className="space-y-2">
              <Label htmlFor="hostNameVisible">You participate as</Label>
              <Input
                id="hostNameVisible"
                value={wizard.hostName}
                onChange={(event) => patchWizard({ hostName: event.target.value })}
                placeholder={
                  !isAnonymous && hostName
                    ? hostName
                    : "Host"
                }
                maxLength={40}
              />
              <p className="text-xs text-muted-foreground">
                {!isAnonymous && hostName
                  ? `Optional nickname for this contest. Leave blank to use your account name (“${hostName}”).`
                  : 'Optional nickname for this contest. Leave blank to appear as “Host”.'}
              </p>
            </div>
          ) : null}

          <AdminSwitchField
            id="voteMutability"
            label="Allow vote changes"
            description={
              wizard.voteMutability === "editable_until_close"
                ? VOTE_MUTABILITY_OPTIONS.editable_until_close.description
                : VOTE_MUTABILITY_OPTIONS.locked_on_submit.description
            }
            checked={wizard.voteMutability === "editable_until_close"}
            onCheckedChange={(checked) =>
              patchWizard({
                voteMutability: checked ? "editable_until_close" : "locked_on_submit",
              })
            }
          />

          {curatedOnly ? (
            <AdminSwitchField
              id="startVotingImmediately"
              label="Start voting immediately"
              description={
                nominationCloseIsTimed
                  ? wizard.startVotingImmediately
                    ? "When nominations close automatically, voting opens right away."
                    : "Voting stays closed until the host starts it after nominations."
                  : wizard.startVotingImmediately
                    ? "Voting opens as soon as the contest is created."
                    : "Voting stays closed until the host starts it."
              }
              checked={wizard.startVotingImmediately}
              onCheckedChange={(checked) =>
                patchWizard({ startVotingImmediately: checked })
              }
            />
          ) : null}

          {!curatedOnly && wizard.nominationKind !== "birthday" ? (
            <AdminSwitchField
              id="allowVoteOwnNominations"
              label="Allow voting for own nominations"
              description={
                wizard.allowVoteOwnNominations
                  ? "Participants can vote for their own nominations."
                  : "Participants can’t vote for their own nominations."
              }
              checked={wizard.allowVoteOwnNominations}
              onCheckedChange={(checked) =>
                patchWizard({ allowVoteOwnNominations: checked })
              }
            />
          ) : null}
        </div>
      ) : null}

      {wizard.step === 4 ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="resultsReveal">How to show results?</Label>
            <select
              id="resultsReveal"
              className={ADMIN_SELECT_CLASS}
              value={wizard.resultsReveal}
              onChange={(event) =>
                patchWizard({
                  resultsReveal: event.target.value as CreateWizardState["resultsReveal"],
                })
              }
            >
              {(Object.keys(RESULTS_REVEAL_OPTIONS) as CreateWizardState["resultsReveal"][]).map(
                (key) => (
                  <option key={key} value={key}>
                    {RESULTS_REVEAL_OPTIONS[key].label}
                  </option>
                ),
              )}
            </select>
            <p className="text-xs text-muted-foreground">
              {RESULTS_REVEAL_OPTIONS[wizard.resultsReveal].description}
            </p>
          </div>

          <WizardOptionsDivider />

          {wizard.resultsReveal === "by_participant" ? (
            <div className="space-y-2">
              <Label htmlFor="ballotRevealOrder">Ballot reveal order</Label>
              <select
                id="ballotRevealOrder"
                className={ADMIN_SELECT_CLASS}
                value={wizard.ballotRevealOrder}
                onChange={(event) =>
                  patchWizard({
                    ballotRevealOrder:
                      event.target.value as CreateWizardState["ballotRevealOrder"],
                  })
                }
              >
                {(
                  Object.keys(
                    BALLOT_REVEAL_ORDER_OPTIONS,
                  ) as CreateWizardState["ballotRevealOrder"][]
                ).map((key) => (
                  <option key={key} value={key}>
                    {BALLOT_REVEAL_ORDER_OPTIONS[key].label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {BALLOT_REVEAL_ORDER_OPTIONS[wizard.ballotRevealOrder].description}
              </p>
            </div>
          ) : null}

          <AdminSwitchField
            id="resultsAnonymous"
            label="Anonymous voting"
            description={
              wizard.resultsAnonymous
                ? "Participant votes stay anonymous — names are not shown with ballots during the contest or results."
                : "Show participant names with their votes during the results presentation."
            }
            checked={wizard.resultsAnonymous}
            onCheckedChange={(checked) =>
              patchWizard({
                resultsAnonymous: checked,
                ...(checked ? { nominatorRanking: false } : {}),
              })
            }
          />

          {!wizard.resultsAnonymous &&
          allowsNominatorRanking(
            candidateSourceForMode(
              wizard.candidateSourceMode,
              wizard.maxNominationsPerParticipant,
            ),
            wizard.nominationKind,
          ) ? (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <AdminSwitchField
                id="nominatorRanking"
                className="border-0 p-0"
                label="Show nominator ranking"
                description={
                  wizard.nominatorRanking
                    ? "Present the ranking of who nominated what."
                    : "Do not present a nominator ranking."
                }
                checked={wizard.nominatorRanking}
                onCheckedChange={(checked) =>
                  patchWizard({ nominatorRanking: checked })
                }
              />
              {wizard.nominatorRanking ? (
                <div className="space-y-3 border-t border-border pt-3">
                  <div className="space-y-2">
                    <Label htmlFor="nominatorRankingWhen">When</Label>
                    <select
                      id="nominatorRankingWhen"
                      className={ADMIN_SELECT_CLASS}
                      value={wizard.nominatorRankingWhen}
                      onChange={(event) =>
                        patchWizard({
                          nominatorRankingWhen:
                            event.target.value as CreateWizardState["nominatorRankingWhen"],
                        })
                      }
                    >
                      {(
                        Object.keys(
                          NOMINATOR_RANKING_WHEN_OPTIONS,
                        ) as CreateWizardState["nominatorRankingWhen"][]
                      ).map((key) => (
                        <option key={key} value={key}>
                          {key === "before"
                            ? `Before ${resultsNoun} results`
                            : key === "after"
                              ? `After ${resultsNoun} results`
                              : `Parallel to ${resultsNoun} results`}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      {NOMINATOR_RANKING_WHEN_OPTIONS[wizard.nominatorRankingWhen]
                        .description}
                    </p>
                  </div>
                  {wizard.nominatorRankingWhen !== "parallel" ? (
                    <div className="space-y-2">
                      <Label htmlFor="nominatorResultsReveal">How</Label>
                      <select
                        id="nominatorResultsReveal"
                        className={ADMIN_SELECT_CLASS}
                        value={
                          WIZARD_NOMINATOR_RESULTS_REVEAL_KEYS.includes(
                            wizard.nominatorResultsReveal,
                          )
                            ? wizard.nominatorResultsReveal
                            : "immediate"
                        }
                        onChange={(event) =>
                          patchWizard({
                            nominatorResultsReveal:
                              event.target
                                .value as CreateWizardState["nominatorResultsReveal"],
                          })
                        }
                      >
                        {WIZARD_NOMINATOR_RESULTS_REVEAL_KEYS.map((key) => (
                          <option key={key} value={key}>
                            {NOMINATOR_RESULTS_REVEAL_OPTIONS[key].label}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground">
                        {
                          NOMINATOR_RESULTS_REVEAL_OPTIONS[
                            WIZARD_NOMINATOR_RESULTS_REVEAL_KEYS.includes(
                              wizard.nominatorResultsReveal,
                            )
                              ? wizard.nominatorResultsReveal
                              : "immediate"
                          ].description
                        }
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <p className="text-sm text-muted-foreground">
            Press Create contest to create &ldquo;
            {effectiveContestTitle(wizard.title, wizard.contestType)}
            &rdquo;.
          </p>
        </div>
      ) : null}


      {stepError || state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {stepError ?? state?.error}
        </p>
      ) : null}

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {wizard.step > 0 ? (
            <Button
              key={`back-${wizard.step}`}
              type="button"
              variant="outline"
              disabled={pending}
              onClick={handleBack}
            >
              Back
            </Button>
          ) : null}
          {wizard.step === 0 ? null : wizard.step < 4 ? (
            <Button key={`next-${wizard.step}`} type="button" onClick={handleNext}>
              Next
            </Button>
          ) : (
            <Button key="create" type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create contest"}
            </Button>
          )}
        </div>
      </div>

      <CreateUnlockSummaryDialog
        open={unlockSummaryOpen}
        onOpenChange={setUnlockSummaryOpen}
        summary={overPlanSummary}
        showPlusUpgrade={upgradeOptions.showPlusUpgrade}
        showProUpgrade={upgradeOptions.showProUpgrade}
        pending={pending}
        error={state?.error ?? stepError}
        onCreateWithinPlan={() => setUnlockSummaryOpen(false)}
        onUnlockAndCreate={() => {
          setStepError(null);
          // Keep dialog open so "Creating…" stays visible on the Unlock button.
          submitWithState(wizardRef.current, { requiresContestUnlock: true });
        }}
      />
      <CreateParticipantLimitDialog
        open={participantLimitOpen}
        onOpenChange={setParticipantLimitOpen}
        maxMembers={plan.maxMembers ?? 0}
        planLabel={plan.label}
        planId={planId}
        hasSession={hasSession}
        isAnonymous={isAnonymous}
        pending={pending}
        onCreateWithPlanLimit={() => {
          submitWithState(wizardRef.current);
        }}
        onUnlockAndCreate={() => {
          setStepError(null);
          submitWithState(wizardRef.current, { requiresContestUnlock: true });
        }}
      />
      <OverPlanWarningDialog
        open={overPlanWarningOpen}
        onContinue={confirmOverPlanWarning}
        onCancel={cancelOverPlanWarning}
        includesPhotos={wizard.theme === "photo"}
      />
    </form>
      </CardContent>
    </Card>
    </div>
      )}
    </>
  );
}
