/**
 * The share sheet for a Yooits page. For the page's owner: copy link, the
 * phone's own share sheet, each app's real web share screen, honest steps
 * for Instagram, TikTok and Snapchat (which have no web share), downloadable
 * story and post graphics of their real page, and suggested captions. For a
 * visitor: the link, the phone's share sheet and the app buttons.
 *
 * Every action is counted with recordShare. Nothing is ever posted for
 * anyone: each app button opens that app's compose screen, and the person
 * posts it there.
 */
import { createElement, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Download, Image as ImageIcon, Loader2, Share2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ThemeTokens } from "@/lib/themes";
import {
  APP_ONLY_TARGETS,
  INTENT_TARGETS,
  displayUrl,
  intentUrl,
  profileUrl,
  shareText,
  suggestedCaptions,
  trackedProfileUrl,
  type ShareChannel,
} from "@/lib/share/links";
import {
  ProfileShareGraphic,
  SHARE_SIZES,
  mockLinks,
  photoAsDataUrl,
  type ShareFormat,
  type ShareLink,
} from "@/lib/share/graphic";
import { loadMyShareStats, recordShare, type MyShareStats } from "@/lib/share/track";
import { saveBlob, sizedSvg, svgToPng } from "@/lib/marketing/graphics";

export type ShareSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  username: string;
  name: string;
  bio?: string | null;
  avatarUrl?: string | null;
  theme: ThemeTokens;
  links: ShareLink[];
  showBranding: boolean;
  hasWishlist?: boolean;
  /** The signed-in owner of this page is the one sharing. */
  own: boolean;
  /** Called after any share action (the owner's first-share reward). */
  onShared?: (channel: ShareChannel) => void;
};

