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
import { getPlatform, PLATFORMS, PLATFORM_CATEGORIES } from "@/lib/platforms";
import { THEME_PRESETS, type ThemeTokens } from "@/lib/themes";
import { Plus, Trash2, LogOut, ArrowLeft, Save, Copy, ExternalLink, Check, Upload, X } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
  head: () => ({ meta: [{ title: "Manage your links — LinkHub" }] }),
});

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
  theme: string | null;
  custom_theme: Partial<ThemeTokens> | null;
};
type Invite = { id: string; code: string; used_by: string | null; used_at: string | null; created_at: string };

function AdminPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newPlatform, setNewPlatform] = useState<string>("twitter");
  const [invites, setInvites] = useState<Invite[]>([]);

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

      if (admin) {
        const { data: inv } = await supabase.from("invites").select("*").order("created_at", { ascending: false });
        setInvites((inv ?? []) as Invite[]);
      }
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
    setSavingProfile(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: profile.display_name,
        bio: profile.bio,
        theme: profile.theme ?? "midnight",
        custom_theme: profile.custom_theme,
      })
      .eq("user_id", profile.user_id);
    setSavingProfile(false);
    if (error) toast.error(error.message);
    else toast.success("Profile saved");
  };

  const setTheme = async (themeKey: string) => {
    if (!profile) return;
    setProfile({ ...profile, theme: themeKey });
    const { error } = await supabase
      .from("profiles")
      .update({ theme: themeKey })
      .eq("user_id", profile.user_id);
    if (error) toast.error(error.message);
    else toast.success(`Theme set to ${themeKey}`);
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
    setSavingId(link.id);
    const { error } = await supabase
      .from("social_links")
      .update({ url: link.url, enabled: link.enabled, platform: link.platform })
      .eq("id", link.id);
    setSavingId(null);
    if (error) toast.error(error.message);
    else toast.success("Saved");
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

  const createInvite = async () => {
    if (!userId) return;
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map((b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31])
      .join("");
    const { data, error } = await supabase
      .from("invites")
      .insert({ code, created_by: userId })
      .select()
      .single();
    if (error) toast.error(error.message);
    else if (data) {
      setInvites((p) => [data as Invite, ...p]);
      toast.success(`Invite created: ${code}`);
    }
  };

  const revokeInvite = async (id: string) => {
    const { error } = await supabase.from("invites").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      setInvites((p) => p.filter((i) => i.id !== id));
      toast.success("Invite revoked");
    }
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
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
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

        <h1 className="mt-10 text-3xl font-bold">Manage your page</h1>

        {/* Profile */}
        {profile && (
          <div className="mt-8 rounded-2xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
            <div className="mb-4 font-semibold">Profile</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Username</Label>
                <Input value={profile.username} disabled />
              </div>
              <div className="space-y-2">
                <Label htmlFor="display">Display name</Label>
                <Input
                  id="display"
                  value={profile.display_name ?? ""}
                  onChange={(e) => setProfile({ ...profile, display_name: e.target.value })}
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
              />
            </div>
            <div className="mt-4">
              <Button onClick={saveProfile} disabled={savingProfile}>
                <Save className="mr-2 h-4 w-4" />
                {savingProfile ? "Saving" : "Save profile"}
              </Button>
            </div>
          </div>
        )}

        {/* Theme picker */}
        {profile && (
          <div className="mt-8 rounded-2xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
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
        <h2 className="mt-10 text-xl font-bold">Your links</h2>
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

        {/* Invites (admin only) */}
        {isAdmin && (
          <div className="mt-12">
            <h2 className="text-xl font-bold">Invites</h2>
            <p className="mt-1 text-sm text-muted-foreground">Create codes to let new people sign up.</p>
            <div className="mt-4">
              <Button onClick={createInvite}><Plus className="mr-2 h-4 w-4" /> Generate invite code</Button>
            </div>
            <div className="mt-4 space-y-2">
              {invites.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No invites yet.
                </div>
              ) : (
                invites.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-3">
                    <div className="flex items-center gap-3">
                      <code className="rounded-md bg-muted px-2 py-1 text-sm font-mono">{inv.code}</code>
                      <span className={`text-xs ${inv.used_by ? "text-muted-foreground" : "text-primary"}`}>
                        {inv.used_by ? "Used" : "Available"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {!inv.used_by && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            navigator.clipboard.writeText(inv.code);
                            toast.success("Code copied");
                          }}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => revokeInvite(inv.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
