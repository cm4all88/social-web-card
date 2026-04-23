import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { getPlatform, PLATFORMS, PLATFORM_KEYS } from "@/lib/platforms";
import { Plus, Trash2, LogOut, ArrowLeft, Save, Copy, ExternalLink } from "lucide-react";

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

type Profile = { id: string; user_id: string; username: string; display_name: string | null; bio: string | null };
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
      .update({ display_name: profile.display_name, bio: profile.bio })
      .eq("user_id", profile.user_id);
    setSavingProfile(false);
    if (error) toast.error(error.message);
    else toast.success("Profile saved");
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

        <h1 className="text-3xl font-bold">Your page</h1>
        {profile && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-muted px-2 py-1 text-sm">{`${typeof window !== "undefined" ? window.location.origin : ""}/${profile.username}`}</code>
            <Button size="sm" variant="outline" onClick={copyShareLink}>
              <Copy className="mr-1 h-3 w-3" /> Copy
            </Button>
            <a
              href={`/${profile.username}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              View <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

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
                {PLATFORM_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>{PLATFORMS[k].label}</SelectItem>
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
