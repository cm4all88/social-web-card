/**
 * Appearance on the creator dashboard: the full theme gallery, Plus themes,
 * seasonal and earned themes, and custom colours. Moved here unchanged from
 * the dashboard page so the links can come first.
 */
import { toast } from "sonner";
import { Check, Lock, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  findThemePreset,
  PREMIUM_THEME_PRESETS,
  THEME_PRESETS,
  type ThemeTokens,
} from "@/lib/themes";
import { ThemeRewardsPicker, type useThemeRewards } from "@/components/rewards/ThemeRewards";
import type { MyPlus } from "@/components/plus/PlusPanel";

export type AppearanceProfile = {
  user_id: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  theme: string | null;
  custom_theme: Partial<ThemeTokens> | null;
  created_at?: string | null;
};

export function AppearanceSection<P extends AppearanceProfile>({
  profile,
  setProfile,
  isPlus,
  plus,
  rewards,
  links,
}: {
  profile: P;
  setProfile: (next: P | ((p: P | null) => P | null)) => void;
  isPlus: boolean;
  plus: MyPlus | null;
  rewards: ReturnType<typeof useThemeRewards>;
  links: { enabled: boolean; url: string }[];
}) {
  const setTheme = async (themeKey: string) => {
    if (!profile) return;
    setProfile({ ...profile, theme: themeKey });
    const { error } = await supabase
      .from("profiles")
      .update({ theme: themeKey })
      .eq("user_id", profile.user_id);
    if (error) {
      toast.error(
        /part of Plus/i.test(error.message)
          ? "That theme is part of Plus."
          : /out of season/i.test(error.message)
            ? "That seasonal theme is out of season."
            : /Earn this theme/i.test(error.message)
              ? "Earn that theme first."
              : error.message,
      );
      setProfile((p) => (p ? { ...p, theme: profile.theme } : p));
    } else toast.success(`Theme set to ${findThemePreset(themeKey)?.label ?? themeKey}`);
  };

  const updateCustomTheme = (patch: Partial<ThemeTokens>) => {
    if (!profile) return;
    setProfile({
      ...profile,
      theme: "custom",
      custom_theme: { ...(profile.custom_theme ?? {}), ...patch },
    });
  };

  const saveCustomTheme = async () => {
    if (!profile) return;
    const { error } = await supabase
      .from("profiles")
      .update({ theme: "custom", custom_theme: profile.custom_theme })
      .eq("user_id", profile.user_id);
    if (error) toast.error(error.message);
    else toast.success("Custom theme saved");
  };

  return (
    <div
      id="theme-gallery"
      className="scroll-mt-20 rounded-2xl border border-border bg-card p-5"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="mb-1 font-semibold">Theme</div>
      <p className="mb-4 text-sm text-muted-foreground">
        Pick a vibe for your public page. Click to apply instantly.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {THEME_PRESETS.map((t) => {
          const active = profile.theme === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTheme(t.key)}
              className={`group relative overflow-hidden rounded-xl border p-3 text-left transition-all hover:-translate-y-0.5 ${
                active ? "border-primary ring-2 ring-primary" : "border-border"
              }`}
            >
              <div className="h-20 rounded-lg" style={{ background: t.preview }} />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm font-medium">{t.label}</span>
                {active && <Check className="h-4 w-4 text-primary" />}
              </div>
            </button>
          );
        })}
        <button
          onClick={() => setTheme("custom")}
          className={`group relative overflow-hidden rounded-xl border p-3 text-left transition-all hover:-translate-y-0.5 ${
            profile.theme === "custom"
              ? "border-primary ring-2 ring-primary"
              : "border-dashed border-border"
          }`}
        >
          <div className="flex h-20 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
            Your colors
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-sm font-medium">Custom</span>
            {profile.theme === "custom" && <Check className="h-4 w-4 text-primary" />}
          </div>
        </button>
      </div>

      {(isPlus || plus?.checkoutAvailable) && (
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            Plus themes {!isPlus && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {PREMIUM_THEME_PRESETS.map((t) => {
              const active = profile.theme === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => {
                    if (isPlus) setTheme(t.key);
                    else document.getElementById("plus")?.scrollIntoView({ behavior: "smooth" });
                  }}
                  aria-label={isPlus ? t.label : `${t.label} (Plus)`}
                  className={`group relative overflow-hidden rounded-xl border p-3 text-left transition-all hover:-translate-y-0.5 ${
                    active ? "border-primary ring-2 ring-primary" : "border-border"
                  } ${isPlus ? "" : "opacity-70"}`}
                >
                  <div className="h-20 rounded-lg" style={{ background: t.preview }} />
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm font-medium">{t.label}</span>
                    {active ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : (
                      !isPlus && <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {!isPlus && <p className="mt-2 text-xs text-muted-foreground">Part of Plus.</p>}
        </div>
      )}

      <ThemeRewardsPicker
        enabled={rewards.enabled}
        unlocked={rewards.unlocked}
        currentTheme={profile.theme}
        isPlus={isPlus}
        plusAvailable={!!plus?.checkoutAvailable}
        progress={{
          displayName: profile.display_name,
          bio: profile.bio,
          avatarUrl: profile.avatar_url,
          links,
          createdAt: profile.created_at,
        }}
        onPick={setTheme}
      />

      {profile.theme === "custom" && (
        <div className="mt-6 grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Background color</Label>
            <Input
              type="color"
              value={(profile.custom_theme?.background as string) || "#1a1a2e"}
              onChange={(e) => updateCustomTheme({ background: e.target.value })}
              className="h-10 w-full"
            />
          </div>
          <div className="space-y-2">
            <Label>Text color</Label>
            <Input
              type="color"
              value={(profile.custom_theme?.foreground as string) || "#ffffff"}
              onChange={(e) => updateCustomTheme({ foreground: e.target.value })}
              className="h-10 w-full"
            />
          </div>
          <div className="space-y-2">
            <Label>Card color</Label>
            <Input
              type="color"
              value={(profile.custom_theme?.card as string) || "#2a2a3e"}
              onChange={(e) => updateCustomTheme({ card: e.target.value })}
              className="h-10 w-full"
            />
          </div>
          <div className="space-y-2">
            <Label>Accent color</Label>
            <Input
              type="color"
              value={(profile.custom_theme?.accent as string) || "#a855f7"}
              onChange={(e) => updateCustomTheme({ accent: e.target.value })}
              className="h-10 w-full"
            />
          </div>
          <div className="space-y-2">
            <Label>Button style</Label>
            <Select
              value={profile.custom_theme?.buttonStyle ?? "rounded"}
              onValueChange={(v) =>
                updateCustomTheme({ buttonStyle: v as ThemeTokens["buttonStyle"] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rounded">Rounded</SelectItem>
                <SelectItem value="pill">Pill</SelectItem>
                <SelectItem value="square">Square</SelectItem>
                <SelectItem value="soft">Soft</SelectItem>
                <SelectItem value="outline">Outline</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Font</Label>
            <Select
              value={profile.custom_theme?.font ?? "sans"}
              onValueChange={(v) => updateCustomTheme({ font: v as ThemeTokens["font"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sans">Sans</SelectItem>
                <SelectItem value="serif">Serif</SelectItem>
                <SelectItem value="mono">Mono</SelectItem>
                <SelectItem value="display">Display</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Button onClick={saveCustomTheme}>
              <Save className="mr-2 h-4 w-4" /> Save custom theme
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
