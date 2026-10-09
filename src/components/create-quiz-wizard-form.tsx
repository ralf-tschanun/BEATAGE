"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { XIcon } from "@phosphor-icons/react";
import { rememberLastfmUsernameAction } from "@/app/actions/lastfm-account";
import { createQuizAction, type QuizActionState } from "@/app/actions/quiz";
import {
  CreateQuizParticipantLimitDialog,
  CreateQuizSlotLimitTipDialog,
  CreateQuizUnlockDialog,
} from "@/components/create-quiz-unlock-dialog";
import {
  ensureLastfmUserExists,
  LastfmErrorAlert,
  LastfmHelpButton,
  LastfmHelpDialog,
  LastfmUserFoundNotice,
  LastfmUserNotFoundAlert,
  useLastfmUserLookup,
} from "@/components/lastfm-help";
import { SongPickFields } from "@/components/song-pick-fields";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { AdminSwitchField } from "@/components/admin-switch-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  WizardAddAnotherButton,
  WizardCollapsibleOptions,
  WizardOptionsDivider,
} from "@/components/wizard-step-ui";
import { BILLING_SKU_LABELS } from "@/lib/billing-copy";
import { CHART_COUNTRY_OPTIONS } from "@/lib/charts";
import { BRAND_NAME } from "@/lib/brand";
import {
  clearQuizWizardState,
  DEFAULT_QUIZ_TITLE,
  defaultQuizWizardState,
  effectiveQuizTitle,
  filledQuizSongs,
  hasMeaningfulQuizWizardDraft,
  loadQuizWizardState,
  loadRememberedLastfmUsername,
  quizWizardSettingsSummary,
  quizWizardStepTitle,
  quickLiveQuizWizardState,
  saveQuizWizardState,
  validateQuizWizardStep,
  type CreateQuizWizardState,
} from "@/lib/create-quiz-wizard";
import {
  DEFAULT_MAX_CURATED_TRACKS,
  getQuizPlanLimits,
  planAllowsQuizTeams,
  QUIZ_UNLOCK_LIMITS,
  type PlanId,
} from "@/lib/quiz-plans";
import type {
  AnswerYearMode,
  ChartCountryCode,
  OverallReveal,
  ScoringModeId,
  YearScoringModeId,
} from "@/lib/quiz-settings";
import {
  AUTO_INTERRUPT_EMPTY_ROUNDS_MAX,
  AUTO_INTERRUPT_EMPTY_ROUNDS_MIN,
  clampYearRangeTolerance,
  primaryYearScoringMode,
  QUIZ_LEADERBOARD_REVEAL_OPTIONS,
  QUIZ_YEAR_SCORING_OPTIONS,
  setYearScoringModeSelection,
  toggleScoringModeSelection,
  YEAR_RANGE_TOLERANCE_MAX,
  YEAR_RANGE_TOLERANCE_MIN,
} from "@/lib/quiz-settings";
import { ADMIN_SELECT_CLASS } from "@/lib/admin-ui";
import type { DashboardIdentity } from "@/lib/quizzes/dashboard";
import {
  isLastfmUserNotFoundMessage,
  lastfmUsernamesMatch,
} from "@/lib/lastfm-messages";
import { useWizardInputFocus } from "@/lib/wizard-input-focus";
import { cn } from "@/lib/utils";

const initialState: QuizActionState = null;

const QUIZ_CHART_COUNTRIES: ChartCountryCode[] = ["DE", "AT", "GB"];

const RANGE_TOLERANCE_PRESETS = [0, 5, 10, 15, 20] as const;

type CreateQuizWizardFormProps = {
  identity?: DashboardIdentity | null;
  defaultHostName?: string | null;
  planId?: PlanId;
  activeHostedCount?: number;
  canCreate?: boolean;
  hasSession?: boolean;
  isAnonymous?: boolean;
  /** Last.fm username stored on the signed-in account. Empty for guests. */
  accountLastfmUsername?: string;
};

