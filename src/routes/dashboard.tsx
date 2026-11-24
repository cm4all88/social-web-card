import { MessagesNavButton } from "@/components/messages/MessagesNavButton";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { usernameError, normalizeUsername, USERNAME_HELP } from "@/lib/username";
import {
  bioLength,
  limitBio,
  MAX_EXTRA_AVATARS,
  PROFILE_BIO_LIMIT,
} from "@/lib/profile-presentation";
import { getTheme, type ThemeTokens } from "@/lib/themes";
import { ShareSheet } from "@/components/share/ShareSheet";
import { recordShare } from "@/lib/share/track";
import {
  LogOut,
  ArrowLeft,
  Save,
  Copy,
  ExternalLink,
  Upload,
  X,
  Eye,
  MessageCircle,
  Share2,
  PartyPopper,
} from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { TipsManager } from "@/components/tipping/TipsManager";
import { getTippingAvailability } from "@/lib/tipping/functions";
import { BetaPanel } from "@/components/beta/BetaPanel";
import { PlusPanel, useMyPlus } from "@/components/plus/PlusPanel";
import { DeleteAccount } from "@/components/account/DeleteAccount";
import { EmailPreferences } from "@/components/account/EmailPreferences";
import { ChangePassword } from "@/components/account/ChangePassword";
import { MyAnalytics } from "@/components/analytics/MyAnalytics";
import { AnalyticsSummary } from "@/components/analytics/AnalyticsSummary";
import { useThemeRewards } from "@/components/rewards/ThemeRewards";
import { Gift, Shield } from "lucide-react";
import {
  DashboardAnnouncements,
  NotificationBell,
} from "@/components/notifications/DashboardNotices";
import { LinkManager } from "@/components/dashboard/LinkManager";
import { AppearanceSection } from "@/components/dashboard/AppearanceSection";
import { CreatorEarningsSection } from "@/components/dashboard/CreatorEarningsSection";
import { loadMyCreatorEarnings, type CreatorEarnings } from "@/lib/creator/earnings";
import { CreatorSubscriptionsSection } from "@/components/dashboard/CreatorSubscriptionsSection";
import { SupportOfferingsSection } from "@/components/dashboard/SupportOfferingsSection";
import { loadMySupportOfferings, type MySupportOfferings } from "@/lib/support/offerings";
import {
  loadMyCreatorSubscriptions,
  type MyCreatorSubscriptions,
} from "@/lib/creator/subscriptions";
import { markCreatorPresence } from "@/lib/analytics/functions";
import { PagePreview } from "@/components/dashboard/PagePreview";
import { loadLinkClicks, loadSections, type LinkClicks, type ManagedLink } from "@/lib/links/api";
import type { LinkSection } from "@/lib/links/groups";
import { dm } from "@/lib/messages/api";
import { tabForHash, DASHBOARD_TABS, type TabId } from "@/lib/links/tabs";

/** Creator dashboard: every signed-in user manages their own page here. Links come first. */
export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
  head: () => ({
    meta: [{ title: "Your dashboard — Yooits.me" }, { name: "robots", content: "noindex" }],
  }),
});

const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

type Profile = {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  avatar_gallery?: string[] | null;
  avatar_size?: number;
  skin_intensity?: string;
  bio_alignment?: string;
  theme: string | null;
  custom_theme: Partial<ThemeTokens> | null;
  hide_branding?: boolean | null;
  created_at?: string | null;
  skin?: string | null;
  background_url?: string | null;
};

const card = "rounded-2xl border border-border bg-card p-5";
const cardStyle = { boxShadow: "var(--shadow-card)" };

function DashboardPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [restriction, setRestriction] = useState<"suspended" | "unpublished" | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // The username as saved, so an unchanged name isn't re-checked: the official
  // account keeps a protected name the owner assigned.
  const [savedUsername, setSavedUsername] = useState<string | null>(null);
  const [savingPresentation, setSavingPresentation] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [links, setLinks] = useState<ManagedLink[]>([]);
  const [sections, setSections] = useState<LinkSection[]>([]);
  const [clicks, setClicks] = useState<LinkClicks>({ enabled: false, byLink: {} });
  const [tab, setTabState] = useState<TabId>("links");
  const [showPreview, setShowPreview] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // "Your page is live" prompt: until they share once or close it (this browser).
  const [sharePrompt, setSharePrompt] = useState(false);
  const [messagesOn, setMessagesOn] = useState(false);
  const { plus, reload: reloadPlus } = useMyPlus();
  const isPlus = plus?.plan === "plus";
  const rewards = useThemeRewards();
  // Support (tips) only makes sense while tipping is switched on.
  const [tippingOn, setTippingOn] = useState(false);
  // Creator tab: shown to admins now, everyone once the owner turns it on.
  const [creator, setCreator] = useState<CreatorEarnings>({ visible: false });
  const [creatorSubs, setCreatorSubs] = useState<MyCreatorSubscriptions>({ visible: false });
  const reloadCreatorSubs = useCallback(() => {
    loadMyCreatorSubscriptions()
      .then(setCreatorSubs)
      .catch(() => setCreatorSubs({ visible: false }));
  }, []);
  const [supportOfferings, setSupportOfferings] = useState<MySupportOfferings>({ visible: false });
  const reloadSupportOfferings = useCallback(() => {
    loadMySupportOfferings()
      .then(setSupportOfferings)
      .catch(() => setSupportOfferings({ visible: false }));
  }, []);

  useEffect(() => {
    getTippingAvailability()
      .then((r) => setTippingOn(r.enabled))
      .catch(() => setTippingOn(false));
    loadMyCreatorEarnings()
      .then(setCreator)
      .catch(() => setCreator({ visible: false }));
    reloadCreatorSubs();
    reloadSupportOfferings();
    // So a signed-out look at your own page from this browser isn't counted as a visitor.
    void markCreatorPresence().catch(() => {});
    dm("dm_my_settings", {}).then(
      (s) => setMessagesOn(!!s.available),
      () => setMessagesOn(false),
    );
  }, [reloadCreatorSubs, reloadSupportOfferings]);

  const tabs = DASHBOARD_TABS.filter(
    (t) =>
      (t.id !== "support" || tippingOn) &&
      (t.id !== "messages" || messagesOn) &&
      (t.id !== "creator" || creator.visible || creatorSubs.visible || supportOfferings.visible),
  );

  const setTab = useCallback((id: TabId) => {
    setTabState(id);
    if (typeof window === "undefined") return;
    window.history.replaceState(null, "", id === "links" ? window.location.pathname : `#${id}`);
    const nav = document.getElementById("dashboard-tabs");
    if (nav && nav.getBoundingClientRect().top < 0) nav.scrollIntoView({ block: "start" });
  }, []);

  // Open the tab named in the address (#appearance, #plus, ...), now and when it changes.
  useEffect(() => {
    const fromHash = () => {
      const t = tabForHash(window.location.hash);
      if (t) setTabState(t);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  // After the Plus panel mounts, Stripe's return to #plus scrolls to it.
  useEffect(() => {
    if (!ready || tab !== "appearance" || window.location.hash !== "#plus") return;
    const id = window.setTimeout(
      () => document.getElementById("plus")?.scrollIntoView({ behavior: "smooth" }),
      300,
    );
    return () => window.clearTimeout(id);
  }, [ready, tab]);

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate({ to: "/auth" });
        return;
      }
      const uid = data.session.user.id;
      setUserId(uid);

      const [{ data: prof }, { data: roles }, { data: l }, secs] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", uid).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase
          .from("social_links")
          .select("*")
          .eq("user_id", uid)
          .order("display_order", { ascending: true }),
        loadSections(uid),
      ]);

      setProfile(prof as Profile | null);
      setSavedUsername((prof as Profile | null)?.username ?? null);
      const admin = (roles ?? []).some((r: { role: string }) => r.role === "admin");
      setIsAdmin(admin);
      setLinks(
        ((l ?? []) as Partial<ManagedLink>[]).map((x) => ({
          ...(x as ManagedLink),
          title: x.title ?? null,
          icon: x.icon ?? null,
          featured: !!x.featured,
          section_id: x.section_id ?? null,
        })),
      );
      setSections(secs);
      loadLinkClicks().then(setClicks);

      // Set by Yooits.me admins from the owner console; readable only by this user.
      // (Not in the generated types yet; called as a method so the client keeps its `this`.)
      const { data: st } = await (
        supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> }
      )
        .from("account_status")
        .select("unpublished_at, suspended_at")
        .eq("user_id", uid)
        .maybeSingle();
      const status = st as { unpublished_at: string | null; suspended_at: string | null } | null;
      setRestriction(
        status?.suspended_at ? "suspended" : status?.unpublished_at ? "unpublished" : null,
      );
      setReady(true);
    };
    init();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) navigate({ to: "/auth" });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  // The live schema is applied separately from Vercel's app deployment.
  const presentationReady = typeof profile?.avatar_size === "number";
  const bioLimit = presentationReady ? PROFILE_BIO_LIMIT : 300;

  const savePresentation = async (
    settings: { avatar_size: number } | { bio_alignment: string } | { skin_intensity: string },
  ) => {
    if (!profile) return;
    setSavingPresentation(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update(settings)
        .eq("user_id", profile.user_id);
      if (error) toast.error(error.message);
      else setProfile((current) => (current ? { ...current, ...settings } : current));
    } finally {
      setSavingPresentation(false);
    }
  };

  const saveProfile = async () => {
    if (!profile) return;
    const username = normalizeUsername(profile.username ?? "");
    const changed = username !== savedUsername;
    const problem = changed ? usernameError(username) : null;
    if (problem) {
      toast.error(problem);
      return;
    }
    if (bioLength(profile.bio ?? "") > bioLimit) {
      toast.error(`Bio must be at most ${bioLimit} characters`);
      return;
    }
    setSavingProfile(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        ...(changed ? { username } : {}),
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
    setProfile((current) => (current ? { ...current, username } : current));
    setSavedUsername(username);
    toast.success("Profile saved");
    rewards.refresh();
  };

  const saveAvatarGallery = async (previous: string[], next: string[]) => {
    if (!userId) throw new Error("Sign in to update your photos.");
    const { data, error } = await supabase
      .from("profiles")
      .update({ avatar_gallery: next })
      .eq("user_id", userId)
      .filter("avatar_gallery", "eq", `{${previous.join(",")}}`)
      .select("avatar_gallery")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("The photo carousel changed. Refresh the page and try again.");
    setProfile((current) =>
      current ? { ...current, avatar_gallery: data.avatar_gallery } : current,
    );
  };

  const uploadAvatar = async (file: File, forGallery = false) => {
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
    const ext =
      { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[
        file.type
      ] ?? "jpg";
    const path = `${userId}/avatar-${crypto.randomUUID()}.${ext}`;
    const bucket = supabase.storage.from("avatars");
    const photos = profile.avatar_gallery ?? [];
    try {
      if (forGallery && photos.length >= MAX_EXTRA_AVATARS)
        throw new Error("Your photo carousel is full.");
      const { error: uploadError } = await bucket.upload(path, file, {
        cacheControl: "3600",
        contentType: file.type,
      });
      if (uploadError) throw new Error(uploadError.message);
      const url = bucket.getPublicUrl(path).data.publicUrl;
      if (forGallery) {
        await saveAvatarGallery(photos, [...photos, url]);
      } else {
        const { error } = await supabase
          .from("profiles")
          .update({ avatar_url: url })
          .eq("user_id", userId);
        if (error) throw new Error(error.message);
        setProfile((current) => (current ? { ...current, avatar_url: url } : current));
        rewards.refresh();
      }
      toast.success(forGallery ? "Photo added to the carousel" : "Profile picture updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload the photo.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const removeGalleryPhoto = async (url: string) => {
    const photos = profile?.avatar_gallery ?? [];
    setUploadingAvatar(true);
    try {
      await saveAvatarGallery(
        photos,
        photos.filter((photo) => photo !== url),
      );
      toast.success("Photo removed from the carousel");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the photo.");
    } finally {
      setUploadingAvatar(false);
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
      setProfile((current) => (current ? { ...current, avatar_url: null } : current));
      toast.success("Profile picture removed");
    }
  };

  const shareKey = userId ? `yooits_shared_${userId}` : null;
  const markShared = () => {
    setSharePrompt(false);
    try {
      if (shareKey) window.localStorage.setItem(shareKey, "1");
    } catch {
      /* storage blocked: the prompt just shows again next time */
    }
  };
  const onShared = () => {
    rewards.recordShare();
    markShared();
  };

  const copyShareLink = async () => {
    if (!profile) return;
    const url = `${window.location.origin}/${profile.username}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied!");
      recordShare(profile.username, "copy");
      onShared();
    } catch {
      toast.error("Couldn't copy. Open Share to copy it another way.");
    }
  };

  // A published page (has at least one link) that hasn't been shared yet gets the prompt.
  const livePage =
    !!profile && !restriction && links.some((l) => l.enabled && l.url.trim().length > 0);
  useEffect(() => {
    if (!livePage || !shareKey) return;
    try {
      setSharePrompt(window.localStorage.getItem(shareKey) !== "1");
    } catch {
      setSharePrompt(true);
    }
  }, [livePage, shareKey]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  const activeTab = tabs.some((t) => t.id === tab) ? tab : "links";

  return (
    <div className="min-h-screen px-4 py-6 sm:py-10">
      <Toaster />
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Home</span>
          </Link>
          <img src="/yooits-logo.png" alt="yooits.me" className="h-9 w-auto" />
          <div className="flex items-center gap-1">
            <MessagesNavButton />
            <NotificationBell />
            {isAdmin && (
              <Button variant="ghost" size="sm" asChild>
                <Link to="/owner">
                  <Shield className="mr-2 h-4 w-4" />{" "}
                  <span className="hidden sm:inline">Owner console</span>
                  <span className="sm:hidden">Owner</span>
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={signOut} aria-label="Sign out">
              <LogOut className="h-4 w-4 sm:mr-2" />{" "}
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>

        <h1 className="sr-only">Your dashboard</h1>

        <DashboardAnnouncements />

        {profile && (
          <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
            <div
              className="rounded-2xl border border-primary/30 p-5"
              style={{ background: "var(--gradient-hero)", boxShadow: "var(--shadow-glow)" }}
            >
              <div className="text-xs font-semibold uppercase tracking-wider text-primary-foreground/80">
                Your shareable link
              </div>
              <div className="mt-1 break-all text-xl font-bold text-primary-foreground sm:text-2xl">
                {`${typeof window !== "undefined" ? window.location.host : "yooits.me"}/${profile.username}`}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="bg-white text-black hover:bg-white/90"
                  onClick={() => setShareOpen(true)}
                >
                  <Share2 className="mr-2 h-4 w-4" /> Share
                </Button>
                <Button size="sm" variant="secondary" onClick={copyShareLink}>
                  <Copy className="mr-2 h-4 w-4" /> Copy link
                </Button>
                <Button size="sm" variant="secondary" asChild>
                  <a href={`/${profile.username}`} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" /> Open my page
                  </a>
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="sm:hidden"
                  aria-expanded={showPreview}
                  onClick={() => setShowPreview((v) => !v)}
                >
                  <Eye className="mr-2 h-4 w-4" /> {showPreview ? "Hide preview" : "Preview"}
                </Button>
              </div>
            </div>
            <div className={showPreview ? "mx-auto w-44" : "hidden sm:block"}>
              <PagePreview
                profile={profile}
                links={links}
                sections={sections}
                isPlus={isPlus}
                rewards={rewards.unlocked}
              />
            </div>
          </div>
        )}

        {profile && (
          <ShareSheet
            open={shareOpen}
            onOpenChange={setShareOpen}
            username={profile.username}
            name={profile.display_name || profile.username}
            bio={profile.bio}
            avatarUrl={profile.avatar_url}
            theme={getTheme(profile.theme, profile.custom_theme, { plus: isPlus, unlocked: true })}
            links={links.filter((l) => l.enabled && l.url.trim().length > 0)}
            showBranding={!(isPlus && profile.hide_branding)}
            own
            onShared={onShared}
          />
        )}

        {profile && livePage && sharePrompt && (
          <div
            role="status"
            className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/40 bg-primary/10 p-4"
          >
            <PartyPopper className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-semibold">Your page is live.</div>
              <div className="text-muted-foreground">
                Share it so people can find you: your bio, your story, or a text to friends.
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setShareOpen(true)}>
                <Share2 className="mr-2 h-4 w-4" /> Share my page
              </Button>
              <Button size="sm" variant="ghost" onClick={markShared} aria-label="Not now">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {restriction && (
          <div
            role="status"
            className="mt-6 rounded-2xl border border-destructive/50 bg-destructive/10 p-4 text-sm"
          >
            {restriction === "suspended"
              ? "Your account is suspended by Yooits.me. Your page is hidden and changes are turned off. Your information hasn't been deleted."
              : "Your page is unpublished by Yooits.me, so visitors can't see it right now. You can still edit it, and nothing has been deleted."}
          </div>
        )}

        {/* Sections: scrolls sideways on small screens, sticks while you scroll */}
        <nav
          id="dashboard-tabs"
          aria-label="Dashboard sections"
          className="sticky top-0 z-20 -mx-4 mt-6 bg-background/90 px-4 py-3 backdrop-blur"
        >
          <div role="tablist" className="flex gap-2 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={activeTab === t.id}
                aria-controls={`panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition ${
                  activeTab === t.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </nav>

        <div
          role="tabpanel"
          id={`panel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
          className="mt-2"
        >
          {activeTab === "links" && userId && (
            <div id="links">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-xl font-bold">My links</h2>
                <span className="text-xs text-muted-foreground">
                  {links.length} {links.length === 1 ? "link" : "links"}
                </span>
              </div>
              <AnalyticsSummary onOpen={() => setTab("analytics")} />
              <div className="mt-4">
                <LinkManager
                  userId={userId}
                  links={links}
                  setLinks={setLinks}
                  sections={sections}
                  setSections={setSections}
                  clicks={clicks}
                  onChanged={() => rewards.refresh()}
                />
              </div>
            </div>
          )}

          {activeTab === "appearance" && profile && userId && (
            <div id="appearance" className="space-y-6">
              <h2 className="text-xl font-bold">Appearance</h2>
              <PlusPanel
                plus={plus}
                reload={reloadPlus}
                userId={userId}
                hideBranding={!!profile.hide_branding}
                onHideBrandingChange={(v) =>
                  setProfile((p) => (p ? { ...p, hide_branding: v } : p))
                }
              />
              {presentationReady && (
                <div className={card}>
                  <div className="flex flex-wrap gap-4">
                    <label className="grid gap-1 text-sm font-medium">
                      Avatar size
                      <select
                        className="rounded-md border bg-background p-2"
                        value={profile.avatar_size ?? 144}
                        disabled={savingPresentation}
                        onChange={(event) =>
                          void savePresentation({ avatar_size: Number(event.target.value) })
                        }
                      >
                        <option value={112}>Small · 112 px</option>
                        <option value={144}>Medium · 144 px</option>
                        <option value={176}>Large · 176 px</option>
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm font-medium">
                      Bio alignment
                      <select
                        className="rounded-md border bg-background p-2"
                        value={profile.bio_alignment ?? "center"}
                        disabled={savingPresentation}
                        onChange={(event) =>
                          void savePresentation({ bio_alignment: event.target.value })
                        }
                      >
                        <option value="center">Center</option>
                        <option value="left">Left</option>
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm font-medium">
                      Animation intensity
                      <select
                        className="rounded-md border bg-background p-2"
                        value={profile.skin_intensity ?? "standard"}
                        disabled={savingPresentation}
                        onChange={(event) =>
                          void savePresentation({ skin_intensity: event.target.value })
                        }
                      >
                        <option value="subtle">Subtle</option>
                        <option value="standard">Standard</option>
                        <option value="full">Full</option>
                      </select>
                    </label>
                  </div>
                </div>
              )}
              <AppearanceSection
                profile={profile}
                setProfile={
                  setProfile as (next: Profile | ((p: Profile | null) => Profile | null)) => void
                }
                isPlus={isPlus}
                plus={plus}
                rewards={rewards}
                links={links}
              />
            </div>
          )}

          {activeTab === "analytics" && (
            <div id="analytics-tab">
              <h2 className="text-xl font-bold">Analytics</h2>
              <MyAnalytics />
              {!clicks.enabled && (
                <p className="mt-4 text-sm text-muted-foreground">
                  Stats show here once analytics is switched on for Yooits.me.
                </p>
              )}
            </div>
          )}

          {activeTab === "creator" &&
            (creator.visible || creatorSubs.visible || supportOfferings.visible) && (
              <div id="creator">
                <h2 className="text-xl font-bold">Creator earnings</h2>
                <CreatorEarningsSection data={creator} />
                <CreatorSubscriptionsSection
                  data={creatorSubs}
                  userId={userId}
                  onChanged={reloadCreatorSubs}
                />
                <SupportOfferingsSection
                  data={supportOfferings}
                  userId={userId}
                  onChanged={reloadSupportOfferings}
                />
              </div>
            )}

          {activeTab === "profile" && profile && (
            <div id="profile">
              <h2 className="mb-4 text-xl font-bold">Profile</h2>
              <div
                className="rounded-2xl border border-border bg-card p-5"
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                <div className="mb-4 font-semibold">Profile</div>

                <div className="mb-6 flex items-center gap-4">
                  <Avatar className="h-20 w-20 shrink-0 border-2 border-border">
                    <AvatarImage
                      src={profile.avatar_url ?? undefined}
                      alt={profile.username}
                      className="object-cover"
                    />
                    <AvatarFallback className="text-2xl font-semibold">
                      {(profile.display_name || profile.username).slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="secondary" disabled={uploadingAvatar}>
                      <label className="cursor-pointer">
                        <Upload className="mr-2 h-4 w-4" />
                        {uploadingAvatar
                          ? "Uploading…"
                          : profile.avatar_url
                            ? "Change photo"
                            : "Upload photo"}
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
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={uploadingAvatar}
                        onClick={removeAvatar}
                      >
                        <X className="mr-2 h-4 w-4" /> Remove
                      </Button>
                    )}
                  </div>
                </div>

                {profile.avatar_gallery && (
                  <fieldset className="mb-6 space-y-3 border-t pt-4" disabled={uploadingAvatar}>
                    <p className="font-semibold">Avatar carousel</p>
                    <p className="text-sm text-muted-foreground">
                      Add up to three public photos after your main photo.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {profile.avatar_gallery.map((url, index) => (
                        <div className="relative" key={url}>
                          <img
                            src={url}
                            alt={`Carousel photo ${index + 1}`}
                            className="size-14 rounded-full border object-cover"
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="icon"
                            className="absolute -right-1 -top-1 size-6 rounded-full"
                            aria-label={`Remove carousel photo ${index + 1}`}
                            onClick={() => void removeGalleryPhoto(url)}
                          >
                            <X className="size-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    {profile.avatar_gallery.length < MAX_EXTRA_AVATARS && (
                      <label className="inline-grid gap-1 text-sm">
                        Add carousel photo
                        <Input
                          type="file"
                          accept={AVATAR_TYPES.join(",")}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            if (file) void uploadAvatar(file, true);
                          }}
                        />
                      </label>
                    )}
                  </fieldset>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      value={profile.username}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          username: e.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9_-]/g, "")
                            .slice(0, 30),
                        })
                      }
                      placeholder="yourname"
                      maxLength={30}
                    />
                    <p className="text-xs text-muted-foreground">{USERNAME_HELP}</p>
                    <p className="text-xs text-muted-foreground">
                      yooits.me/
                      <span className="font-medium text-foreground">
                        {profile.username || "yourname"}
                      </span>
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
                    onChange={(e) =>
                      setProfile({ ...profile, bio: limitBio(e.target.value, bioLimit) })
                    }
                    placeholder="Tell visitors a little about you"
                    rows={2}
                  />
                  <p className="text-right text-xs text-muted-foreground">
                    {bioLength(profile.bio ?? "")}/{bioLimit}
                  </p>
                </div>
                <div className="mt-4">
                  <Button onClick={saveProfile} disabled={savingProfile}>
                    <Save className="mr-2 h-4 w-4" />
                    {savingProfile ? "Saving" : "Save profile"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "wishlists" && profile && (
            <div id="wishlists">
              <h2 className="mb-4 text-xl font-bold">Wishlists</h2>
              <div
                className={`${card} flex flex-wrap items-center justify-between gap-3`}
                style={cardStyle}
              >
                <p className="text-sm text-muted-foreground">
                  Share gift lists for birthdays, holidays and big days.
                </p>
                <Button variant="secondary" asChild>
                  <Link to="/dashboard/wishlists">
                    <Gift className="mr-2 h-4 w-4" /> Manage wishlists
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {activeTab === "messages" && (
            <div id="messages">
              <h2 className="mb-4 text-xl font-bold">Messages</h2>
              <div
                className={`${card} flex flex-wrap items-center justify-between gap-3`}
                style={cardStyle}
              >
                <p className="text-sm text-muted-foreground">
                  Read and answer messages, accept requests, and choose who can message you.
                </p>
                <Button variant="secondary" asChild>
                  <Link to="/messages">
                    <MessageCircle className="mr-2 h-4 w-4" /> Open messages
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {activeTab === "support" && profile && userId && (
            <div id="support">
              <h2 className="mb-4 text-xl font-bold">Support</h2>
              <TipsManager userId={userId} username={profile.username} />
            </div>
          )}

          {activeTab === "account" && (
            <div id="account">
              <h2 className="text-xl font-bold">Account</h2>
              {userId && <BetaPanel userId={userId} />}
              <div className="mt-4 space-y-4">
                <ChangePassword />
                <EmailPreferences />
                {profile && <DeleteAccount username={profile.username} />}
                <Button variant="ghost" onClick={signOut}>
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
