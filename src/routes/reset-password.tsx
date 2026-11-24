import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
  head: () => ({
    meta: [{ title: "Set a new password — Yooits.me" }, { name: "robots", content: "noindex" }],
  }),
});

const MIN_PASSWORD = 8;

/**
 * Landing page for the password-reset email. Supabase signs the person in
 * from the link (recovery session); they then choose a new password here.
 */
function ResetPasswordPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<"checking" | "ready" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let settled = false;
    const ready = () => {
      settled = true;
      setState("ready");
    };
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (session && event === "SIGNED_IN")) ready();
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) ready();
    });
    // The link puts its token in the URL; if no session appears, it was used or expired.
    const t = setTimeout(() => {
      if (!settled) setState("invalid");
    }, 4000);
    return () => {
      clearTimeout(t);
      sub.subscription.unsubscribe();
    };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) {
      toast.error(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      toast.error("The two passwords don't match.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated");
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <Toaster />
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8" style={{ boxShadow: "var(--shadow-card)" }}>
        <h1 className="text-2xl font-bold">Set a new password</h1>
        {state === "checking" && <p className="mt-4 text-sm text-muted-foreground">Checking your link…</p>}
        {state === "invalid" && (
          <div className="mt-4 space-y-4 text-sm">
            <p className="text-muted-foreground">
              This reset link has expired or was already used. Request a new one from the sign-in page.
            </p>
            <Link to="/auth" className="text-primary hover:underline">
              Back to sign in
            </Link>
          </div>
        )}
        {state === "ready" && (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={MIN_PASSWORD}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">At least {MIN_PASSWORD} characters.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input
                id="confirm"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? "Saving…" : "Save new password"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
