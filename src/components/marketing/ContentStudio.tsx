import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { type PlatformId, type PostFormat } from "@/lib/marketing/platforms";
import { findSkin, SKINS, THEME_DEFAULT_SKIN } from "@/lib/skins";
import {
  PREMIUM_THEME_PRESETS,
  REWARD_THEME_PRESETS,
  SEASONAL_THEME_PRESETS,
  THEME_PRESETS,
} from "@/lib/themes";
import {
  DEMO_PROFILES,
  demoProfileSchema,
  STUDIO_TEMPLATES,
  type DemoProfile,
  type StudioGraphicSpec,
} from "@/lib/marketing/studio";
import { limitBio, MAX_EXTRA_AVATARS, PROFILE_BIO_LIMIT } from "@/lib/profile-presentation";
import { saveBlob } from "@/lib/marketing/graphics";
import { toLocalInput } from "./PostDialogs";
import { addDrafts, type Campaign } from "./api";
import { StudioGraphic } from "./StudioGraphic";

const themes = [
  ...THEME_PRESETS,
  ...PREMIUM_THEME_PRESETS,
  ...SEASONAL_THEME_PRESETS,
  ...REWARD_THEME_PRESETS,
];
const selectStyle = "w-full rounded-md border bg-background p-2";
type Saved = { id: string; profile: DemoProfile };
type Target = {
  id: string;
  label: string;
  platform: PlatformId;
  format: PostFormat;
  canvas: StudioGraphicSpec["canvas"];
};
const targets: Target[] = [
  {
    id: "portrait",
    label: "Instagram portrait",
    platform: "instagram",
    format: "post",
    canvas: "portrait",
  },
  {
    id: "square",
    label: "Instagram square",
    platform: "instagram",
    format: "post",
    canvas: "square",
  },
  {
    id: "carousel",
    label: "Instagram carousel",
    platform: "instagram",
    format: "carousel",
    canvas: "portrait",
  },
  {
    id: "story",
    label: "Instagram Story",
    platform: "instagram",
    format: "story",
    canvas: "vertical",
  },
  {
    id: "reel",
    label: "Instagram Reel (MP4)",
    platform: "instagram",
    format: "reel",
    canvas: "vertical",
  },
  {
    id: "tiktok",
    label: "TikTok video (MP4)",
    platform: "tiktok",
    format: "video",
    canvas: "vertical",
  },
];

function suggestedTime() {
  const local = new Date();
  local.setDate(local.getDate() + 1);
  local.setHours(11, 0, 0, 0);
  return toLocalInput(local.toISOString());
}

async function photoData(file: File, width: number) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10_000_000) {
    throw new Error("Choose a PNG, JPEG or WebP under 10 MB.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, width / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.75);
  } finally {
    bitmap.close();
  }
}