function useOrigin() {
  const [origin, setOrigin] = useState("https://yooits.me");
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

const isMobile = () =>
  typeof navigator !== "undefined" && /Mobi|iPhone|iPad|Android/i.test(navigator.userAgent);

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ShareSheet(props: ShareSheetProps) {
  const { open, onOpenChange, username, name, own } = props;
  const origin = useOrigin();
  const url = profileUrl(origin, username);
  const address = displayUrl(origin, username);
  const text = shareText(name, own);
  const [copied, setCopied] = useState<string | null>(null);
  const [canNative, setCanNative] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [howFor, setHowFor] = useState<string | null>(null);
  const [stats, setStats] = useState<MyShareStats | null>(null);

  useEffect(() => {
    setCanNative(typeof navigator !== "undefined" && typeof navigator.share === "function");
    setMobile(isMobile());
  }, []);

  useEffect(() => {
    if (!open || !own) return;
    loadMyShareStats(30).then(setStats, () => setStats(null));
  }, [open, own]);

  const shared = (channel: ShareChannel) => {
    recordShare(username, channel);
    props.onShared?.(channel);
  };

  const copy = async (value: string, key: string, channel: ShareChannel) => {
    if (await copyText(value)) {
      setCopied(key);
      setTimeout(() => setCopied((k) => (k === key ? null : k)), 1800);
      toast.success(channel === "caption" ? "Caption copied" : "Link copied");
      shared(channel);
    } else {
      toast.error("Couldn't copy. Press and hold the text to copy it.");
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({
        title: `${name} on Yooits`,
        text,
        url: trackedProfileUrl(origin, username, "native"),
      });
      shared("native");
    } catch {
      // Closed without sharing: nothing to count.
    }
  };

  const intents = INTENT_TARGETS.filter((t) => !t.mobileOnly || mobile);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{own ? "Share your page" : `Share ${name}'s page`}</DialogTitle>
          <DialogDescription>
            {own
              ? "Put your link where people already find you. Nothing is posted until you post it."
              : "Send this Yooits page to someone."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-2 pl-3">
              <span className="min-w-0 flex-1 truncate font-medium" title={url}>
                {address}
              </span>
              <Button size="sm" onClick={() => copy(url, "link", "copy")}>
                {copied === "link" ? (
                  <Check className="mr-1.5 h-4 w-4" />
                ) : (
                  <Copy className="mr-1.5 h-4 w-4" />
                )}
                {copied === "link" ? "Copied" : "Copy link"}
              </Button>
            </div>
            {canNative && (
              <Button variant="secondary" className="mt-2 w-full" onClick={nativeShare}>
                <Share2 className="mr-2 h-4 w-4" /> Share with your phone's apps
              </Button>
            )}
          </div>

          <section aria-labelledby="share-apps">
            <h3 id="share-apps" className="text-sm font-semibold">
              Share to
            </h3>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {intents.map((t) => (
                <a
                  key={t.channel}
                  href={intentUrl(t.channel, origin, username, text)}
                  target={t.channel === "email" || t.channel === "sms" ? undefined : "_blank"}
                  rel="noopener noreferrer"
                  onClick={() => shared(t.channel)}
                  className="rounded-lg border border-border px-2 py-2 text-center text-sm hover:bg-muted"
                >
                  {t.label}
                </a>
              ))}
              {APP_ONLY_TARGETS.map((t) => (
                <button
                  key={t.channel}
                  type="button"
                  aria-expanded={howFor === t.channel}
                  onClick={() => setHowFor((v) => (v === t.channel ? null : t.channel))}
                  className={`rounded-lg border px-2 py-2 text-center text-sm hover:bg-muted ${
                    howFor === t.channel ? "border-primary" : "border-border"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {APP_ONLY_TARGETS.filter((t) => t.channel === howFor).map((t) => (
              <div
                key={t.channel}
                className="mt-2 rounded-xl border border-border bg-muted/40 p-3 text-sm"
              >
                <p>
                  {t.label} doesn't let websites share to it, so this takes two steps.{" "}
                  {own ? t.how : `Copy the link, then paste it into your ${t.label} story or a message.`}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => copy(url, t.channel, t.channel)}
                  >
                    <Copy className="mr-1.5 h-4 w-4" />
                    {copied === t.channel ? "Copied" : "Copy link"}
                  </Button>
                  {own && (
                    <a
                      href="#share-graphics"
                      className="inline-flex items-center rounded-md px-2 text-sm text-primary hover:underline"
                    >
                      Get the story graphic ↓
                    </a>
                  )}
                </div>
              </div>
            ))}
          </section>

          {own && <Graphics {...props} address={address} onSaved={shared} />}

          {own && (
            <section aria-labelledby="share-captions">
              <h3 id="share-captions" className="text-sm font-semibold">
                Captions you can use
              </h3>
              <ul className="mt-2 space-y-2">
                {suggestedCaptions({ origin, username, hasWishlist: props.hasWishlist }).map(
                  (c, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 rounded-xl border border-border p-2 pl-3 text-sm"
                    >
                      <span className="flex-1">{c}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Copy caption"
                        onClick={() => copy(c, `cap${i}`, "caption")}
                      >
                        {copied === `cap${i}` ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </li>
                  ),
                )}
              </ul>
            </section>
          )}

          {own && stats?.enabled && (
            <p className="text-xs text-muted-foreground">
              Last 30 days: {stats.my_shares} {stats.my_shares === 1 ? "share" : "shares"} by you,{" "}
              {stats.share_visits} {stats.share_visits === 1 ? "visit" : "visits"} from share links,{" "}
              {stats.referred_signups} {stats.referred_signups === 1 ? "sign-up" : "sign-ups"} from
              your page.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Graphics({
  username,
  name,
  bio,
  avatarUrl,
  theme,
  links,
  showBranding,
  address,
  onSaved,
}: ShareSheetProps & { address: string; onSaved: (c: ShareChannel) => void }) {
  const [format, setFormat] = useState<ShareFormat>("story");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState<"download" | "share" | null>(null);
  const [canShareFiles, setCanShareFiles] = useState(false);

  useEffect(() => {
    let live = true;
    photoAsDataUrl(avatarUrl).then((d) => live && setAvatar(d));
    return () => {
      live = false;
    };
  }, [avatarUrl]);

  useEffect(() => {
    try {
      const probe = new File([new Uint8Array(1)], "probe.png", { type: "image/png" });
      setCanShareFiles(
        typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] }),
      );
    } catch {
      setCanShareFiles(false);
    }
  }, []);

  const mocks = useMemo(() => mockLinks(links), [links]);
  // On screen the photo can load from its address; the PNG needs it embedded.
  const graphic = (f: ShareFormat, id: string, forFile = false) =>
    createElement(ProfileShareGraphic, {
      format: f,
      id,
      theme,
      links: mocks,
      address,
      profile: {
        username,
        name,
        bio: bio ?? null,
        avatar: forFile ? avatar : (avatar ?? avatarUrl ?? null),
        showBranding,
      },
    });

  const makePng = async (): Promise<Blob> => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const size = SHARE_SIZES[format];
    const markup = renderToStaticMarkup(graphic(format, `dl-${format}`, true));
    return svgToPng(sizedSvg(markup, size), size);
  };
  const filename = `yooits-${username}-${format}.png`;

  const download = async () => {
    setBusy("download");
    try {
      saveBlob(await makePng(), filename);
      onSaved(format);
    } catch {
      toast.error("Couldn't make the image. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const shareImage = async () => {
    setBusy("share");
    try {
      const file = new File([await makePng()], filename, { type: "image/png" });
      await navigator.share({ files: [file] });
      onSaved(format);
    } catch {
      // Closed without sharing.
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="share-graphics" aria-labelledby="share-graphics-title">
      <div className="flex items-center justify-between gap-2">
        <h3 id="share-graphics-title" className="text-sm font-semibold">
          Story and post graphics
        </h3>
        <div role="tablist" className="flex gap-1">
          {(["story", "post"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={format === f}
              onClick={() => setFormat(f)}
              className={`rounded-full border px-3 py-1 text-xs ${
                format === f
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground"
              }`}
            >
              {f === "story" ? "Story" : "Post"}
            </button>
          ))}
        </div>
      </div>
      <div
        className={`mx-auto mt-3 overflow-hidden rounded-xl border border-border ${
          format === "story" ? "w-44" : "w-56"
        }`}
      >
        {graphic(format, `pv-${format}`)}
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Your page as it looks now, with your link. {SHARE_SIZES[format].label}.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {canShareFiles && (
          <Button size="sm" onClick={shareImage} disabled={busy !== null}>
            {busy === "share" ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <ImageIcon className="mr-1.5 h-4 w-4" />
            )}
            Share image
          </Button>
        )}
        <Button
          size="sm"
          variant={canShareFiles ? "secondary" : "default"}
          onClick={download}
          disabled={busy !== null}
        >
          {busy === "download" ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-1.5 h-4 w-4" />
          )}
          Download PNG
        </Button>
      </div>
    </section>
  );
}
