import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { loadOwnEntitlement, sendFeedback, type OwnEntitlement } from "@/lib/beta/api";
import { BETA_NAME, betaPlanLine } from "@/lib/beta/invite";

/**
 * Shown on the creator dashboard to Founding Members only:
 * when their free Plus months end, and a short feedback form.
 */
export function BetaPanel({ userId }: { userId: string }) {
  const [grant, setGrant] = useState<OwnEntitlement | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    loadOwnEntitlement(userId).then(setGrant, () => setGrant(null));
  }, [userId]);

  if (!grant) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim().length < 2) {
      toast.error("Write a few words first.");
      return;
    }
    setSending(true);
    try {
      await sendFeedback(rating, message.trim().slice(0, 2000));
      setSent(true);
      setMessage("");
      setRating(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send that");
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      aria-labelledby="beta-heading"
      className="mt-8 rounded-2xl border border-primary/40 bg-primary/5 p-5"
    >
      <h2 id="beta-heading" className="flex items-center gap-2 text-lg font-bold">
        <Sparkles className="h-5 w-5 text-primary" /> {BETA_NAME}
      </h2>
      <p className="mt-1 text-sm">{betaPlanLine(grant.ends_at, grant.revoked_at)}</p>

      <form onSubmit={submit} className="mt-4 space-y-3">
        <div>
          <Label>How is Yooits working for you?</Label>
          <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Rating from 1 to 5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                onClick={() => setRating(rating === n ? null : n)}
                className={`h-9 w-9 rounded-full border text-sm ${rating === n ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor="beta-feedback">What should we fix or add?</Label>
          <Textarea
            id="beta-feedback"
            maxLength={2000}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              setSent(false);
            }}
            placeholder="Anything that confused you, broke, or that you wish your page could do."
          />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={sending}>
            {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send feedback
          </Button>
          {sent && (
            <span className="text-sm text-muted-foreground" role="status">
              Thanks, it's on its way to the Yooits team.
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
