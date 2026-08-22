"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ScanQrCodeButton } from "@/components/qr-code-scanner";
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

export default function JoinIndexPage() {
  const router = useRouter();
  const [code, setCode] = useState("");

  function goToJoin(raw: string) {
    const normalized = raw.trim().toUpperCase();
    if (!normalized) return;
    router.push(`/j/${normalized}`);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    goToJoin(code);
  }

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) router.push("/");
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Join a quiz</DialogTitle>
          <DialogDescription>
            Enter the invite code you received.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Invite code</Label>
              <Input
                id="code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="AB12CD"
                maxLength={12}
                autoCapitalize="characters"
                required
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Usually 6 characters, for example AB12CD.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => router.push("/")}>
                Cancel
              </Button>
              <Button type="submit">Continue</Button>
            </DialogFooter>
          </form>

          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center" aria-hidden>
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase tracking-wide">
              <span className="bg-popover px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <ScanQrCodeButton
            onCode={goToJoin}
            variant="secondary"
            size="lg"
            className="w-full"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
