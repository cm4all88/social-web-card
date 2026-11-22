import { useRef, useState } from "react";
import { ImageIcon, Lock, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import type { ThemeTokens } from "@/lib/themes";
import {
  BACKGROUND_INPUT_MAX_BYTES,
  BACKGROUND_INPUT_TYPES,
  BACKGROUND_UPLOAD_MAX_BYTES,
  DEFAULT_POPULAR_AT,
  backgroundPath,
  backgroundScrim,
  fitWithin,
  ownBackgroundPath,
  popularHint,
} from "@/lib/backgrounds";

async function decode(
  file: File,
): Promise<{ img: CanvasImageSource; width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      const b = await createImageBitmap(file, {
        imageOrientation: "from-image",
      } as ImageBitmapOptions);
      return { img: b, width: b.width, height: b.height };
    } catch {
      /* fall back to an <img> below */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (c: HTMLCanvasElement, type: string, q: number) =>
  new Promise<Blob | null>((res) => c.toBlob(res, type, q));

/** Shrinks a photo for the web: longest side 1920px, WebP (or JPEG where WebP can't be made). */
async function shrinkPhoto(file: File): Promise<{ blob: Blob; ext: "webp" | "jpg" }> {
  const { img, width, height } = await decode(file);
  const size = fitWithin(width, height);
  if (!size.width) throw new Error("unreadable");
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("unreadable");
  ctx.drawImage(img, 0, 0, size.width, size.height);
  (img as ImageBitmap).close?.();
  for (const q of [0.82, 0.68, 0.5]) {
    const webp = await toBlob(canvas, "image/webp", q);
    if (webp && webp.type === "image/webp" && webp.size <= BACKGROUND_UPLOAD_MAX_BYTES)
      return { blob: webp, ext: "webp" };
    const jpg = await toBlob(canvas, "image/jpeg", q);
    if (jpg && jpg.size <= BACKGROUND_UPLOAD_MAX_BYTES) return { blob: jpg, ext: "jpg" };
  }
  throw new Error("too_big");
}

/**
 * Custom background in the appearance editor: the creator's own photo behind
 * their page, with a shade that keeps text readable. Unlocks at the popular
 * reward's view count, or with Plus. Works with any theme and effect.
 */
export function BackgroundPicker({
  userId,
  background,
  tokens,
  enabled,
  isPlus,
  popular,
  profileViews,
  popularAt,
  onSaved,
}: {
  userId: string;
  background: string | null | undefined;
  /** The page's theme as it shows now, for the preview. */
  tokens: ThemeTokens;
  /** Custom backgrounds are switched on for the site. */
  enabled: boolean;
  isPlus: boolean;
  /** The creator has the popular reward. */
  popular: boolean;
  profileViews: number;
  popularAt: number | null;
  onSaved: (url: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  if (!enabled) return null;

  const allowed = isPlus || popular;
  const at = popularAt ?? DEFAULT_POPULAR_AT;

  const save = async (url: string | null) => {
    const { error } = await supabase
      .from("profiles")
      .update({ background_url: url } as never)
      .eq("user_id", userId);
    return error;
  };

  const upload = async (file: File) => {
    if (!BACKGROUND_INPUT_TYPES.includes(file.type) && !/\.(heic|heif)$/i.test(file.name)) {
      toast.error("Pick a photo (JPG, PNG, WebP or HEIC).");
      return;
    }
    if (file.size > BACKGROUND_INPUT_MAX_BYTES) {
      toast.error("That photo is over 25 MB. Pick a smaller one.");
      return;
    }
    setBusy("upload");
    try {
      let shrunk: { blob: Blob; ext: "webp" | "jpg" };
      try {
        shrunk = await shrinkPhoto(file);
      } catch {
        toast.error("Couldn't read that photo. Try a JPG or PNG.");
        return;
      }
      const path = backgroundPath(userId, shrunk.ext);
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, shrunk.blob, {
        contentType: shrunk.ext === "webp" ? "image/webp" : "image/jpeg",
        // Short, so a photo taken down stops loading from caches soon after.
        cacheControl: "3600",
        upsert: false,
      });
      if (upErr) {
        toast.error(upErr.message);
        return;
      }
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const error = await save(pub.publicUrl);
      if (error) {
        await supabase.storage.from("avatars").remove([path]);
        toast.error(
          /unlock at|available yet/i.test(error.message)
            ? error.message
            : "Couldn't save your background.",
        );
        return;
      }
      const old = ownBackgroundPath(background, userId);
      if (old) void supabase.storage.from("avatars").remove([old]);
      onSaved(pub.publicUrl);
      toast.success("Background saved");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    setBusy("remove");
    try {
      const error = await save(null);
      if (error) {
        toast.error("Couldn't remove your background.");
        return;
      }
      const old = ownBackgroundPath(background, userId);
      if (old) void supabase.storage.from("avatars").remove([old]);
      onSaved(null);
      toast.success("Background removed");
    } finally {
      setBusy(null);
    }
  };

  const pct = Math.min(100, Math.round((Math.min(profileViews, at) / at) * 100));

  return (
    <div className="mt-6" id="background">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <ImageIcon className="h-4 w-4 text-primary" /> Custom background
        {!allowed && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Your own photo behind your page, with a soft shade so your links stay easy to read. Works
        with any theme and effect.
      </p>

      {!allowed ? (
        <div className="rounded-xl border border-border p-4">
          <p className="text-sm">{popularHint(profileViews, at)}</p>
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={at}
            aria-valuenow={Math.min(profileViews, at)}
            aria-label="Views toward custom backgrounds"
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          {background && (
            <p className="mt-3 text-xs text-muted-foreground">
              Your photo is saved but hidden until you unlock this again.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div
            className="relative flex h-40 items-center justify-center overflow-hidden rounded-xl border border-border"
            style={{ background: tokens.background }}
          >
            {background && (
              <>
                <img
                  src={background}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                />
                <div
                  className="absolute inset-0"
                  style={{ background: backgroundScrim(tokens.foreground) }}
                />
              </>
            )}
            <div
              className="relative rounded-lg border px-4 py-2 text-sm font-medium"
              style={{
                background: tokens.card,
                color: tokens.cardForeground,
                borderColor: tokens.border,
              }}
            >
              {background ? "Your links show like this" : "No photo yet"}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={!!busy}
              onClick={() => input.current?.click()}
            >
              <Upload className="mr-1.5 h-4 w-4" />
              {busy === "upload" ? "Uploading…" : background ? "Change photo" : "Upload photo"}
            </Button>
            {background && (
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={remove}>
                <Trash2 className="mr-1.5 h-4 w-4" />
                {busy === "remove" ? "Removing…" : "Remove"}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Photos are shrunk for phones before they upload. Keep it safe for work: anyone can
            report a page, and photos that break the{" "}
            <a href="/legal/acceptable-use" className="underline">
              acceptable use rules
            </a>{" "}
            are taken down.
          </p>
        </div>
      )}
    </div>
  );
}
