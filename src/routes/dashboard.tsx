import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from "@/components/ui/select";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { usernameError, normalizeUsername, USERNAME_HELP } from "@/lib/username";
import { normalizeLinkValue } from "@/lib/safe-url";
import { getPlatform, PLATFORMS, PLATFORM_CATEGORIES } from "@/lib/platforms";
import { PREMIUM_THEME_PRESETS, THEME_PRESETS, type ThemeTokens } from "@/lib/themes";
import { Plus, Trash2, LogOut, ArrowLeft, Save, Copy, ExternalLink, Check, Upload, X, Lock } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { TipsManager } from "@/components/tipping/TipsManager";
import { BetaPanel } from "@/components/beta/BetaPanel";
import { PlusPanel, plusPanelVisible, useMyPlus } from "@/components/plus/PlusPanel";
import { DeleteAccount } from "@/components/account/DeleteAccount";
import { Gift, Shield } from "lucide-react";

/** Creator dashboard: every signed-in user manages their own page here. */
export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
  head: () => ({ meta: [{ title: "Your dashboard — Yooits" }, { name: "robots", content: "noindex" }] }),
});

const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "earnings", label: "Earnings" },
  { id: "wishlists", label: "Wishlists" },
  { id: "appearance", label: "Appearance" },
  { id: "links", label: "Links" },
  { id: "account", label: "Account" },
] as const;

const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const BIO_MAX = 300;

type SocialLink = {
  id: string;
  platform: string;
  url: string;
  display_order: number;
  enabled: boolean;
  user_id: string;
};

type Profile = {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  theme: string | null;
  custom_theme: Partial<ThemeTokens> | null;
  hide_branding?: boolean | null;
};

function DashboardPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [restriction, setRestriction] = useState<"suspended" | "unpublished" | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newPlatform, setNewPlatform] = useState<string>("twitter");
  const { plus, reload: reloadPlus } = useMyPlus();
  const isPlus = plus?.plan === "plus";

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate({ to: "/auth" });
        return;
      }
      const uid = data.session.user.id;
      setUserId(uid);

      const [{ data: prof }, { data: roles }, { data: l }] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", uid).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase.from("social_links").select("*").eq("user_id", uid).order("display_order", { ascending: true }),
      ]);

      setProfile(prof as Profile | null);
      const admin = (roles ?? []).some((r: { role: string }) => r.role === "admin");
      setIsAdmin(admin);
      setLinks((l ?? []) as SocialLink[]);

      // Set by Yooits admins from the owner console; readable only by this user.
      // (Not in the generated types yet; called as a method so the client keeps its `this`.)
      const { data: st } = await (supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> })
        .from("account_status")
        .select("unpublished_at, suspended_at")
        .eq("user_id", uid)
        .maybeSingle();
      const status = st as { unpublished_at: string | null; suspended_at: string | null } | null;
      setRestriction(status?.suspended_at ? "suspended" : status?.unpublished_at ? "unpublished" : null);
      setReady(true);
    };
    init();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) navigate({ to: "/auth" });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const saveProfile = async () => {
    if (!profile) return;
    const username = normalizeUsername(profile.username ?? "");
    const problem = usernameError(username);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSavingProfile(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        username,
        display_name: profile.display_name,
        bio: profile.bio,
        theme: profile.theme ?? "midnight",
        custom_theme: profile.custom_theme,
      })
      .eq("user_id", profile.user_id);
    setSavingProfile(false);
    if (error) {
      if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
        toast.error("That username is already taken");
      } else if (/reserved/i.test(error.message)) {
        toast.error("That username is reserved. Please pick another.");
      } else {
        toast.error(error.message);
      }
      return;
    }
    setProfile({ ...profile, username });
    toast.success("Profile saved");
  };

  const uploadAvatar = async (file: File) => {
    if (!profile || !userId) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      return;
    }
    if (!AVATAR_TYPES.includes(file.type)) {
      toast.error("Please choose a PNG, JPEG, WebP or GIF image");
      return;
    }
    setUploadingAvatar(true);
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[file.type] ?? "jpg";
    const path = `${userId}/avatar-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type,
    });
    if (upErr) {
      setUploadingAvatar(false);
      toast.error(upErr.message);
      return;
    }
    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    const url = pub.publicUrl;
    const { error: updErr } = await supabase
      .from("profiles")
      .update({ avatar_url: url })
      .eq("user_id", userId);
    setUploadingAvatar(false);
    if (updErr) toast.error(updErr.message);
    else {
      setProfile({ ...profile, avatar_url: url });
      toast.success("Profile picture updated");
    }
  };

  const removeAvatar = async () => {
    if (!profile || !userId) return;
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: null })
      .eq("user_id", userId);
    if (error) toast.error(error.message);
    else {
      setProfile({ ...profile, avatar_url: null });
      toast.success("Profile picture removed");
    }
  };

  const setTheme = async (themeKey: string) => {
    if (!profile) return;
    setProfile({ ...profile, theme: themeKey });
    const { error } = await supabase
      .from("profiles")
      .update({ theme: themeKey })
      .eq("user_id", profile.user_id);
    if (error) {
      toast.error(/part of Plus/i.test(error.message) ? "That theme is part of Plus." : error.message);
      setProfile((p) => (p ? { ...p, theme: profile.theme } : p));
    } else toast.success(`Theme set to ${themeKey}`);
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

  const updateLink = (id: string, patch: Partial<SocialLink>) => {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const save = async (link: SocialLink) => {
    const url = normalizeLinkValue(link.url);
    if (url === null) {
      toast.error("Links must be a plain web address (https://...), mailto:, tel: or sms:");
      return;
    }
    setSavingId(link.id);
    const { error } = await supabase
      .from("social_links")
      .update({ url, enabled: link.enabled, platform: link.platform })
      .eq("id", link.id);
    setSavingId(null);
    if (error) toast.error(error.message);
    else {
      updateLink(link.id, { url });
      toast.success("Saved");
    }
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("social_links").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      setLinks((p) => p.filter((l) => l.id !== id));
      toast.success("Removed");
    }
  };

  const add = async () => {
    if (!userId) return;
    const nextOrder = (links.at(-1)?.display_order ?? 0) + 1;
    const { data, error } = await supabase
      .from("social_links")
      .insert({ platform: newPlatform, url: "", display_order: nextOrder, enabled: true, user_id: userId })
      .select()
      .single();
    if (error) toast.error(error.message);
    else if (data) setLinks((p) => [...p, data as SocialLink]);
  };

  const copyShareLink = () => {
    if (!profile) return;
    const url = `${window.location.origin}/${profile.username}`;
    navigator.clipboard.writeText(url);
    toast.success("Link copied!");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="min-h-screen px-4 py-10">
      <Toaster />
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Home
          </Link>
          <img src="/yooits-logo.png" alt="yooits.me" className="h-9 w-auto" />
          <div className="flex items-center gap-1">
            {isAdmin && (
              <Button variant="ghost" size="sm" asChild>
                <Link to="/owner">
                  <Shield className="mr-2 h-4 w-4" /> <span className="hidden sm:inline">Owner console</span><span className="sm:hidden">Owner</span>
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>

        {profile && (
          <div
            className="rounded-2xl border border-primary/30 p-6"
            style={{ background: "var(--gradient-hero)", boxShadow: "var(--shadow-glow)" }}
          >
            <div className="text-xs font-semibold uppercase tracking-wider text-primary-foreground/80">
              Your shareable link
            </div>
            <div className="mt-2 break-all text-2xl font-bold text-primary-foreground sm:text-3xl">
              {`${typeof window !== "undefined" ? window.location.origin : ""}/${profile.username}`}
            </div>
            <p className="mt-2 text-sm text-primary-foreground/80">
              Share this link anywhere — anyone who opens it sees all your social links.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={copyShareLink}>
                <Copy className="mr-2 h-4 w-4" /> Copy link
              </Button>
              <Button size="sm" variant="secondary" asChild>
                <a href={`/${profile.username}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" /> Open my page
                </a>
              </Button>
            </div>
          </div>
        )}

        {restriction && (
          <div role="status" className="mt-8 rounded-2xl border border-destructive/50 bg-destructive/10 p-4 text-sm">
            {restriction === "suspended"
              ? "Your account is suspended by Yooits. Your page is hidden and changes are turned off. Your information hasn't been deleted."
              : "Your page is unpublished by Yooits, so visitors can't see it right now. You can still edit it, and nothing has been deleted."}
          </div>
        )}

        {userId && <BetaPanel userId={userId} />}

        {userId && profile && (
          <PlusPanel
            plus={plus}
            reload={reloadPlus}
            userId={userId}
            hideBranding={!!profile.hide_branding}
            onHideBrandingChange={(v) => setProfile((p) => (p ? { ...p, hide_branding: v } : p))}
          />
        )}

        <h1 className="mt-10 text-3xl font-bold">Manage your page</h1>

        {/* Section shortcuts: scrolls on small screens, sticks while you scroll */}
        <nav
          aria-label="Dashboard sections"
          className="sticky top-0 z-20 -mx-4 mt-4 flex gap-2 overflow-x-auto bg-background/90 px-4 py-3 backdrop-blur"
        >
          {[...SECTIONS, ...(plusPanelVisible(plus) ? [{ id: "plus", label: "Plus" }] : [])].map((sec) => (
            <a
              key={sec.id}
              href={`#${sec.id}`}
              className="shrink-0 rounded-full border border-border px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
            >
              {sec.label}
            </a>
          ))}
        </nav>

        {/* Profile */}
        {profile && (
          <div id="profile" className="mt-8 scroll-mt-20 rounded-2xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
            <div className="mb-4 font-semibold">Profile</div>

            <div className="mb-6 flex items-center gap-4">
              <Avatar className="h-20 w-20 shrink-0 border-2 border-border">
                <AvatarImage src={profile.avatar_url ?? undefined} alt={profile.username} className="object-cover" />
                <AvatarFallback className="text-2xl font-semibold">
                  {(profile.display_name || profile.username).slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="secondary" disabled={uploadingAvatar}>
                  <label className="cursor-pointer">
                    <Upload className="mr-2 h-4 w-4" />
                    {uploadingAvatar ? "Uploading…" : profile.avatar_url ? "Change photo" : "Upload photo"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadAvatar(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </Button>
                {profile.avatar_url && (
                  <Button size="sm" variant="ghost" onClick={removeAvatar}>
                    <X className="mr-2 h-4 w-4" /> Remove
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={profile.username}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      username: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 30),
                    })
                  }
                  placeholder="yourname"
                  maxLength={30}
                />
                <p className="text-xs text-muted-foreground">{USERNAME_HELP}</p>
                <p className="text-xs text-muted-foreground">
                  yooits.me/<span className="font-medium text-foreground">{profile.username || "yourname"}</span>
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="display">Display name</Label>
                <Input
                  id="display"
                  value={profile.display_name ?? ""}
                  onChange={(e) => setProfile({ ...profile, display_name: e.target.value })}
                  maxLength={50}
                  placeholder="Your name"
                />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                value={profile.bio ?? ""}
                onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                placeholder="A short line about you"
                rows={2}
                maxLength={BIO_MAX}
              />
              <p className="text-right text-xs text-muted-foreground">
                {(profile.bio ?? "").length}/{BIO_MAX}
              </p>
            </div>
            <div className="mt-4">
              <Button onClick={saveProfile} disabled={savingProfile}>
                <Save className="mr-2 h-4 w-4" />
                {savingProfile ? "Saving" : "Save profile"}
              </Button>
            </div>
          </div>
        )}

        {/* Tips (hidden unless tipping is switched on for this deployment) */}
        <div id="earnings" className="scroll-mt-20">
          {profile && userId && <TipsManager userId={userId} username={profile.username} />}
        </div>

        {/* Wishlists */}
        {profile && (
          <div id="wishlists" className="mt-8 flex scroll-mt-20 flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
            <div>
              <div className="font-semibold">Wishlists</div>
              <p className="text-sm text-muted-foreground">Share gift lists for birthdays, holidays and big days.</p>
            </div>
            <Button variant="secondary" asChild>
              <Link to="/dashboard/wishlists">
                <Gift className="mr-2 h-4 w-4" /> Manage wishlists
              </Link>
            </Button>
          </div>
        )}

        {/* Theme picker */}
        {profile && (
          <div id="appearance" className="mt-8 scroll-mt-20 rounded-2xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
            <div className="mb-1 font-semibold">Theme</div>
            <p className="mb-4 text-sm text-muted-foreground">Pick a vibe for your public page. Click to apply instantly.</p>
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
                  profile.theme === "custom" ? "border-primary ring-2 ring-primary" : "border-dashed border-border"
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
                          {active ? <Check className="h-4 w-4 text-primary" /> : !isPlus && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {!isPlus && <p className="mt-2 text-xs text-muted-foreground">Part of Plus.</p>}
              </div>
            )}

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
                    onValueChange={(v) => updateCustomTheme({ buttonStyle: v as ThemeTokens["buttonStyle"] })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
        )}

        {/* Links */}
        <h2 id="links" className="mt-10 scroll-mt-20 text-xl font-bold">Your links</h2>
        <p className="mt-1 text-sm text-muted-foreground">Empty links are hidden from your public page.</p>

        <div className="mt-4 space-y-4">
          {links.map((link) => {
            const meta = getPlatform(link.platform);
            const Icon = meta.icon;
            return (
              <div
                key={link.id}
                className="rounded-2xl border border-border bg-card p-5"
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                <div className="flex items-center gap-4">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${meta.color} text-white`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold">{meta.label}</div>
                    <div className="text-xs text-muted-foreground">Order #{link.display_order}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`en-${link.id}`} className="text-xs text-muted-foreground">Visible</Label>
                    <Switch id={`en-${link.id}`} checked={link.enabled} onCheckedChange={(v) => updateLink(link.id, { enabled: v })} />
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                  <Input
                    value={link.url}
                    onChange={(e) => updateLink(link.id, { url: e.target.value })}
                    placeholder={meta.hint}
                  />
                  <Button onClick={() => save(link)} disabled={savingId === link.id}>
                    <Save className="mr-2 h-4 w-4" />
                    {savingId === link.id ? "Saving" : "Save"}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(link.id)} aria-label="Delete">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 rounded-2xl border border-dashed border-border p-5">
          <div className="mb-3 font-semibold">Add a platform</div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Select value={newPlatform} onValueChange={setNewPlatform}>
              <SelectTrigger className="sm:w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PLATFORM_CATEGORIES.map((cat, i) => (
                  <div key={cat.label}>
                    {i > 0 && <SelectSeparator />}
                    <SelectGroup>
                      <SelectLabel>{cat.label}</SelectLabel>
                      {cat.keys.filter((k) => PLATFORMS[k]).map((k) => {
                        const Icon = PLATFORMS[k].icon;
                        return (
                          <SelectItem key={k} value={k}>
                            <span className="flex items-center gap-2">
                              <Icon className="h-4 w-4" />
                              {PLATFORMS[k].label}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectGroup>
                  </div>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={add}><Plus className="mr-2 h-4 w-4" /> Add</Button>
          </div>
        </div>

        {/* Account */}
        <h2 id="account" className="mt-10 scroll-mt-20 text-xl font-bold">Account</h2>
        <div className="mt-4">
          {profile && <DeleteAccount username={profile.username} />}
        </div>
      </div>
    </div>
  );
}
