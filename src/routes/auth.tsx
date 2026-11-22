import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Turnstile, TURNSTILE_SITE_KEY } from "@/components/auth/Turnstile";
import { LegalLinks } from "@/components/legal/LegalPage";
import { normalizeUsername, usernameError, USERNAME_HELP } from "@/lib/username";
import { z } from "zod";
import { betaRpc } from "@/lib/beta/api";
import { BETA_NAME, betaStateMessage, isBetaCodeState, normalizeBetaCode, type BetaCodeState } from "@/lib/beta/invite";

// yooits.me/auth?invite=fc-xxxxxxxxxx opens sign-up with a Founding Member code.
// yooits.me/auth?mode=forgot opens the reset-password form (linked from email).
const searchSchema = z.object({
  invite: z.string().max(200).optional().catch(undefined),
  mode: z.enum(["signin", "signup", "forgot"]).optional().catch(undefined),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  component: AuthPage,
  head: () => ({ meta: [{ title: "Sign in — Yooits" }] }),
});

type Mode = "signin" | "signup" | "forgot";

const MIN_PASSWORD = 8;

function AuthPage() {
  const navigate = useNavigate();
  const { invite, mode: initialMode } = Route.useSearch();
  const inviteCode = normalizeBetaCode(invite);
  const [betaState, setBetaState] = useState<BetaCodeState | null>(invite && !inviteCode ? "invalid" : null);
  const [mode, setMode] = useState<Mode>(invite ? "signup" : (initialMode ?? "signin"));
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  // Honeypot: real people never see or fill this field.
  const [website, setWebsite] = useState("");
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);

  /** Signed-in people who open an invite link redeem it straight away. */
  const redeemAndGo = async () => {
    if (inviteCode) {
      try {
        const r = await betaRpc("redeem_beta_invite", { _code: inviteCode });
        const state = isBetaCodeState(r) ? r : "invalid";
        if (state !== "ok" && state !== "already") {
          setBetaState(state);
          setSignedIn(true);
          return;
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't use that invite");
        return;
      }
    }
    navigate({ to: "/dashboard" });
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        await redeemAndGo();
      } else if (inviteCode) {
        try {
          const r = await betaRpc("beta_code_state", { _code: inviteCode });
          setBetaState(isBetaCodeState(r) ? r : "invalid");
        } catch {
          setBetaState(null);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, inviteCode]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setNotice(null);
    setUnconfirmedEmail(null);
  };

  const captchaOptions = () => (captchaToken ? { captchaToken } : {});

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (website) return; // bot filled the hidden field
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      toast.error("Please complete the human check.");
      return;
    }
    setLoading(true);
    setNotice(null);
    setUnconfirmedEmail(null);
    try {
      if (mode === "signup") {
        const cleanUsername = normalizeUsername(username);
        const problem = usernameError(cleanUsername);
        if (problem) throw new Error(problem);
        if (password.length < MIN_PASSWORD) {
          throw new Error(`Password must be at least ${MIN_PASSWORD} characters.`);
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            ...captchaOptions(),
            emailRedirectTo: `${window.location.origin}/admin`,
            data: {
              username: cleanUsername,
              display_name: displayName.trim().slice(0, 50) || cleanUsername,
              // Send any well-formed beta code, even if the precheck failed or is still
              // loading: the database checks and redeems it, and a bad code just means the free plan.
              ...(inviteCode ? { invite_code: inviteCode } : {}),
            },
          },
        });
        if (error) throw error;
        if (data.session) {
          // Email confirmation is off in Supabase: the account is ready now.
          navigate({ to: "/dashboard" });
        } else {
          setNotice(
            `Check ${email} for a link to confirm your account. You can sign in once it's confirmed.`,
          );
          setPassword("");
          setMode("signin");
        }
      } else if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
          options: captchaOptions(),
        });
        if (error) {
          if (/not confirmed/i.test(error.message)) {
            setUnconfirmedEmail(email);
            throw new Error("Please confirm your email first. Check your inbox for the link.");
          }
          throw error;
        }
        await redeemAndGo();
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          ...captchaOptions(),
          redirectTo: `${window.location.origin}/reset-password`,
        });
        // Same message whether or not the address has an account.
        if (error && !/rate limit|captcha/i.test(error.message)) {
          console.error("[auth] reset", error.message);
        } else if (error) {
          throw error;
        }
        setNotice(`If ${email} has a Yooits account, a link to reset the password is on its way.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
      setCaptchaReset((n) => n + 1);
    }
  };

  const resendConfirmation = async () => {
    if (!unconfirmedEmail) return;
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      toast.error("Please complete the human check.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: unconfirmedEmail,
      options: { ...captchaOptions(), emailRedirectTo: `${window.location.origin}/admin` },
    });
    setLoading(false);
    setCaptchaReset((n) => n + 1);
    if (error) toast.error(error.message);
    else setNotice(`We sent a new confirmation link to ${unconfirmedEmail}.`);
  };

  const title =
    mode === "signin" ? "Welcome back" : mode === "signup" ? "Create your page" : "Reset your password";
  const subtitle =
    mode === "signin"
      ? "Sign in to manage your links."
      : mode === "signup"
        ? "Claim your username and start sharing."
        : "Enter your email and we'll send you a reset link.";

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <Toaster />
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8" style={{ boxShadow: "var(--shadow-card)" }}>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        {betaState && (
          <div
            className={`mt-4 rounded-xl border p-3 text-sm ${betaState === "ok" ? "border-primary/40 bg-primary/10" : "border-border bg-muted"}`}
            role="status"
          >
            {betaState === "ok" && <div className="font-medium">{BETA_NAME}</div>}
            {betaStateMessage(betaState)}
            {betaState === "ok" && mode === "signup" && (
              <div className="mt-1 text-xs text-muted-foreground">
                Already have an account? Sign in and the invite is added to it.
              </div>
            )}
            {signedIn && (
              <div className="mt-2">
                <Link to="/dashboard" className="text-primary hover:underline">
                  Go to your dashboard
                </Link>
              </div>
            )}
          </div>
        )}
        {notice && (
          <div className="mt-4 rounded-xl border border-primary/40 bg-primary/10 p-3 text-sm" role="status">
            {notice}
          </div>
        )}
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {mode === "signup" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <div className="flex items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
                  <span className="px-3 text-sm text-muted-foreground">/</span>
                  <Input
                    id="username"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="yourname"
                    maxLength={30}
                    autoCapitalize="none"
                    autoComplete="username"
                    className="border-0 focus-visible:ring-0"
                  />
                </div>
                <p className="text-xs text-muted-foreground">{USERNAME_HELP}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="display">Display name (optional)</Label>
                <Input
                  id="display"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your Name"
                  maxLength={50}
                />
              </div>
            </>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {mode !== "forgot" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                {mode === "signin" && (
                  <button type="button" onClick={() => switchMode("forgot")} className="text-xs text-primary hover:underline">
                    Forgot password?
                  </button>
                )}
              </div>
              <Input
                id="password"
                type="password"
                required
                minLength={mode === "signup" ? MIN_PASSWORD : undefined}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {mode === "signup" && (
                <p className="text-xs text-muted-foreground">At least {MIN_PASSWORD} characters.</p>
              )}
            </div>
          )}
          <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label htmlFor="website">Website</label>
            <input id="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          <Turnstile onToken={setCaptchaToken} resetKey={captchaReset} />
          {mode === "signup" && (
            <p className="text-xs text-muted-foreground">
              By creating an account you agree to the{" "}
              <Link to="/legal/$doc" params={{ doc: "terms" }} className="text-primary hover:underline">
                Terms of Service
              </Link>
              ,{" "}
              <Link to="/legal/$doc" params={{ doc: "acceptable-use" }} className="text-primary hover:underline">
                Acceptable Use Policy
              </Link>{" "}
              and{" "}
              <Link to="/legal/$doc" params={{ doc: "privacy" }} className="text-primary hover:underline">
                Privacy Policy
              </Link>
              .
            </p>
          )}
          <Button type="submit" disabled={loading} className="w-full">
            {loading
              ? "Please wait…"
              : mode === "signin"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : "Send reset link"}
          </Button>
          {unconfirmedEmail && (
            <Button type="button" variant="outline" className="w-full" disabled={loading} onClick={resendConfirmation}>
              Resend confirmation email
            </Button>
          )}
        </form>
        <div className="mt-4 text-center text-sm text-muted-foreground">
          {mode === "signin" ? (
            <>No account? <button onClick={() => switchMode("signup")} className="text-primary hover:underline">Sign up</button></>
          ) : mode === "signup" ? (
            <>Have an account? <button onClick={() => switchMode("signin")} className="text-primary hover:underline">Sign in</button></>
          ) : (
            <>Remembered it? <button onClick={() => switchMode("signin")} className="text-primary hover:underline">Back to sign in</button></>
          )}
        </div>
        <div className="mt-6 text-center">
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">← Back to home</Link>
        </div>
        <LegalLinks className="mt-4" />
      </div>
    </div>
  );
}
