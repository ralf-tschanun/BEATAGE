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
import { createQuizAction, type QuizActionState } from "@/app/actions/quiz";
import {
  CreateQuizSlotLimitTipDialog,
  CreateQuizUnlockDialog,
} from "@/components/create-quiz-unlock-dialog";
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
  WizardOptionsDivider,
} from "@/components/wizard-step-ui";
import { BILLING_SKU_LABELS } from "@/lib/billing-copy";
import { CHART_COUNTRY_OPTIONS } from "@/lib/charts";
import { BRAND_NAME } from "@/lib/brand";
import {
  clearQuizWizardState,
  defaultQuizWizardState,
  filledQuizSongs,
  hasMeaningfulQuizWizardDraft,
  loadQuizWizardState,
  quizWizardSettingsSummary,
  quizWizardStepTitle,
  saveQuizWizardState,
  validateQuizWizardStep,
  type CreateQuizWizardState,
} from "@/lib/create-quiz-wizard";
import type { PlanId } from "@/lib/quiz-plans";
import { DEFAULT_MAX_CURATED_TRACKS, getQuizPlanLimits } from "@/lib/quiz-plans";
import type { ChartCountryCode, ScoringModeId } from "@/lib/quiz-settings";
import { useWizardInputFocus } from "@/lib/wizard-input-focus";
import { cn } from "@/lib/utils";

const initialState: QuizActionState = null;

const QUIZ_CHART_COUNTRIES: ChartCountryCode[] = ["DE", "AT", "GB"];

const SCORING_OPTIONS: { id: ScoringModeId; label: string }[] = [
  { id: "year_exact", label: "Exact year" },
  { id: "year_distance", label: "Closer wins" },
  { id: "year_range", label: "Within range" },
  { id: "chart_was_one", label: "Chart #1 guess" },
  { id: "chart_weeks", label: "Weeks at #1 guess" },
];

type CreateQuizWizardFormProps = {
  defaultHostName?: string | null;
  planId?: PlanId;
  activeHostedCount?: number;
  canCreate?: boolean;
  hasSession?: boolean;
  isAnonymous?: boolean;
};