export function CreateQuizWizardForm({
  identity = null,
  defaultHostName,
  planId = "free",
  activeHostedCount = 0,
  canCreate = true,
  hasSession = true,
  isAnonymous = false,
  accountLastfmUsername = "",
}: CreateQuizWizardFormProps) {
  const router = useRouter();
  const plan = getQuizPlanLimits(planId);
  const planSongCap = plan.maxCuratedTracks ?? DEFAULT_MAX_CURATED_TRACKS;
  const unlockSongCap = QUIZ_UNLOCK_LIMITS.maxCuratedTracks;
  const hostNameDefault = defaultHostName?.trim() ?? "";
  const [state, formAction] = useActionState(createQuizAction, initialState);
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);
  const [draftChoiceOpen, setDraftChoiceOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [participantLimitOpen, setParticipantLimitOpen] = useState(false);
  const [quickLastfmOpen, setQuickLastfmOpen] = useState(false);
  const [quickLastfmDraft, setQuickLastfmDraft] = useState("");
  const [lastfmHelpOpen, setLastfmHelpOpen] = useState(false);
  const [lastfmChecking, setLastfmChecking] = useState(false);
  const [savedLastfmUsername, setSavedLastfmUsername] = useState(
    accountLastfmUsername.trim().replace(/^@/, ""),
  );
  /** Gate: slot-limit tip before the wizard when there is no free active slot. */
  const [slotGateOpen, setSlotGateOpen] = useState(!canCreate);
  const [slotAcked, setSlotAcked] = useState(canCreate);
  /** Host opted in to unlock this quiz at create (songs, teams, slot). */
  const [unlockForTracks, setUnlockForTracks] = useState(false);
  const canSelfServeUnlock = planId !== "pro";
  const songCap = unlockForTracks && canSelfServeUnlock ? unlockSongCap : planSongCap;
  const planAllowsTeams = planAllowsQuizTeams(planId);
  const [stepError, setStepError] = useState<string | null>(null);
  const [wizard, setWizard] = useState<CreateQuizWizardState>(() =>
    defaultQuizWizardState(hostNameDefault),
  );
  const teamUnlockRequired = wizard.teamsEnabled && !planAllowsTeams;
  const overPlanSongCap = filledQuizSongs(wizard).length > planSongCap;
  const unlockReason =
    !canCreate && (overPlanSongCap || teamUnlockRequired)
      ? "both"
      : !canCreate
        ? "slot"
        : overPlanSongCap || (unlockForTracks && !teamUnlockRequired)
          ? "songs"
          : teamUnlockRequired
            ? "teams"
            : "songs";
  const wizardRef = useRef(wizard);
  wizardRef.current = wizard;
  /** Snapshot for create/unlock dialogs — Quick Live must not pick up draft tweaks. */
  const pendingCreateRef = useRef<CreateQuizWizardState | null>(null);
  const pendingDraftRef = useRef(false);
  const lastfmLookup = useLastfmUserLookup(
    wizard.lastfmUsername,
    wizard.playMode === "auto_lastfm" && wizard.step === 1,
  );
  const quickLastfmLookup = useLastfmUserLookup(
    quickLastfmDraft,
    quickLastfmOpen,
  );
  const { focusById } = useWizardInputFocus([wizard.step, wizard.draftSongs.length]);

  function preferredLastfmUsername(): string {
    // Signed-in accounts win over this browser's copy.
    const account = isAnonymous ? "" : savedLastfmUsername.trim().replace(/^@/, "");
    return account || loadRememberedLastfmUsername();
  }

  useEffect(() => {
    const account = isAnonymous
      ? ""
      : accountLastfmUsername.trim().replace(/^@/, "");
    const remembered = account || loadRememberedLastfmUsername();
    const saved = loadQuizWizardState(hostNameDefault);
    if (saved && hasMeaningfulQuizWizardDraft(saved)) {
      // Prefer draft username; fall back to the account, then this browser.
      const lastfmUsername = saved.lastfmUsername.trim() || remembered;
      setWizard(
        lastfmUsername === saved.lastfmUsername
          ? saved
          : { ...saved, lastfmUsername },
      );
      if (canCreate) {
        setDraftChoiceOpen(true);
      } else {
        // Show draft choice only after the slot-limit tip is acknowledged.
        pendingDraftRef.current = true;
      }
    } else {
      if (remembered) {
        setWizard((prev) => ({ ...prev, lastfmUsername: remembered }));
      }
    }
    setHydrated(true);
  }, [hostNameDefault, canCreate, isAnonymous, accountLastfmUsername]);

  useEffect(() => {
    if (!hydrated || draftChoiceOpen || !slotAcked) return;
    saveQuizWizardState(wizard);
  }, [wizard, hydrated, draftChoiceOpen, slotAcked]);

  useEffect(() => {
    const nextUrl = state?.redirectTo;
    if (!nextUrl || typeof window === "undefined") return;
    clearQuizWizardState();
    window.location.assign(nextUrl);
  }, [state?.redirectTo]);

  useEffect(() => {
    const checkoutUrl = state?.checkoutUrl;
    if (!checkoutUrl || typeof window === "undefined") return;
    clearQuizWizardState();
    window.location.assign(checkoutUrl);
  }, [state?.checkoutUrl]);

  const patchWizard = useCallback((patch: Partial<CreateQuizWizardState>) => {
    setWizard((prev) => {
      const next = { ...prev, ...patch };
      wizardRef.current = next;
      return next;
    });
  }, []);

  function freshWizardState(): CreateQuizWizardState {
    return {
      ...defaultQuizWizardState(hostNameDefault),
      lastfmUsername: preferredLastfmUsername(),
    };
  }

  function startFreshDraft() {
    clearQuizWizardState();
    pendingCreateRef.current = null;
    setUnlockForTracks(false);
    setWizard(freshWizardState());
    setDraftChoiceOpen(false);
    setStepError(null);
  }

  function continueSavedDraft() {
    setDraftChoiceOpen(false);
  }

  function handleClearDraft() {
    clearQuizWizardState();
    pendingCreateRef.current = null;
    setUnlockForTracks(false);
    setWizard(freshWizardState());
    setStepError(null);
  }

  function acknowledgeSlotGate() {
    setSlotGateOpen(false);
    setSlotAcked(true);
    if (pendingDraftRef.current) {
      pendingDraftRef.current = false;
      setDraftChoiceOpen(true);
    }
  }

  function cancelSlotGate() {
    setSlotGateOpen(false);
    router.push("/");
  }

  async function rejectIfLastfmUserMissing(username: string): Promise<boolean> {
    setLastfmChecking(true);
    try {
      const lookupError = await ensureLastfmUserExists(username);
      if (lookupError) {
        setStepError(lookupError);
        return true;
      }
      if (!isAnonymous) {
        const saved = await rememberLastfmUsernameAction(username);
        if (saved) setSavedLastfmUsername(saved);
      }
      return false;
    } finally {
      setLastfmChecking(false);
    }
  }

  async function handleNext() {
    const error = validateQuizWizardStep(wizardRef.current, wizardRef.current.step);
    if (error) {
      setStepError(error);
      return;
    }
    const current = wizardRef.current;
    if (current.step === 1 && current.playMode === "auto_lastfm") {
      if (await rejectIfLastfmUserMissing(current.lastfmUsername)) return;
    }
    setStepError(null);
    patchWizard({ step: Math.min(current.step + 1, 2) });
  }

  function handleBack() {
    setStepError(null);
    patchWizard({ step: Math.max(wizardRef.current.step - 1, 0) });
  }

  function buildCreateFormData(
    requiresUnlock: boolean,
    state: CreateQuizWizardState = pendingCreateRef.current ?? wizardRef.current,
  ) {
    const current = state;
    const formData = new FormData();
    formData.set("wizardCreate", "1");
    if (requiresUnlock) formData.set("requiresQuizUnlock", "1");
    formData.set("title", effectiveQuizTitle(current.title));
    formData.set("hostName", current.hostName.trim() || hostNameDefault);
    formData.set("description", current.description.trim());
    formData.set(
      "tracksJson",
      JSON.stringify(
        filledQuizSongs(current).map((song) => ({
          title: song.title.trim(),
          artist: song.artist.trim(),
          previewUrl: song.previewUrl.trim(),
          releaseYear:
            typeof song.releaseYear === "number" && Number.isFinite(song.releaseYear)
              ? song.releaseYear
              : null,
        })),
      ),
    );
    formData.set(
      "settingsJson",
      JSON.stringify({
        source:
          current.playMode === "auto_lastfm"
            ? "lastfm_live"
            : current.playMode === "auto_spotify"
              ? "spotify_live"
              : "curated",
        lastfmUsername:
          current.playMode === "auto_lastfm"
            ? current.lastfmUsername.trim().replace(/^@/, "")
            : "",
        chartCountries: current.chartCountries,
        scoringModes: current.scoringModes,
        yearRangeTolerance: current.yearRangeTolerance,
        hostParticipates: current.hostParticipates,
        teamsEnabled: current.teamsEnabled,
        guessPeriod:
          current.playMode === "auto_lastfm" || current.playMode === "auto_spotify"
            ? "until_next_track"
            : "host_manual",
        releaseMode:
          current.playMode === "auto_lastfm" || current.playMode === "auto_spotify"
            ? "automatic"
            : "host_manual",
        answerYearMode: current.answerYearMode,
        showTitleArtist: current.showTitleArtist,
        showCorrectAnswer: current.showCorrectAnswer,
        showOverallResults: current.presentLeaderboardAtEnd
          ? false
          : current.showOverallResults,
        showResultDetails: current.showResultDetails,
        showOthersInPastResults: current.showOthersInPastResults,
        overallReveal: current.presentLeaderboardAtEnd
          ? current.overallReveal
          : "after_quiz",
        autoInterruptAfterEmptyRounds: current.autoInterruptAfterEmptyRounds,
        roundReveal: "after_round",
      }),
    );
    return formData;
  }

  function submitCreate(requiresUnlock = false) {
    const current = pendingCreateRef.current ?? wizardRef.current;
    const playlistError = validateQuizWizardStep(current, 1);
    if (playlistError) {
      setStepError(playlistError);
      setParticipantLimitOpen(false);
      return;
    }
    const optionsError = validateQuizWizardStep(current, 2);
    if (optionsError) {
      setStepError(optionsError);
      setParticipantLimitOpen(false);
      return;
    }
    const overTracks = filledQuizSongs(current).length > planSongCap;
    const needsTeamUnlock = current.teamsEnabled && !planAllowsTeams;
    const needsUnlock =
      !canCreate ||
      overTracks ||
      needsTeamUnlock ||
      (pendingCreateRef.current ? false : unlockForTracks);

    if (needsUnlock && !requiresUnlock) {
      setParticipantLimitOpen(false);
      setUnlockOpen(true);
      return;
    }

    setStepError(null);
    setUnlockOpen(false);
    setParticipantLimitOpen(false);

    const formData = buildCreateFormData(requiresUnlock || needsUnlock, current);
    pendingCreateRef.current = null;
    clearQuizWizardState();
    startTransition(() => {
      formAction(formData);
    });
  }

  /** MyContest pattern: confirm create via participant-limit dialog when within plan. */
  async function requestCreate(stateOverride?: CreateQuizWizardState) {
    const current = stateOverride ?? wizardRef.current;
    if (stateOverride) {
      pendingCreateRef.current = stateOverride;
    } else {
      pendingCreateRef.current = null;
    }
    const setupError = validateQuizWizardStep(current, 0);
    if (setupError) {
      setStepError(setupError);
      return;
    }
    const playlistError = validateQuizWizardStep(current, 1);
    if (playlistError) {
      setStepError(playlistError);
      return;
    }
    const optionsError = validateQuizWizardStep(current, 2);
    if (optionsError) {
      setStepError(optionsError);
      return;
    }
    if (current.playMode === "auto_lastfm") {
      if (await rejectIfLastfmUserMissing(current.lastfmUsername)) return;
    }

    const overTracks = filledQuizSongs(current).length > planSongCap;
    // Quick Live always uses defaults (empty playlist) — ignore unlockForTracks from a draft.
    const needsUnlock =
      !canCreate || overTracks || (stateOverride ? false : unlockForTracks);

    if (needsUnlock) {
      setUnlockOpen(true);
      return;
    }

    if (plan.maxMembers != null) {
      setParticipantLimitOpen(true);
      return;
    }

    submitCreate(false);
  }

  /** Apply live defaults (keep title / host / description from step 1). */
  function applyQuickLiveDefaults(lastfmUsername: string): CreateQuizWizardState {
    const current = wizardRef.current;
    const host = current.hostName.trim() || hostNameDefault;
    const next = quickLiveQuizWizardState({
      hostName: host,
      title: current.title,
      description: current.description,
      lastfmUsername,
    });
    wizardRef.current = next;
    setUnlockForTracks(false);
    setWizard(next);
    return next;
  }

  async function handleQuickLiveQuiz() {
    const current = wizardRef.current;
    const host = current.hostName.trim() || hostNameDefault;
    if (!host) {
      setStepError("Please enter your name.");
      return;
    }
    setStepError(null);
    const lastfm =
      current.lastfmUsername.trim().replace(/^@/, "") ||
      preferredLastfmUsername();
    if (!lastfm) {
      setStepError(null);
      setQuickLastfmDraft("");
      setQuickLastfmOpen(true);
      return;
    }
    if (await rejectIfLastfmUserMissing(lastfm)) {
      setQuickLastfmDraft(lastfm);
      setQuickLastfmOpen(true);
      return;
    }
    const next = applyQuickLiveDefaults(lastfm);
    void requestCreate(next);
  }

  async function confirmQuickLiveWithLastfm() {
    const lastfm = quickLastfmDraft.trim().replace(/^@/, "");
    if (!lastfm) {
      setStepError("Enter your Last.fm username (connect Spotify Scrobbling in Last.fm settings first).");
      return;
    }
    if (await rejectIfLastfmUserMissing(lastfm)) return;
    setQuickLastfmOpen(false);
    setStepError(null);
    const next = applyQuickLiveDefaults(lastfm);
    void requestCreate(next);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (wizardRef.current.step < 2) {
      void handleNext();
      return;
    }
    void requestCreate();
  }


  function toggleChartCountry(code: ChartCountryCode) {
    setWizard((prev) => {
      const selected = new Set(prev.chartCountries);
      if (selected.has(code)) selected.delete(code);
      else selected.add(code);
      return { ...prev, chartCountries: Array.from(selected) as ChartCountryCode[] };
    });
  }

  function toggleScoringMode(mode: ScoringModeId) {
    setWizard((prev) => ({
      ...prev,
      scoringModes: toggleScoringModeSelection(prev.scoringModes, mode),
    }));
  }

  function setYearScoringMode(mode: YearScoringModeId) {
    setWizard((prev) => ({
      ...prev,
      scoringModes: setYearScoringModeSelection(prev.scoringModes, mode),
    }));
  }

  const wizardReady = hydrated && slotAcked;
  const formError = stepError ?? state?.error ?? null;
  const hideDuplicateLastfmNotFound =
    wizard.step === 1 &&
    wizard.playMode === "auto_lastfm" &&
    isLastfmUserNotFoundMessage(formError);
  const lastfmBusy = pending || lastfmChecking;

  // Scroll to page top whenever the step changes (Next / Back).
  useEffect(() => {
    if (!hydrated || !wizardReady) return;
    const top = { pageTop: true } as const;
    if (wizard.step === 0) {
      focusById("quiz-title", top);
      return;
    }
    if (wizard.step === 1) {
      if (wizardRef.current.playMode === "auto_lastfm") {
        focusById("lastfmUsername", top);
        return;
      }
      focusById("song-0-search", top);
      return;
    }
    focusById("quiz-scoring", top);
  }, [hydrated, wizardReady, wizard.step, focusById]);

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <SiteHeader identity={identity} currentPlan={planId} />

      <Dialog
        open={draftChoiceOpen}
        onOpenChange={(open) => {
          if (open) setDraftChoiceOpen(true);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Saved draft found</DialogTitle>
            <DialogDescription>
              Continue your quiz draft, or start fresh (saved data will be lost).
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

      <CreateQuizSlotLimitTipDialog
        open={slotGateOpen}
        onOpenChange={setSlotGateOpen}
        planId={planId}
        planLabel={plan.label}
        hasSession={hasSession}
        isAnonymous={isAnonymous}
        onContinue={acknowledgeSlotGate}
        onCancel={cancelSlotGate}
      />

      <CreateQuizUnlockDialog
        open={unlockOpen}
        onOpenChange={(open) => {
          setUnlockOpen(open);
          if (!open && !pending) pendingCreateRef.current = null;
        }}
        planId={planId}
        activeHostedCount={activeHostedCount}
        pending={pending}
        error={state?.error ?? stepError}
        reason={
          unlockReason
        }
        teamsRequired={teamUnlockRequired}
        onUnlockAndCreate={() => submitCreate(true)}
      />

      <CreateQuizParticipantLimitDialog
        open={participantLimitOpen}
        onOpenChange={(open) => {
          setParticipantLimitOpen(open);
          if (!open && !pending) pendingCreateRef.current = null;
        }}
        maxMembers={plan.maxMembers ?? 0}
        planLabel={plan.label}
        planId={planId}
        hasSession={hasSession}
        isAnonymous={isAnonymous}
        pending={pending}
        settingsSummary={quizWizardSettingsSummary(wizard)}
        onCreateWithPlanLimit={() => submitCreate(false)}
        onUnlockAndCreate={() => submitCreate(true)}
      />

      <Dialog open={quickLastfmOpen} onOpenChange={setQuickLastfmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Last.fm username</DialogTitle>
            <DialogDescription>
              Connect Spotify to Last.fm on the Last.fm website (ACCOUNT → Settings →
              Applications → Spotify Scrobbling), then enter your Last.fm username.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="quick-lastfm-username">Last.fm username</Label>
              <LastfmHelpButton onClick={() => setLastfmHelpOpen(true)} />
            </div>
            <Input
              id="quick-lastfm-username"
              value={quickLastfmDraft}
              onChange={(event) => {
                setQuickLastfmDraft(event.target.value);
                setStepError(null);
              }}
              placeholder="your_lastfm_name"
              autoComplete="username"
              maxLength={64}
              autoFocus
            />
          </div>
          {quickLastfmLookup.status === "invalid" ||
          isLastfmUserNotFoundMessage(stepError) ? (
            <LastfmUserNotFoundAlert onHelp={() => setLastfmHelpOpen(true)} />
          ) : stepError ? (
            <p className="text-sm text-destructive" role="alert">
              {stepError}
            </p>
          ) : quickLastfmLookup.status === "found" ? (
            <LastfmUserFoundNotice
              profile={quickLastfmLookup.profile}
              savedOnAccount={
                !isAnonymous &&
                lastfmUsernamesMatch(quickLastfmDraft, savedLastfmUsername)
              }
            />
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setQuickLastfmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                pending ||
                lastfmChecking ||
                !quickLastfmDraft.trim() ||
                quickLastfmLookup.status === "invalid"
              }
              onClick={() => {
                void confirmQuickLiveWithLastfm();
              }}
            >
              {pending ? "Creating…" : lastfmChecking ? "Checking…" : "Create quiz"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LastfmHelpDialog open={lastfmHelpOpen} onOpenChange={setLastfmHelpOpen} />

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        {!wizardReady ? (
          <p className="text-sm text-muted-foreground">
            {slotGateOpen ? "Confirm to continue setup…" : "Loading…"}
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
              <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">
                {wizard.step === 0
                  ? "Create a quiz"
                  : effectiveQuizTitle(wizard.title)}
              </h1>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">
                  Step {wizard.step + 1} of 3 · {quizWizardStepTitle(wizard.step)}
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={handleClearDraft}>
                  Clear draft
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {plan.label} plan
                {plan.maxActiveQuizzes === null
                  ? " · unlimited active quizzes"
                  : ` · ${activeHostedCount} of ${plan.maxActiveQuizzes} active quizzes used`}
              </p>
            </div>

            {!canCreate ? (
              <p className="text-sm text-muted-foreground">
                No free active slot on {plan.label} — create at the end requires a
                one-time unlock or a plan change.
              </p>
            ) : null}

            <Card className="overflow-visible">
              <CardContent className="pt-6">
                <form onSubmit={handleSubmit} className="space-y-5">
                  {wizard.step === 0 ? (
                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Set up your {BRAND_NAME} quiz. You will curate songs and options before
                        anything is created.
                      </p>
                      <div className="space-y-2">
                        <Label htmlFor="quiz-title">Quiz title</Label>
                        <Input
                          id="quiz-title"
                          value={wizard.title}
                          onChange={(event) => patchWizard({ title: event.target.value })}
                          placeholder={DEFAULT_QUIZ_TITLE}
                          maxLength={80}
                          autoComplete="off"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="quiz-host-name">Your name (host)</Label>
                        <Input
                          id="quiz-host-name"
                          value={wizard.hostName}
                          onChange={(event) => patchWizard({ hostName: event.target.value })}
                          placeholder="Alex"
                          maxLength={40}
                          autoComplete="nickname"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="quiz-description">Description (optional)</Label>
                        <Input
                          id="quiz-description"
                          value={wizard.description}
                          onChange={(event) =>
                            patchWizard({ description: event.target.value })
                          }
                          placeholder="Release year guessing with friends"
                          maxLength={500}
                        />
                      </div>
                    </div>
                  ) : null}

                  {wizard.step === 1 ? (
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => patchWizard({ playMode: "auto_lastfm" })}
                          className={cn(
                            "rounded-xl border px-4 py-3 text-left transition",
                            wizard.playMode === "auto_lastfm"
                              ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                              : "border-border/60 hover:border-border",
                          )}
                        >
                          <p className="text-sm font-semibold text-foreground">
                            Live Spotify (Last.fm)
                          </p>
                          <p className="mt-1 text-xs leading-snug text-muted-foreground">
                            Play any song or playlist on Spotify — {BRAND_NAME}{" "}
                            follows and opens a quiz round automatically.
                          </p>
                        </button>
                        <button
                          type="button"
                          onClick={() => patchWizard({ playMode: "curate" })}
                          className={cn(
                            "rounded-xl border px-4 py-3 text-left transition",
                            wizard.playMode === "curate"
                              ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                              : "border-border/60 hover:border-border",
                          )}
                        >
                          <p className="text-sm font-semibold text-foreground">
                            Curate playlist
                          </p>
                          <p className="mt-1 text-xs leading-snug text-muted-foreground">
                            Build a song list ahead of time and add tracks ad hoc
                            during the quiz.
                          </p>
                        </button>
                      </div>

                      {wizard.playMode === "auto_lastfm" ? (
                        <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm text-muted-foreground">
                              Enter your Last.fm username below.
                            </p>
                            <LastfmHelpButton onClick={() => setLastfmHelpOpen(true)} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="lastfmUsername">Last.fm username</Label>
                            <Input
                              id="lastfmUsername"
                              value={wizard.lastfmUsername}
                              onChange={(event) => {
                                patchWizard({ lastfmUsername: event.target.value });
                                setStepError(null);
                              }}
                              placeholder="your_lastfm_name"
                              autoComplete="username"
                              maxLength={64}
                            />
                          </div>
                          {lastfmLookup.status === "invalid" ||
                          isLastfmUserNotFoundMessage(stepError) ? (
                            <LastfmUserNotFoundAlert
                              onHelp={() => setLastfmHelpOpen(true)}
                            />
                          ) : lastfmLookup.status === "found" ? (
                            <LastfmUserFoundNotice
                              profile={lastfmLookup.profile}
                              savedOnAccount={
                                !isAnonymous &&
                                lastfmUsernamesMatch(
                                  wizard.lastfmUsername,
                                  savedLastfmUsername,
                                )
                              }
                            />
                          ) : null}
                        </div>
                      ) : null}

                      {wizard.playMode === "curate" ? (
                        <>
                      <p className="text-sm text-muted-foreground">
                        Build your playlist in play order
                        {unlockForTracks && canSelfServeUnlock
                          ? ` (max ${unlockSongCap} songs with unlock at create)`
                          : ` (max ${planSongCap} songs on your plan)`}
                        . Release years are resolved when the quiz is created.
                      </p>
                      {wizard.draftSongs.map((song, index) => (
                        <div
                          key={`song-${index}`}
                          className="space-y-2 rounded-xl border border-border/60 p-4"
                        >
                          {wizard.draftSongs.length > 1 ? (
                            <div className="flex justify-end">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Remove song"
                                onClick={() =>
                                  setWizard((prev) => ({
                                    ...prev,
                                    draftSongs: prev.draftSongs.filter((_, i) => i !== index),
                                  }))
                                }
                              >
                                <XIcon className="size-4" />
                              </Button>
                            </div>
                          ) : null}
                          <SongPickFields
                            compact
                            value={song}
                            idPrefix={`song-${index}`}
                            searchLabel={`Search song ${index + 1}`}
                            onChange={(value) =>
                              setWizard((prev) => ({
                                ...prev,
                                draftSongs: prev.draftSongs.map((row, i) =>
                                  i === index ? value : row,
                                ),
                              }))
                            }
                          />
                        </div>
                      ))}
                      {wizard.draftSongs.length >= planSongCap &&
                      (!unlockForTracks || !canSelfServeUnlock) ? (
                        <div className="space-y-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
                          <p className="text-sm text-foreground">
                            {canSelfServeUnlock ? (
                              <>
                                Plan limit reached ({planSongCap} songs). Unlock
                                this quiz once for up to {unlockSongCap} songs — you pay at create.
                              </>
                            ) : (
                              <>
                                Pro allows up to {planSongCap} songs. Need more?
                                Please{" "}
                                <Link
                                  href="/contact"
                                  className="font-medium underline underline-offset-2 hover:text-primary"
                                >
                                  contact us
                                </Link>
                                .
                              </>
                            )}
                          </p>
                          {canSelfServeUnlock ? (
                            <div className="flex flex-col gap-2 sm:flex-row">
                            <Button
                              type="button"
                              onClick={() => {
                                const newIndex = wizard.draftSongs.length;
                                setUnlockForTracks(true);
                                setWizard((prev) => ({
                                  ...prev,
                                  draftSongs: [
                                    ...prev.draftSongs,
                                    { title: "", artist: "", previewUrl: "", releaseYear: null },
                                  ],
                                }));
                                focusById(`song-${newIndex}-search`, {
                                  keyboardSafe: true,
                                });
                              }}
                            >
                              Unlock & add more songs
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setUnlockOpen(true)}
                            >
                              Unlock details ({BILLING_SKU_LABELS.quiz_unlock})
                            </Button>
                          </div>
                          ) : null}
                        </div>
                      ) : (
                        <WizardAddAnotherButton
                          onClick={() => {
                            const newIndex = wizard.draftSongs.length;
                            if (newIndex >= songCap) {
                              return;
                            }
                            setWizard((prev) => ({
                              ...prev,
                              draftSongs: [
                                ...prev.draftSongs,
                                { title: "", artist: "", previewUrl: "", releaseYear: null },
                              ],
                            }));
                            focusById(`song-${newIndex}-search`, {
                              keyboardSafe: true,
                            });
                          }}
                          disabled={wizard.draftSongs.length >= songCap}
                        >
                          Add another song
                          {unlockForTracks ? " (unlock at create)" : ""}
                        </WizardAddAnotherButton>
                      )}
                        </>
                      ) : null}
                    </div>
                  ) : null}

                  {wizard.step === 2 ? (
                    <div className="space-y-5">
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <Label htmlFor="quiz-scoring">Scoring</Label>
                          <select
                            id="quiz-scoring"
                            className={ADMIN_SELECT_CLASS}
                            value={primaryYearScoringMode(wizard.scoringModes)}
                            onChange={(event) =>
                              setYearScoringMode(
                                event.target.value as YearScoringModeId,
                              )
                            }
                          >
                            {(
                              Object.keys(QUIZ_YEAR_SCORING_OPTIONS) as YearScoringModeId[]
                            ).map((key) => (
                              <option key={key} value={key}>
                                {QUIZ_YEAR_SCORING_OPTIONS[key].label}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-muted-foreground">
                            {
                              QUIZ_YEAR_SCORING_OPTIONS[
                                primaryYearScoringMode(wizard.scoringModes)
                              ].description
                            }
                          </p>
                        </div>

                        {wizard.scoringModes.includes("year_range") ? (
                          <div className="space-y-2 rounded-2xl border border-border/60 p-4">
                            <Label htmlFor="yearRangeTolerance">
                              Range (± years)
                            </Label>
                            <div className="flex flex-wrap items-center gap-2">
                              {RANGE_TOLERANCE_PRESETS.map((preset) => (
                                <Button
                                  key={preset}
                                  type="button"
                                  size="sm"
                                  variant={
                                    wizard.yearRangeTolerance === preset
                                      ? "default"
                                      : "outline"
                                  }
                                  onClick={() =>
                                    patchWizard({ yearRangeTolerance: preset })
                                  }
                                >
                                  ±{preset}
                                </Button>
                              ))}
                              <Input
                                id="yearRangeTolerance"
                                type="number"
                                min={YEAR_RANGE_TOLERANCE_MIN}
                                max={YEAR_RANGE_TOLERANCE_MAX}
                                value={wizard.yearRangeTolerance}
                                onChange={(event) =>
                                  patchWizard({
                                    yearRangeTolerance: clampYearRangeTolerance(
                                      Number(event.target.value),
                                    ),
                                  })
                                }
                                className="w-24"
                              />
                            </div>
                          </div>
                        ) : null}

                        <AdminSwitchField
                          id="chartWasOne"
                          label="Add Chart #1 Guessing Option"
                          description="Players can earn bonus points if they know whether or not it was a number 1."
                          checked={wizard.scoringModes.includes("chart_was_one")}
                          onCheckedChange={() =>
                            toggleScoringMode("chart_was_one")
                          }
                        />

                        {wizard.scoringModes.includes("chart_was_one") ? (
                          <div className="space-y-2 rounded-2xl border border-border/60 p-4">
                            <Label>Chart countries</Label>
                            <p className="text-sm text-muted-foreground">
                              Which national charts count for the #1 question.
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {QUIZ_CHART_COUNTRIES.map((code) => {
                                const option = CHART_COUNTRY_OPTIONS[code];
                                const selected =
                                  wizard.chartCountries.includes(code);
                                return (
                                  <Button
                                    key={code}
                                    type="button"
                                    variant={selected ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => toggleChartCountry(code)}
                                  >
                                    {option.label}
                                  </Button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <WizardOptionsDivider label={null} />

                      <AdminSwitchField
                        id="hostParticipates"
                        label="Host plays along"
                        description="When off, you host only and do not submit guesses."
                        checked={wizard.hostParticipates}
                        onCheckedChange={(checked) =>
                          patchWizard({ hostParticipates: checked })
                        }
                      />

                      <AdminSwitchField
                        id="teamsEnabled"
                        label="Team mode"
                        description={
                          planAllowsTeams
                            ? "Create Teams of participants to play against each other."
                            : unlockForTracks
                              ? "Quiz unlock selected. Create Teams of participants to play against each other."
                              : "Requires Plus, Pro, or a one-time Quiz Unlock at create."
                        }
                        checked={(planAllowsTeams || unlockForTracks) && wizard.teamsEnabled}
                        onCheckedChange={(checked) => {
                          if (checked && !planAllowsTeams) {
                            setUnlockForTracks(true);
                          }
                          if (
                            !checked &&
                            !planAllowsTeams &&
                            filledQuizSongs(wizardRef.current).length <= planSongCap &&
                            canCreate
                          ) {
                            setUnlockForTracks(false);
                          }
                          patchWizard({ teamsEnabled: checked });
                        }}
                      />

                      <WizardCollapsibleOptions sectionId="quiz-create-options">
                        <div className="space-y-2">
                          <Label>Release Year</Label>
                          <p className="text-sm text-muted-foreground">
                            Choose if you want the release date of the original
                            recording or the cover version played.
                          </p>
                          <div className="grid gap-3 sm:grid-cols-2">
                            {(
                              [
                                {
                                  id: "original_recording" as AnswerYearMode,
                                  title: "Original release year",
                                },
                                {
                                  id: "this_release" as AnswerYearMode,
                                  title: "Played Cover",
                                },
                              ] as const
                            ).map((option) => {
                              const selected = wizard.answerYearMode === option.id;
                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() =>
                                    patchWizard({ answerYearMode: option.id })
                                  }
                                  className={cn(
                                    "rounded-2xl border p-4 text-left transition-colors",
                                    selected
                                      ? "border-primary bg-primary/5"
                                      : "border-border/60 hover:bg-muted/40",
                                  )}
                                >
                                  <p className="font-medium">{option.title}</p>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="space-y-3">
                          <Label>Player&apos;s visibility</Label>
                          <AdminSwitchField
                            id="showTitleArtist"
                            label="Show song & artist"
                            description="Show title and artist during the live round for everyone."
                            checked={wizard.showTitleArtist}
                            onCheckedChange={(checked) =>
                              patchWizard({ showTitleArtist: checked })
                            }
                          />
                          <AdminSwitchField
                            id="showCorrectAnswer"
                            label="Show correct answer"
                            description="Reveal the correct release year after each round closes."
                            checked={wizard.showCorrectAnswer}
                            onCheckedChange={(checked) =>
                              patchWizard({ showCorrectAnswer: checked })
                            }
                          />
                          <AdminSwitchField
                            id="showResultDetails"
                            label="Show details in results list"
                            description="When off, players only see their guessed difference in years for each past round."
                            checked={wizard.showResultDetails}
                            onCheckedChange={(checked) =>
                              patchWizard({ showResultDetails: checked })
                            }
                          />
                          {wizard.showResultDetails ? (
                            <AdminSwitchField
                              id="showOthersInPastResults"
                              label={
                                wizard.teamsEnabled
                                  ? "Show other teams' results"
                                  : "Show other players' results"
                              }
                              description={
                                wizard.teamsEnabled
                                  ? "Participants always see their own team. When on, they also see other teams' average scores — not individual years."
                                  : "Let participants see other player's guesses. Turn off for large groups."
                              }
                              checked={wizard.showOthersInPastResults}
                              onCheckedChange={(checked) =>
                                patchWizard({ showOthersInPastResults: checked })
                              }
                            />
                          ) : null}
                        </div>

                        <div className="space-y-3">
                          <Label>Results</Label>
                          <AdminSwitchField
                            id="presentLeaderboardAtEnd"
                            label="Present leaderboard results at the end"
                            description="Hide the running board during play. After the quiz ends, the host presents the final leaderboard."
                            checked={wizard.presentLeaderboardAtEnd}
                            onCheckedChange={(checked) =>
                              patchWizard(
                                checked
                                  ? {
                                      presentLeaderboardAtEnd: true,
                                      showOverallResults: false,
                                    }
                                  : {
                                      presentLeaderboardAtEnd: false,
                                      showOverallResults: true,
                                    },
                              )
                            }
                          />
                          {wizard.presentLeaderboardAtEnd ? (
                            <div className="space-y-2 pl-1">
                              <Label htmlFor="overallReveal">
                                How to present the leaderboard?
                              </Label>
                              <select
                                id="overallReveal"
                                className={ADMIN_SELECT_CLASS}
                                value={wizard.overallReveal}
                                onChange={(event) =>
                                  patchWizard({
                                    overallReveal: event.target
                                      .value as Exclude<
                                      OverallReveal,
                                      "after_quiz"
                                    >,
                                  })
                                }
                              >
                                {(
                                  Object.keys(
                                    QUIZ_LEADERBOARD_REVEAL_OPTIONS,
                                  ) as Array<
                                    Exclude<OverallReveal, "after_quiz">
                                  >
                                ).map((key) => (
                                  <option key={key} value={key}>
                                    {QUIZ_LEADERBOARD_REVEAL_OPTIONS[key].label}
                                  </option>
                                ))}
                              </select>
                              <p className="text-xs text-muted-foreground">
                                {
                                  QUIZ_LEADERBOARD_REVEAL_OPTIONS[
                                    wizard.overallReveal
                                  ].description
                                }
                              </p>
                            </div>
                          ) : null}
                          <AdminSwitchField
                            id="showOverallResults"
                            label="Live Leaderboard"
                            description={
                              wizard.presentLeaderboardAtEnd
                                ? "The board stays hidden until the host presents."
                                : "Show the running leaderboard with scores during the quiz for everyone."
                            }
                            checked={
                              !wizard.presentLeaderboardAtEnd &&
                              wizard.showOverallResults
                            }
                            onCheckedChange={(checked) => {
                              if (wizard.presentLeaderboardAtEnd && checked) {
                                patchWizard({
                                  presentLeaderboardAtEnd: false,
                                  showOverallResults: true,
                                });
                                return;
                              }
                              patchWizard({ showOverallResults: checked });
                            }}
                          />
                        </div>

                        {wizard.playMode === "auto_lastfm" ||
                        wizard.playMode === "auto_spotify" ? (
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <Label
                                htmlFor="autoInterruptAfterEmptyRounds"
                                className="min-w-0 flex-1"
                              >
                                Interrupt quiz after empty guesses
                              </Label>
                              <select
                                id="autoInterruptAfterEmptyRounds"
                                className={cn(
                                  ADMIN_SELECT_CLASS,
                                  "w-auto shrink-0",
                                )}
                                value={wizard.autoInterruptAfterEmptyRounds}
                                onChange={(event) =>
                                  patchWizard({
                                    autoInterruptAfterEmptyRounds: Number(
                                      event.target.value,
                                    ),
                                  })
                                }
                              >
                                {Array.from(
                                  {
                                    length:
                                      AUTO_INTERRUPT_EMPTY_ROUNDS_MAX -
                                      AUTO_INTERRUPT_EMPTY_ROUNDS_MIN +
                                      1,
                                  },
                                  (_, i) =>
                                    AUTO_INTERRUPT_EMPTY_ROUNDS_MIN + i,
                                ).map((n) => (
                                  <option key={n} value={n}>
                                    {n}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Pause auto ingest after this many consecutive songs
                              without guesses. Host can resume.
                            </p>
                          </div>
                        ) : null}
                      </WizardCollapsibleOptions>

                      <p className="text-sm text-muted-foreground">
                        Press Create quiz to create &ldquo;
                        {effectiveQuizTitle(wizard.title)}
                        &rdquo;.
                      </p>
                    </div>
                  ) : null}

                  {formError && !hideDuplicateLastfmNotFound ? (
                    <LastfmErrorAlert
                      error={formError}
                      onHelp={() => setLastfmHelpOpen(true)}
                    />
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    {wizard.step > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={lastfmBusy}
                        onClick={handleBack}
                      >
                        Back
                      </Button>
                    ) : (
                      <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
                        Cancel
                      </Link>
                    )}
                    {wizard.step < 2 ? (
                      <Button
                        type="button"
                        onClick={() => {
                          void handleNext();
                        }}
                        disabled={
                          lastfmBusy ||
                          (wizard.step === 1 &&
                            wizard.playMode === "auto_lastfm" &&
                            lastfmLookup.status === "invalid")
                        }
                      >
                        {lastfmChecking ? "Checking…" : "Next"}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        disabled={lastfmBusy}
                        onClick={() => {
                          void requestCreate();
                        }}
                      >
                        {pending ? "Creating…" : lastfmChecking ? "Checking…" : "Create quiz"}
                      </Button>
                    )}
                    {wizard.step === 0 ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className="ml-auto"
                        disabled={lastfmBusy}
                        onClick={() => {
                          void handleQuickLiveQuiz();
                        }}
                      >
                        {pending ? "Creating…" : lastfmChecking ? "Checking…" : "Quick Live Quiz"}
                      </Button>
                    ) : null}
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
