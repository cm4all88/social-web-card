import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { getPlatform, PLATFORMS, PLATFORM_KEYS } from "@/lib/platforms";
import { Plus, Trash2, LogOut, ArrowLeft, Save } from "lucide-react";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
  head: () => ({ meta: [{ title: "Manage your social links" }] }),
});

type SocialLink = {
  id: string;
  platform: string;
  url: string;
  display_order: number;
  enabled: boolean;
};

function AdminPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newPlatform, setNewPlatform] = useState<string>("twitter");

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate({ to: "/auth" });
        return;
      }
      await load();
      setReady(true);
    };
    init();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) navigate({ to: "/auth" });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const load = async () => {
    const { data, error } = await supabase
      .from("social_links")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) toast.error(error.message);
    setLinks((data ?? []) as SocialLink[]);
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
    const nextOrder = (links.at(-1)?.display_order ?? 0) + 1;
    const { data, error } = await supabase
      .from("social_links")
      .insert({ platform: newPlatform, url: "", display_order: nextOrder, enabled: true })
      .select()
      .single();
    if (error) toast.error(error.message);
    else if (data) setLinks((p) => [...p, data as SocialLink]);
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
            <ArrowLeft className="h-4 w-4" /> Back to site
          </Link>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>

        <h1 className="text-3xl font-bold">Manage links</h1>
        <p className="mt-1 text-muted-foreground">Edit the URL for each platform. Empty links are hidden from the public page.</p>

        <div className="mt-8 space-y-4">
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

        <div className="mt-10 rounded-2xl border border-dashed border-border p-5">
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
      </div>
    </div>
  );
}