export function ContentStudio({
  campaigns,
  onAdded,
}: {
  campaigns: Campaign[];
  onAdded: () => void;
}) {
  const [profile, setProfile] = useState<DemoProfile>(DEMO_PROFILES[0].profile);
  const [canSave, setCanSave] = useState(false);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [selection, setSelection] = useState("demo-0");
  const [template, setTemplate] = useState<string>(STUDIO_TEMPLATES[0]);
  const [headline, setHeadline] = useState("");
  const [cta, setCta] = useState("");
  const [date, setDate] = useState(suggestedTime);
  const [campaign, setCampaign] = useState("");
  const [formats, setFormats] = useState(["portrait"]);
  const [presentation, setPresentation] = useState<StudioGraphicSpec["presentation"]>("device");
  const [slides, setSlides] = useState<DemoProfile[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void supabase
      .from("marketing_demo_profiles")
      .select("id, profile")
      .order("updated_at", { ascending: false })
      .then(({ data, error }) => {
        if (!live) return;
        if (error) {
          if (error.code !== "PGRST205" && error.code !== "42P01") toast.error(error.message);
          return;
        }
        setCanSave(true);
        setSaved(
          (data ?? []).flatMap((row) => {
            const result = demoProfileSchema.safeParse(row.profile);
            return result.success ? [{ id: row.id, profile: result.data }] : [];
          }),
        );
      });
    return () => {
      live = false;
    };
  }, []);

  const patch = (value: Partial<DemoProfile>) =>
    setProfile((current) => ({ ...current, ...value }));
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Studio action failed.");
    } finally {
      setBusy(false);
    }
  };
  const checkedProfile = () => {
    const result = demoProfileSchema.safeParse(profile);
    if (!result.success)
      throw new Error("Check the fictional username, image sizes, and .example demo destinations.");
    return result.data;
  };
  const save = () =>
    run(async () => {
      const demo = checkedProfile();
      const existing = saved.find((item) => item.id === selection);
      const { data, error } = await supabase
        .from("marketing_demo_profiles")
        .upsert({
          ...(existing ? { id: existing.id } : {}),
          profile: demo,
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      setSaved((items) => [
        { id: data.id, profile: demo },
        ...items.filter((item) => item.id !== data.id),
      ]);
      setSelection(data.id);
      toast.success("Demo profile saved");
    });
  const activeTargets = targets.filter((target) => formats.includes(target.id));
  const previewTarget = activeTargets[0] ?? targets[0];
  const animated = !!findSkin(profile.skin || THEME_DEFAULT_SKIN[profile.theme]);
  const compare = template === "Before and after" || template === "Theme transformation";
  const applyTemplate = (value: string) => {
    const theme = themes.find((theme) => theme.key === profile.theme)?.label ?? "Midnight";
    const skin = findSkin(profile.skin || THEME_DEFAULT_SKIN[profile.theme])?.label;
    const headlines: Record<string, string> = {
      "Theme of the day": `Try the ${theme} theme`,
      "Seasonal skin showcase": skin ? `${skin} on Yooits.me` : "Give your profile a seasonal look",
      "Creator spotlight": `Meet ${profile.name}`,
      "Profile inspiration": "Make your link page feel like you",
      "Theme transformation": "Same profile, a different look",
      "Before and after": "Before and after",
      "Feature demonstration": "See it on a Yooits.me profile",
      "Free account promotion": "One profile for all your links",
      "Creator lifestyle": `A look at ${profile.name}’s profile`,
      "New theme announcement": `Meet ${theme}`,
    };
    setTemplate(value);
    setHeadline((headlines[value] ?? "").slice(0, 80));
    if (value === "Free account promotion") setCta("Create your free profile on Yooits.me");
    if (value === "Before and after" || value === "Theme transformation") {
      setFormats(["carousel"]);
      setSlides([{ ...profile, theme: "midnight", skin: "none" }]);
    }
  };
  const add = () =>
    run(async () => {
      const demo = checkedProfile();
      if (
        formats.includes("carousel") &&
        slides.some((slide) => !demoProfileSchema.safeParse(slide).success)
      ) {
        throw new Error(
          "One carousel snapshot has an invalid profile. Remove it and add it again.",
        );
      }
      if (formats.includes("carousel") && !slides.length)
        throw new Error("Add at least one extra carousel slide.");
      if (
        !animated &&
        activeTargets.some((target) => target.format === "reel" || target.format === "video")
      ) {
        throw new Error("Choose an animated skin for Reel or TikTok video.");
      }
      const result = await addDrafts(
        campaign || null,
        activeTargets.map((target) => {
          const title = `${headline || template} · ${demo.name} · ${target.label}`.slice(0, 120);
          const action =
            target.platform === "tiktok"
              ? "See more at yooits.me."
              : target.format === "carousel"
                ? "Swipe through the looks. Explore Yooits.me at yooits.me."
                : "Explore Yooits.me at yooits.me.";
          const about = headline ? `${headline}\n\n` : "";
          return {
            platform: target.platform,
            format: target.format,
            kind: "demo",
            title,
            caption: `${about}${demo.name} is a fictional demo profile. ${action}`,
            hashtags:
              target.platform === "tiktok"
                ? ["Yooits", "LinkInBio"]
                : ["Yooits", "ProfileInspiration"],
            graphic: {
              theme: "brand",
              headline,
              cta,
              studio: {
                video: target.format === "reel" || target.format === "video",
                canvas: target.canvas,
                presentation,
                profiles:
                  target.format === "carousel"
                    ? compare
                      ? [...slides, demo]
                      : [demo, ...slides]
                    : [demo],
              },
            },
            features: [],
            landing_path: "/",
            source: "manual",
            scheduled_at: date ? new Date(date).toISOString() : null,
          };
        }),
      );
      toast.success(
        `${result.added} drafts added to the queue${result.skipped ? ` · ${result.skipped} duplicates skipped` : ""}`,
      );
      onAdded();
    });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_350px]">
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        <label className="block text-sm">
          Demo profile
          <select
            className={selectStyle}
            value={selection}
            onChange={(event) => {
              const id = event.target.value;
              setSelection(id);
              setProfile(
                saved.find((item) => item.id === id)?.profile ??
                  DEMO_PROFILES[Number(id.slice(5))].profile,
              );
            }}
          >
            {DEMO_PROFILES.map(({ audience, profile: demo }, i) => (
              <option key={demo.username} value={`demo-${i}`}>
                {audience} · {demo.name} · {demo.links.length} links
              </option>
            ))}
            {saved.map((item) => (
              <option key={item.id} value={item.id}>
                {item.profile.name} · Saved
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Name
            <Input
              value={profile.name}
              maxLength={50}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>
          <label className="text-sm">
            Username
            <Input
              value={profile.username}
              maxLength={40}
              onChange={(event) => patch({ username: event.target.value })}
            />
          </label>
        </div>
        <label className="block text-sm">
          Bio
          <Textarea
            value={profile.bio}
            onChange={(event) => patch({ bio: limitBio(event.target.value, PROFILE_BIO_LIMIT) })}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["avatar", "background"] as const).map((key) => (
            <div key={key}>
              <label className="block text-sm">
                {key === "avatar" ? "Demo avatar" : "Demo background"}
                <Input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file)
                      void run(async () =>
                        patch({ [key]: await photoData(file, key === "avatar" ? 480 : 1000) }),
                      );
                  }}
                />
              </label>
              {profile[key] && (
                <Button type="button" variant="ghost" onClick={() => patch({ [key]: "" })}>
                  Remove image
                </Button>
              )}
            </div>
          ))}
          <label className="text-sm">
            Theme
            <select
              className={selectStyle}
              value={profile.theme}
              onChange={(event) => patch({ theme: event.target.value })}
            >
              {themes.map((theme) => (
                <option key={theme.key} value={theme.key}>
                  {theme.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Animated skin
            <select
              className={selectStyle}
              value={profile.skin}
              onChange={(event) => patch({ skin: event.target.value })}
            >
              <option value="">Theme default</option>
              <option value="none">None</option>
              {SKINS.map((skin) => (
                <option key={skin.key} value={skin.key}>
                  {skin.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Animation intensity
            <select
              className={selectStyle}
              value={profile.motion ?? "standard"}
              onChange={(event) => patch({ motion: event.target.value as DemoProfile["motion"] })}
            >
              <option value="subtle">Subtle</option>
              <option value="standard">Standard</option>
              <option value="full">Full</option>
            </select>
          </label>
          <label className="text-sm">
            Avatar size
            <select
              className={selectStyle}
              value={profile.avatarSize}
              onChange={(event) =>
                patch({ avatarSize: Number(event.target.value) as DemoProfile["avatarSize"] })
              }
            >
              {[112, 144, 176].map((size) => (
                <option key={size} value={size}>
                  {size} px
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Bio alignment
            <select
              className={selectStyle}
              value={profile.bioAlignment}
              onChange={(event) =>
                patch({ bioAlignment: event.target.value as DemoProfile["bioAlignment"] })
              }
            >
              <option value="center">Center</option>
              <option value="left">Left</option>
            </select>
          </label>
        </div>
        <fieldset className="space-y-2">
          <p className="text-sm">Demo avatar carousel</p>
          <div className="flex flex-wrap gap-3">
            {profile.avatarGallery?.map((photo, index) => (
              <div key={index} className="flex items-center gap-2">
                <img
                  src={photo}
                  alt={`Demo carousel photo ${index + 1}`}
                  className="size-10 rounded-full object-cover"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    patch({
                      avatarGallery: profile.avatarGallery?.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          {(profile.avatarGallery?.length ?? 0) < MAX_EXTRA_AVATARS && (
            <label className="inline-grid text-sm">
              Add demo carousel photo
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file)
                    void run(async () =>
                      patch({
                        avatarGallery: [
                          ...(profile.avatarGallery ?? []),
                          await photoData(file, 480),
                        ],
                      }),
                    );
                }}
              />
            </label>
          )}
        </fieldset>
        <div className="space-y-2">
          <p className="text-sm">Social links use fictional .example destinations.</p>
          {profile.links.map((link, i) => (
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]" key={i}>
              {(["platform", "title", "url"] as const).map((key) => (
                <Input
                  key={key}
                  aria-label={`Link ${i + 1} ${key}`}
                  placeholder={key}
                  value={link[key]}
                  onChange={(event) =>
                    patch({
                      links: profile.links.map((entry, index) =>
                        index === i ? { ...entry, [key]: event.target.value } : entry,
                      ),
                    })
                  }
                />
              ))}
              <Button
                variant="outline"
                onClick={() => patch({ links: profile.links.filter((_, index) => i !== index) })}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            disabled={profile.links.length >= 8}
            onClick={() =>
              patch({
                links: [
                  ...profile.links,
                  { platform: "website", title: "", url: "https://demo.example/" },
                ],
              })
            }
          >
            Add link
          </Button>{" "}
          <Button disabled={!canSave} onClick={save}>
            Save demo profile
          </Button>
          {!canSave && (
            <p className="text-xs text-muted-foreground">
              Saved demo profiles need the latest database migration.
            </p>
          )}
        </div>
        <hr />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Template
            <select
              className={selectStyle}
              value={template}
              onChange={(event) => applyTemplate(event.target.value)}
            >
              {STUDIO_TEMPLATES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Campaign
            <select
              className={selectStyle}
              value={campaign}
              onChange={(event) => setCampaign(event.target.value)}
            >
              <option value="">No campaign</option>
              {campaigns
                .filter((item) => item.status !== "archived")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm">
            Headline
            <Input
              value={headline}
              maxLength={80}
              onChange={(event) => setHeadline(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Call to action
            <Input value={cta} maxLength={70} onChange={(event) => setCta(event.target.value)} />
          </label>
          <label className="text-sm">
            Suggested publishing time
            <Input
              type="datetime-local"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Presentation
            <select
              className={selectStyle}
              value={presentation}
              onChange={(event) => setPresentation(event.target.value as typeof presentation)}
            >
              <option value="device">Branded device</option>
              <option value="standalone">Standalone profile</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          {targets.map((target) => (
            <label key={target.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={formats.includes(target.id)}
                onChange={(event) =>
                  setFormats((current) =>
                    event.target.checked
                      ? [...current, target.id]
                      : current.filter((id) => id !== target.id),
                  )
                }
              />
              {target.label}
            </label>
          ))}
        </div>
        {formats.includes("carousel") && (
          <div className="space-y-2">
            <p className="text-sm">
              {compare
                ? "The saved snapshots appear first. The current profile is the final slide."
                : "The current profile is slide 1. Save up to three additional snapshots in order."}
            </p>
            {slides.map((slide, index) => (
              <div key={index} className="flex items-center gap-2 text-sm">
                {index + (compare ? 1 : 2)}. {slide.name} · {slide.theme}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSlides((items) => items.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              disabled={slides.length >= 3}
              onClick={() =>
                void run(async () => {
                  setSlides([...slides, checkedProfile()]);
                })
              }
            >
              Add current profile as slide
            </Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button disabled={!formats.length} onClick={add}>
            Add drafts to approval queue
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              void run(async () => {
                const { captureStudio } = await import("./captureStudio");
                const demo = checkedProfile();
                const png = await captureStudio(
                  { profiles: [demo], canvas: previewTarget.canvas, presentation },
                  0,
                  headline,
                  cta,
                );
                saveBlob(png, `yooits-${demo.username}-${previewTarget.canvas}.png`);
              })
            }
          >
            Download preview PNG
          </Button>
          {animated && (
            <Button
              variant="outline"
              onClick={() =>
                void run(async () => {
                  const { captureStudioVideo } = await import("./captureStudio");
                  const demo = checkedProfile();
                  const video = await captureStudioVideo(
                    { profiles: [demo], canvas: "vertical", presentation },
                    0,
                    headline,
                    cta,
                  );
                  saveBlob(video, `yooits-${demo.username}-vertical.mp4`);
                })
              }
            >
              Download animated MP4
            </Button>
          )}
        </div>
      </fieldset>
      <div className="max-w-full overflow-auto rounded-xl border">
        <div style={{ zoom: 0.6 }}>
          <StudioGraphic
            profile={profile}
            canvas={previewTarget.canvas}
            presentation={presentation}
            headline={headline}
            cta={cta}
          />
        </div>
      </div>
    </div>
  );
}
