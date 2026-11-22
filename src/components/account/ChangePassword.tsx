import { useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Turnstile, TURNSTILE_SITE_KEY } from "@/components/auth/Turnstile";
import { MIN_PASSWORD, newPasswordError } from "@/lib/account/password";

/**
 * "Change password" on the dashboard, in two steps: the person first confirms
 * their current password, then sets the new one. The database emails them a
 * "password changed" notice once the change is saved.
 */
export function ChangePassword() {
  const [step, setStep] = useState<"closed" | "current" | "new">("closed");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  const close = () => {
    setStep("closed");
    setCurrent("");
    setNext("");
    setShow(false);
  };

  const checkCurrent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!current) return;
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      toast.error("Please complete the human check.");
      return;
    }
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email;
      if (!email) throw new Error("Please sign in again to change your password.");
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: current,
        options: captchaToken ? { captchaToken } : undefined,
      });
      if (error) throw new Error("That isn't your current password.");
      setStep("new");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "We couldn't check your password.");
      setCaptchaReset((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  const saveNew = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = newPasswordError(next, current);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password changed. We've emailed you a note about it.");
    close();
  };

  return (
    <div className="rounded-2xl border border-border p-5">
      <div className="font-semibold">Password</div>
      <p className="mt-1 text-sm text-muted-foreground">Change the password you use to sign in.</p>
      {step === "closed" && (
        <Button variant="outline" className="mt-3" onClick={() => setStep("current")}>
          Change password
        </Button>
      )}
      {step === "current" && (
        <form className="mt-3 space-y-2" onSubmit={checkCurrent}>
          <Label htmlFor="current-password">Current password</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
          <Turnstile onToken={setCaptchaToken} resetKey={captchaReset} />
          <div className="flex gap-2">
            <Button type="submit" disabled={!current || busy}>
              {busy ? "Checking…" : "Continue"}
            </Button>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {step === "new" && (
        <form className="mt-3 space-y-2" onSubmit={saveNew}>
          <Label htmlFor="new-password">New password</Label>
          <div className="flex gap-2">
            <Input
              id="new-password"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">At least {MIN_PASSWORD} characters.</p>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save new password"}
            </Button>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