export function CreateQuizWizardForm({
  defaultHostName,
  planId = "free",
  activeHostedCount = 0,
  canCreate = true,
  hasSession = true,
  isAnonymous = false,
}: CreateQuizWizardFormProps) {
  const router = useRouter();
  const plan = getQuizPlanLimits(planId);
  const hostNameDefault = defaultHostName?.trim() ?? "";
  const [state, formAction] = useActionState(createQuizAction, initialState);
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);
  const [draftChoiceOpen, setDraftChoiceOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  /** Gate: slot-limit tip before the wizard when there is no free active slot. */
  const [slotGateOpen, setSlotGateOpen] = useState(!canCreate);
  const [slotAcked, setSlotAcked] = useState(canCreate);
  /** Host opted in to unlock so the playlist can exceed the free song cap. */
  const [unlockForTracks, setUnlockForTracks] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [wizard, setWizard] = useState<CreateQuizWizardState>(() =>
    defaultQuizWizardState(hostNameDefault),
  );
  const wizardRef = useRef(wizard);
  wizardRef.current = wizard;
  const pendingDraftRef = useRef(false);
  const { focusById } = useWizardInputFocus([wizard.step, wizard.draftSongs.length]);

  useEffect(() => {
    const saved = loadQuizWizardState(hostNameDefault);
    if (saved && hasMeaningfulQuizWizardDraft(saved)) {
      setWizard(saved);
      if (canCreate) {
        setDraftChoiceOpen(true);
      } else {
        // Show draft choice only after the slot-limit tip is acknowledged.
        pendingDraftRef.current = true;
      }
    }
    setHydrated(true);
  }, [hostNameDefault, canCreate]);

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
    setWizard((prev) => ({ ...prev, ...patch }));
  }, []);

  function startFreshDraft() {
    clearQuizWizardState();
    setWizard(defaultQuizWizardState(hostNameDefault));
    setDraftChoiceOpen(false);
    setStepError(null);
  }

  function continueSavedDraft() {
    setDraftChoiceOpen(false);
  }

  function handleClearDraft() {
    clearQuizWizardState();
    setWizard(defaultQuizWizardState(hostNameDefault));
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

  function handleNext() {
    const error = validateQuizWizardStep(wizardRef.current, wizardRef.current.step);
    if (error) {
      setStepError(error);
      return;
    }
    setStepError(null);
    patchWizard({ step: Math.min(wizardRef.current.step + 1, 3) });
  }

  function handleBack() {
    setStepError(null);
    patchWizard({ step: Math.max(wizardRef.current.step - 1, 0) });
  }

  function buildCreateFormData(requiresUnlock: boolean) {
    const current = wizardRef.current;
    const formData = new FormData();
    formData.set("wizardCreate", "1");
    if (requiresUnlock) formData.set("requiresQuizUnlock", "1");
    formData.set("title", current.title.trim());
    formData.set("hostName", current.hostName.trim() || hostNameDefault);
    formData.set("description", current.description.trim());
    formData.set(
      "tracksJson",
      JSON.stringify(
        filledQuizSongs(current).map((song) => ({
          title: song.title.trim(),
          artist: song.artist.trim(),
          previewUrl: song.previewUrl.trim(),
        })),
      ),
    );
    formData.set(
      "settingsJson",
      JSON.stringify({
        chartCountries: current.chartCountries,
        scoringModes: current.scoringModes,
        hostParticipates: current.hostParticipates,
      }),
    );
    return formData;
  }

  function submitCreate(requiresUnlock = false) {
    const current = wizardRef.current;
    const error = validateQuizWizardStep(current, 1);
    if (error) {
      setStepError(error);
      return;
    }
    const overTracks =
      filledQuizSongs(current).length > DEFAULT_MAX_CURATED_TRACKS;
    const needsUnlock = !canCreate || overTracks || unlockForTracks;

    if (needsUnlock && !requiresUnlock) {
      setUnlockOpen(true);
      return;
    }

    setStepError(null);
    setUnlockOpen(false);

    const formData = buildCreateFormData(requiresUnlock || needsUnlock);
    clearQuizWizardState();
    startTransition(() => {
      formAction(formData);
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (wizardRef.current.step < 3) {
      handleNext();
      return;
    }
    submitCreate();
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
    setWizard((prev) => {
      const selected = new Set(prev.scoringModes);
      if (selected.has(mode)) selected.delete(mode);
      else selected.add(mode);
      return { ...prev, scoringModes: Array.from(selected) as ScoringModeId[] };
    });
  }

  const wizardReady = hydrated && slotAcked;

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <SiteHeader identity={null} currentPlan={planId} />

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
        onOpenChange={setUnlockOpen}
        planId={planId}
        activeHostedCount={activeHostedCount}
        pending={pending}
        error={state?.error ?? stepError}
        reason={
          !canCreate &&
          (unlockForTracks ||
            filledQuizSongs(wizard).length > DEFAULT_MAX_CURATED_TRACKS)
            ? "both"
            : !canCreate
              ? "slot"
              : "songs"
        }
        onUnlockAndCreate={() => submitCreate(true)}
      />


      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        {!wizardReady ? (
          <p className="text-sm text-muted-foreground">
            {slotGateOpen ? "Confirm to continue setup…" : "Loading…"}
          </p>
        ) : (
          <div className="space-y-4">
            <div
              className={cn(
                "sticky top-14 z-40 -mx-6 space-y-1.5 border-b border-border/60 px-6 py-3",
                "bg-background/90 backdrop-blur-sm supports-[backdrop-filter]:bg-background/75",
              )}
            >
              <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">
                {wizard.title.trim() || "Create a quiz"}
              </h1>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">
                  Step {wizard.step + 1} of 4 · {quizWizardStepTitle(wizard.step)}
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
              {wizard.step > 0 ? (
                <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {quizWizardSettingsSummary(wizard)}
                </p>
              ) : null}
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
                          placeholder="Friday night hits"
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
                      <p className="text-sm text-muted-foreground">
                        Build your playlist in play order
                        {unlockForTracks
                          ? " (unlimited with unlock at create)"
                          : ` (max ${DEFAULT_MAX_CURATED_TRACKS} songs on your plan)`}
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
                      {wizard.draftSongs.length >= DEFAULT_MAX_CURATED_TRACKS &&
                      !unlockForTracks ? (
                        <div className="space-y-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
                          <p className="text-sm text-foreground">
                            Plan limit reached ({DEFAULT_MAX_CURATED_TRACKS} songs). Unlock
                            this quiz once for an unlimited playlist — you pay at create.
                          </p>
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
                                    { title: "", artist: "", previewUrl: "" },
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
                        </div>
                      ) : (
                        <WizardAddAnotherButton
                          onClick={() => {
                            const newIndex = wizard.draftSongs.length;
                            if (
                              !unlockForTracks &&
                              newIndex >= DEFAULT_MAX_CURATED_TRACKS
                            ) {
                              return;
                            }
                            setWizard((prev) => ({
                              ...prev,
                              draftSongs: [
                                ...prev.draftSongs,
                                { title: "", artist: "", previewUrl: "" },
                              ],
                            }));
                            focusById(`song-${newIndex}-search`, {
                              keyboardSafe: true,
                            });
                          }}
                        >
                          Add another song
                          {unlockForTracks ? " (unlock at create)" : ""}
                        </WizardAddAnotherButton>
                      )}
                    </div>
                  ) : null}

                  {wizard.step === 2 ? (
                    <div className="space-y-5">
                      <div className="space-y-2">
                        <Label>Chart countries</Label>
                        <div className="flex flex-wrap gap-2">
                          {QUIZ_CHART_COUNTRIES.map((code) => {
                            const option = CHART_COUNTRY_OPTIONS[code];
                            const selected = wizard.chartCountries.includes(code);
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

                      <WizardOptionsDivider />

                      <div className="space-y-2">
                        <Label>Scoring modes</Label>
                        <div className="flex flex-wrap gap-2">
                          {SCORING_OPTIONS.map((option) => {
                            const selected = wizard.scoringModes.includes(option.id);
                            return (
                              <Button
                                key={option.id}
                                type="button"
                                variant={selected ? "default" : "outline"}
                                size="sm"
                                onClick={() => toggleScoringMode(option.id)}
                              >
                                {option.label}
                              </Button>
                            );
                          })}
                        </div>
                      </div>

                      <AdminSwitchField
                        id="hostParticipates"
                        label="Host plays along"
                        description="When off, you host only and do not submit guesses."
                        checked={wizard.hostParticipates}
                        onCheckedChange={(checked) =>
                          patchWizard({ hostParticipates: checked })
                        }
                      />
                    </div>
                  ) : null}

                  {wizard.step === 3 ? (
                    <div className="space-y-3 text-sm">
                      <p>
                        <span className="font-medium">Title:</span> {wizard.title.trim()}
                      </p>
                      <p>
                        <span className="font-medium">Host:</span>{" "}
                        {wizard.hostName.trim() || hostNameDefault}
                      </p>
                      {wizard.description.trim() ? (
                        <p>
                          <span className="font-medium">Description:</span>{" "}
                          {wizard.description.trim()}
                        </p>
                      ) : null}
                      <p>
                        <span className="font-medium">Playlist:</span>{" "}
                        {filledQuizSongs(wizard).length} song
                        {filledQuizSongs(wizard).length === 1 ? "" : "s"}
                      </p>
                      <p>
                        <span className="font-medium">Settings:</span>{" "}
                        {quizWizardSettingsSummary(wizard)}
                      </p>
                      <p className="text-muted-foreground">
                        Press Create quiz to publish. Nothing is stored until now — same flow as
                        MyContest.
                      </p>
                    </div>
                  ) : null}

                  {stepError || state?.error ? (
                    <p className="text-sm text-destructive" role="alert">
                      {stepError ?? state?.error}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    {wizard.step > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={pending}
                        onClick={handleBack}
                      >
                        Back
                      </Button>
                    ) : (
                      <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
                        Cancel
                      </Link>
                    )}
                    {wizard.step < 3 ? (
                      <Button type="button" onClick={handleNext} disabled={pending}>
                        Next
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        disabled={pending}
                        onClick={() => submitCreate(false)}
                      >
                        {pending ? "Creating…" : "Create quiz"}
                      </Button>
                    )}
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
