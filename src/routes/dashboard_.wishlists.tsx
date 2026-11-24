import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  ExternalLink,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  hostOf,
  isSafeExternalUrl,
  normalizeExternalUrl,
  OCCASIONS,
  type MyClaim,
  slugify,
  type Wishlist,
  type WishlistItem,
} from "@/lib/wishlists";

type Rpc = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase as unknown as Rpc).rpc(fn, args);

export const Route = createFileRoute("/dashboard_/wishlists")({
  component: WishlistsAdmin,
  head: () => ({ meta: [{ title: "Your wishlists — Yooits.me" }] }),
});

const blankItem = { name: "", url: "", image_url: "", price_text: "", description: "" };

function WishlistsAdmin() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState<string>("");
  const [lists, setLists] = useState<Wishlist[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [draft, setDraft] = useState(blankItem);
  const [claimsOn, setClaimsOn] = useState(false);
  const [myClaims, setMyClaims] = useState<MyClaim[]>([]);

  const active = lists.find((l) => l.id === activeId) ?? null;

  const loadLists = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from("wishlists")
      .select("*")
      .eq("user_id", uid)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) toast.error(error.message);
    setLists((data ?? []) as Wishlist[]);
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return navigate({ to: "/auth" });
      const uid = data.session.user.id;
      setUserId(uid);
      const { data: prof } = await supabase
        .from("profiles")
        .select("username")
        .eq("user_id", uid)
        .maybeSingle();
      setUsername(prof?.username ?? "");
      await loadLists(uid);
      // Gifts this person said they'll buy. Quietly empty before the claims migration.
      const { data: mine, error: mineErr } = await rpc("my_wishlist_claims");
      if (!mineErr && Array.isArray(mine)) setMyClaims(mine as MyClaim[]);
    })();
  }, [navigate, loadLists]);

  useEffect(() => {
    if (!activeId) return setClaimsOn(false);
    rpc("wishlist_claim_status", { _wishlist_id: activeId }).then(({ data, error }) =>
      setClaimsOn(!error && !!(data as { claims_on?: boolean } | null)?.claims_on),
    );
  }, [activeId]);

  const unclaim = async (itemId: string) => {
    const { error } = await rpc("unclaim_wishlist_item", { _item_id: itemId });
    if (error) return toast.error(error.message);
    setMyClaims((p) => p.filter((c) => c.item_id !== itemId));
    toast.success("Okay, it's free for someone else.");
  };

  useEffect(() => {
    if (!activeId) return setItems([]);
    supabase
      .from("wishlist_items")
      .select("*")
      .eq("wishlist_id", activeId)
      .order("display_order", { ascending: true })
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        setItems((data ?? []) as WishlistItem[]);
      });
  }, [activeId]);

  const createList = async () => {
    if (!userId) return;
    const title = newTitle.trim();
    if (!title) return toast.error("Give your wishlist a title");
    const base = slugify(title);
    for (let n = 1; n <= 20; n++) {
      const slug = n === 1 ? base : `${base.slice(0, 46).replace(/-+$/, "")}-${n}`;
      const { data, error } = await supabase
        .from("wishlists")
        .insert({ user_id: userId, title: title.slice(0, 80), slug, display_order: lists.length })
        .select()
        .single();
      if (!error && data) {
        setLists((p) => [...p, data as Wishlist]);
        setActiveId(data.id);
        setNewTitle("");
        toast.success("Wishlist created. It's private until you make it public.");
        return;
      }
      if (error && error.code !== "23505") return toast.error(error.message);
    }
    toast.error("Try a different title");
  };

  const saveList = async () => {
    if (!active) return;
    const { error } = await supabase
      .from("wishlists")
      .update({
        title: active.title.trim().slice(0, 80),
        description: active.description?.trim() || null,
        occasion: active.occasion?.trim() || null,
        recipient_name: active.recipient_name?.trim().slice(0, 40) || null,
        reveal_claims: active.reveal_claims,
        event_date: active.event_date || null,
        visibility: active.visibility,
        show_on_profile: active.visibility === "public" && active.show_on_profile,
      })
      .eq("id", active.id);
    if (error) toast.error(error.message);
    else toast.success("Wishlist saved");
  };

  const patchActive = (patch: Partial<Wishlist>) =>
    setLists((p) => p.map((l) => (l.id === activeId ? { ...l, ...patch } : l)));

  const deleteList = async () => {
    if (!active || !window.confirm(`Delete "${active.title}" and all its items?`)) return;
    const { error } = await supabase.from("wishlists").delete().eq("id", active.id);
    if (error) return toast.error(error.message);
    setLists((p) => p.filter((l) => l.id !== active.id));
    setActiveId(null);
  };

  const cleanItem = (it: typeof blankItem) => {
    const name = it.name.trim();
    if (!name) throw new Error("Each item needs a name");
    const url = it.url.trim() ? normalizeExternalUrl(it.url) : null;
    if (it.url.trim() && !url)
      throw new Error("The store link must be a web address like https://example.com/item");
    const image = it.image_url.trim() ? normalizeExternalUrl(it.image_url, true) : null;
    if (it.image_url.trim() && !image) throw new Error("The image link must start with https://");
    return {
      name: name.slice(0, 120),
      url,
      image_url: image,
      price_text: it.price_text.trim().slice(0, 30) || null,
      description: it.description.trim().slice(0, 500) || null,
    };
  };

  const addItem = async () => {
    if (!active || !userId) return;
    try {
      const clean = cleanItem(draft);
      const { data, error } = await supabase
        .from("wishlist_items")
        .insert({
          ...clean,
          wishlist_id: active.id,
          user_id: userId,
          display_order: (items.at(-1)?.display_order ?? -1) + 1,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      setItems((p) => [...p, data as WishlistItem]);
      setDraft(blankItem);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const saveItem = async (item: WishlistItem) => {
    try {
      const clean = cleanItem({
        name: item.name,
        url: item.url ?? "",
        image_url: item.image_url ?? "",
        price_text: item.price_text ?? "",
        description: item.description ?? "",
      });
      const { error } = await supabase.from("wishlist_items").update(clean).eq("id", item.id);
      if (error) throw new Error(error.message);
      setItems((p) => p.map((i) => (i.id === item.id ? { ...i, ...clean } : i)));
      toast.success("Item saved");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const removeItem = async (id: string) => {
    const { error } = await supabase.from("wishlist_items").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setItems((p) => p.filter((i) => i.id !== id));
  };

  const move = async (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[index], next[j]] = [next[j], next[index]];
    const renumbered = next.map((it, i) => ({ ...it, display_order: i }));
    setItems(renumbered);
    const changed = [renumbered[index], renumbered[j]];
    const results = await Promise.all(
      changed.map((it) =>
        supabase.from("wishlist_items").update({ display_order: it.display_order }).eq("id", it.id),
      ),
    );
    if (results.some((r) => r.error)) toast.error("Couldn't save the new order");
  };

  const shareUrl =
    active && username ? `${window.location.origin}/${username}/wishlist/${active.slug}` : "";

  return (
    <div className="min-h-screen px-4 py-10">
      <Toaster />
      <div className="mx-auto max-w-3xl">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="mt-6 text-3xl font-bold">Wishlists</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Make gift lists that link to any store. Lists start private; make one public to share it.
        </p>

        {myClaims.length > 0 && (
          <section className="mt-6 rounded-2xl border border-border bg-card p-5">
            <h2 className="font-semibold">Gifts you&apos;re getting</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Only you can see these. The list owner isn&apos;t told who is getting what.
            </p>
            <ul className="mt-3 divide-y divide-border">
              {myClaims.map((c) => (
                <li
                  key={c.item_id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <span>
                    <span className="font-medium">{c.item_name}</span>
                    {c.price_text && (
                      <span className="text-muted-foreground"> · {c.price_text}</span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      <Link
                        to="/$username/wishlist/$slug"
                        params={{ username: c.username, slug: c.wishlist_slug }}
                        className="underline"
                      >
                        {c.wishlist_title}
                      </Link>
                      {c.recipient_name ? ` · for ${c.recipient_name}` : ` · @${c.username}`}
                    </span>
                  </span>
                  <span className="flex gap-2">
                    {c.url && isSafeExternalUrl(c.url) && (
                      <Button variant="secondary" size="sm" asChild>
                        <a href={c.url} target="_blank" rel="noopener noreferrer nofollow">
                          {hostOf(c.url)} <ExternalLink className="ml-1 h-3.5 w-3.5" />
                        </a>
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => unclaim(c.item_id)}>
                      Let it go
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Input
            value={newTitle}
            maxLength={80}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="e.g. My birthday wishlist"
            onKeyDown={(e) => e.key === "Enter" && createList()}
          />
          <Button onClick={createList}>
            <Plus className="mr-2 h-4 w-4" /> New wishlist
          </Button>
        </div>

        {lists.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            {lists.map((l) => (
              <button
                key={l.id}
                onClick={() => setActiveId(l.id)}
                className={`rounded-full border px-3 py-1.5 text-sm ${l.id === activeId ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
              >
                {l.title}
                {l.visibility === "private" ? " · private" : ""}
              </button>
            ))}
          </div>
        )}

        {active && (
          <div
            className="mt-6 rounded-2xl border border-border bg-card p-5"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="wl-title">Title</Label>
                <Input
                  id="wl-title"
                  maxLength={80}
                  value={active.title}
                  onChange={(e) => patchActive({ title: e.target.value })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="wl-for">Who it&apos;s for (optional)</Label>
                <Input
                  id="wl-for"
                  maxLength={40}
                  placeholder="Leave blank if it's yours, or e.g. Mia"
                  value={active.recipient_name ?? ""}
                  onChange={(e) => patchActive({ recipient_name: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Making a list for your child? Put their first name here and the list shows
                  &ldquo;For Mia&rdquo;. It stays on your account.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wl-occasion">Occasion</Label>
                <Input
                  id="wl-occasion"
                  list="wl-occasions"
                  maxLength={40}
                  value={active.occasion ?? ""}
                  onChange={(e) => patchActive({ occasion: e.target.value })}
                />
                <datalist id="wl-occasions">
                  {OCCASIONS.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wl-date">Date (optional)</Label>
                <Input
                  id="wl-date"
                  type="date"
                  value={active.event_date ?? ""}
                  onChange={(e) => patchActive({ event_date: e.target.value || null })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="wl-desc">Description</Label>
                <Textarea
                  id="wl-desc"
                  rows={2}
                  maxLength={500}
                  value={active.description ?? ""}
                  onChange={(e) => patchActive({ description: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="wl-public">Public (anyone with the link can see it)</Label>
                <Switch
                  id="wl-public"
                  checked={active.visibility === "public"}
                  onCheckedChange={(v) =>
                    patchActive({
                      visibility: v ? "public" : "private",
                      show_on_profile: v ? active.show_on_profile : false,
                    })
                  }
                />
              </div>
              {claimsOn && (
                <div className="flex items-center justify-between gap-4 sm:col-span-2">
                  <Label htmlFor="wl-reveal">
                    Show me which gifts are taken
                    <span className="block text-xs font-normal text-muted-foreground">
                      Spoils the surprise. You never see who is getting what.
                    </span>
                  </Label>
                  <Switch
                    id="wl-reveal"
                    checked={!!active.reveal_claims}
                    onCheckedChange={(v) => patchActive({ reveal_claims: v })}
                  />
                </div>
              )}
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="wl-profile">Show on my profile</Label>
                <Switch
                  id="wl-profile"
                  checked={active.show_on_profile}
                  disabled={active.visibility !== "public"}
                  onCheckedChange={(v) => patchActive({ show_on_profile: v })}
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={saveList}>
                <Save className="mr-2 h-4 w-4" /> Save list
              </Button>
              {active.visibility === "public" && shareUrl && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(shareUrl);
                    toast.success("Link copied");
                  }}
                >
                  <Copy className="mr-2 h-4 w-4" /> Copy link
                </Button>
              )}
              {shareUrl && (
                <Button variant="secondary" asChild>
                  <a href={shareUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" /> Preview
                  </a>
                </Button>
              )}
              <Button variant="ghost" onClick={deleteList}>
                <Trash2 className="mr-2 h-4 w-4 text-destructive" /> Delete list
              </Button>
            </div>

            <h2 className="mt-8 font-semibold">Items</h2>
            <div className="mt-3 space-y-3">
              {items.map((item, i) => (
                <div key={item.id} className="rounded-xl border border-border p-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
                    <Input
                      value={item.name}
                      maxLength={120}
                      placeholder="Item name"
                      onChange={(e) =>
                        setItems((p) =>
                          p.map((x) => (x.id === item.id ? { ...x, name: e.target.value } : x)),
                        )
                      }
                    />
                    <Input
                      value={item.price_text ?? ""}
                      maxLength={30}
                      placeholder="Price"
                      onChange={(e) =>
                        setItems((p) =>
                          p.map((x) =>
                            x.id === item.id ? { ...x, price_text: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <Input
                      className="sm:col-span-2"
                      value={item.url ?? ""}
                      placeholder="Store link"
                      onChange={(e) =>
                        setItems((p) =>
                          p.map((x) => (x.id === item.id ? { ...x, url: e.target.value } : x)),
                        )
                      }
                    />
                    <Input
                      className="sm:col-span-2"
                      value={item.image_url ?? ""}
                      placeholder="Image link (https://…)"
                      onChange={(e) =>
                        setItems((p) =>
                          p.map((x) =>
                            x.id === item.id ? { ...x, image_url: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <Textarea
                      className="sm:col-span-2"
                      rows={2}
                      maxLength={500}
                      value={item.description ?? ""}
                      placeholder="Notes (size, color…)"
                      onChange={(e) =>
                        setItems((p) =>
                          p.map((x) =>
                            x.id === item.id ? { ...x, description: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button size="sm" onClick={() => saveItem(item)}>
                      <Save className="mr-1 h-3.5 w-3.5" /> Save
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Move up"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Move down"
                      disabled={i === items.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Delete item"
                      onClick={() => removeItem(item.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-dashed border-border p-3">
              <div className="mb-2 text-sm font-medium">Add an item</div>
              <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
                <Input
                  value={draft.name}
                  maxLength={120}
                  placeholder="Item name"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
                <Input
                  value={draft.price_text}
                  maxLength={30}
                  placeholder="Price"
                  onChange={(e) => setDraft({ ...draft, price_text: e.target.value })}
                />
                <Input
                  className="sm:col-span-2"
                  value={draft.url}
                  placeholder="Store link"
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
                <Input
                  className="sm:col-span-2"
                  value={draft.image_url}
                  placeholder="Image link (https://…)"
                  onChange={(e) => setDraft({ ...draft, image_url: e.target.value })}
                />
                <Textarea
                  className="sm:col-span-2"
                  rows={2}
                  maxLength={500}
                  value={draft.description}
                  placeholder="Notes (size, color…)"
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              <Button className="mt-2" onClick={addItem}>
                <Plus className="mr-2 h-4 w-4" /> Add item
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
