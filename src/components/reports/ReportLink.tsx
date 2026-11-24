import { useState } from "react";
import { Flag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { submitReport } from "@/lib/reports/functions";
import { REPORT_DETAILS_MAX, REPORT_REASONS, type ReportReason } from "@/lib/reports/reasons";

/** A small "Report" link that opens a form. Reports go to the Yooits.me owner. */
export function ReportLink({
  username,
  wishlistSlug = null,
  color,
}: {
  username: string;
  wishlistSlug?: string | null;
  color?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [contact, setContact] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const what = wishlistSlug ? "wishlist" : "page";

  const send = async () => {
    if (!reason) return;
    setBusy(true);
    try {
      await submitReport({ data: { username, wishlistSlug, reason, details, contact, website } });
      setSent(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "We couldn't send your report.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setSent(false);
          setReason(null);
          setDetails("");
        }
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs opacity-60 hover:opacity-100"
          style={color ? { color } : undefined}
        >
          <Flag className="h-3 w-3" /> Report this {what}
        </button>
      </DialogTrigger>
      <DialogContent>
        {sent ? (
          <>
            <DialogHeader>
              <DialogTitle>Thanks, we've got your report</DialogTitle>
              <DialogDescription>Yooits.me will look at this {what}.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Close</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Report this {what}</DialogTitle>
              <DialogDescription>Tell us what's wrong. The person you're reporting won't see who sent it.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2" role="radiogroup" aria-label="Reason">
              {REPORT_REASONS.map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="report-reason"
                    value={r.id}
                    checked={reason === r.id}
                    onChange={() => setReason(r.id)}
                  />
                  {r.label}
                </label>
              ))}
            </div>
            <div className="space-y-1">
              <Label htmlFor="report-details">More detail (optional)</Label>
              <Textarea
                id="report-details"
                value={details}
                maxLength={REPORT_DETAILS_MAX}
                onChange={(e) => setDetails(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="report-contact">Your email, if you'd like a reply (optional)</Label>
              <Input
                id="report-contact"
                type="email"
                value={contact}
                maxLength={254}
                onChange={(e) => setContact(e.target.value)}
              />
            </div>
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label htmlFor="report-website">Website</label>
              <input id="report-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
            <DialogFooter>
              <Button onClick={send} disabled={!reason || busy}>
                {busy ? "Sending…" : "Send report"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
