import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { rpc } from "@/components/marketing/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { loadSiteSettings, SOCIAL_PLATFORMS, type SocialPlatform } from "@/lib/site/settings";

/**
 * Owner > Settings: what the site says about itself, Yooits' own social
 * accounts, email defaults and the feature switches that live in the database.
 * Payment switches and secrets live in Vercel and are only described here.
 */
export const Route = createFileRoute("/owner/settings")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Settings — Yooits" }, { name: "robots", content: "noindex" }] }),
});

type Site = {
  site_name: string;
  tagline: string;
  support_email: string;
  theme_color: string | null;
  socials: Partial<Record<SocialPlatform, string>>;
  updated_at: string;
};
type Flag = { key: string; enabled: boolean; note?: string | null; updated_at: string };
type Email = {
  admin_email: string;
  sending_enabled: boolean;
  account_enabled: boolean;
  security_enabled: boolean;
  billing_enabled: boolean;
  messages_enabled: boolean;
  activity_enabled: boolean;
  admin_enabled: boolean;
  marketing_enabled: boolean;
  daily_optional_limit: number;
};
type State = {
  site: Site;
  feature_flags: Flag[];
  app_flags: Flag[];
  email: Email;
  wishlist_claims: { enabled: boolean; max_claims_per_list: number } | null;
};

const FLAG_LABELS: Record<string, { label: string; note: string }> = {
  dashboard_notifications: {
    label: "Dashboard notifications",
    note: "The bell and notices on people's dashboards. Announcements go out through it.",
  },
  themes_rewards: { label: "Seasonal themes and rewards", note: "Seasonal themes and earned theme unlocks." },
  skins: { label: "Animated effects", note: "Snow, leaves, hearts and stars on profile pages." },
  backgrounds: { label: "Custom backgrounds", note: "The popular-page reward, and Plus." },
};

const EMAIL_CATEGORIES: { key: keyof Email; label: string; note: string }[] = [
  { key: "account_enabled", label: "Account", note: "Welcome and account changes." },
  { key: "security_enabled", label: "Security", note: "Password resets and sign-in notices." },
  { key: "billing_enabled", label: "Billing", note: "Receipts, Plus and Founding Member notes." },
  { key: "messages_enabled", label: "Messages", note: "New direct message notices." },
  { key: "activity_enabled", label: "Activity", note: "Milestones and wishlist activity." },
  { key: "admin_enabled", label: "Owner alerts", note: "Reports and alerts sent to the owner address." },
];

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc<T>(fn, args);
  if (error) throw new Error(/^Not authorized/.test(error.message) ? "Only Yooits admins can do this." : error.message);
  return data;
}

function Section({ title, note, children }: { title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-8 rounded-2xl border border-border bg-card p-5">
      <h2 className="text-lg font-bold">{title}</h2>
      {note && <p className="mt-1 text-sm text-muted-foreground">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SwitchRow({
  label,
  note,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  note?: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-border py-3 first:border-t-0 first:pt-0">
      <div>
        <div className="font-medium">{label}</div>
        {note && <div className="text-xs text-muted-foreground">{note}</div>}
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

function SettingsPage() {
  const [state, setState] = useState<State | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [limit, setLimit] = useState("");
  const [claimMax, setClaimMax] = useState("");

  const load = useCallback(async () => {
    try {
      const s = await call<State>("owner_site_settings");
      setState(s);
      setSite(s.site);
      setAdminEmail(s.email.admin_email);
      setLimit(String(s.email.daily_optional_limit));
      setClaimMax(String(s.wishlist_claims?.max_claims_per_list ?? ""));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (!state || !site) return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;

  const saveSite = async () => {
    setSaving(true);
    try {
      await call("owner_save_site_settings", {
        _s: {
          site_name: site.site_name,
          tagline: site.tagline,
          support_email: site.support_email,
          theme_color: site.theme_color ?? "",
          socials: site.socials,
        },
      });
      await loadSiteSettings(true);
      toast.success("Site settings saved. They show on the site straight away.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const setFlag = async (kind: "feature" | "app", key: string, on: boolean) => {
    setBusyKey(`${kind}:${key}`);
    try {
      await call(kind === "feature" ? "owner_set_feature_flag" : "owner_set_app_flag", { _key: key, _enabled: on });
      toast.success(`${FLAG_LABELS[key]?.label ?? key} ${on ? "on" : "off"}`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  };

  const setEmail = async (key: string, value: string, what: string) => {
    setBusyKey(`email:${key}`);
    try {
      await call("owner_email_set_setting", { _key: key, _value: value });
      toast.success(`${what} saved`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  };

  const saveClaims = async (enabled: boolean, max: number) => {
    setBusyKey("claims");
    try {
      await call("owner_set_wishlist_claim_settings", { _enabled: enabled, _max_claims_per_list: max });
      toast.success("Wishlist claiming saved");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  };

  const dirty = JSON.stringify(site) !== JSON.stringify(state.site);
  const flags = [
    ...state.feature_flags.map((f) => ({ ...f, kind: "feature" as const })),
    ...state.app_flags.map((f) => ({ ...f, kind: "app" as const })),
  ];

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-bold">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Changes here take effect on yooits.me straight away and are recorded in the{" "}
        <Link to="/owner/audit" className="text-primary hover:underline">
          audit log
        </Link>
        .
      </p>

      <Section title="Site and branding" note="Shown on the home page, the sign-in page and the footer of every legal page.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="s-name">Site name</Label>
            <Input id="s-name" maxLength={40} value={site.site_name} onChange={(e) => setSite({ ...site, site_name: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="s-email">Contact email</Label>
            <Input
              id="s-email"
              type="email"
              maxLength={120}
              value={site.support_email}
              onChange={(e) => setSite({ ...site, support_email: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="s-tag">Tagline (home page)</Label>
            <Input id="s-tag" maxLength={80} value={site.tagline} onChange={(e) => setSite({ ...site, tagline: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="s-color">Browser bar colour (phones)</Label>
            <div className="flex items-center gap-2">
              <input
                id="s-color"
                type="color"
                className="h-10 w-12 cursor-pointer rounded border border-input bg-background"
                value={site.theme_color ?? "#a855f7"}
                onChange={(e) => setSite({ ...site, theme_color: e.target.value })}
              />
              <span className="font-mono text-xs">{site.theme_color ?? "Not set"}</span>
              {site.theme_color && (
                <Button size="sm" variant="ghost" onClick={() => setSite({ ...site, theme_color: null })}>
                  Clear
                </Button>
              )}
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          The logo and the page colours are part of the site's design and stay as they are. The legal operator,
          Tahoma Industries LLC, is fixed in the legal pages.
        </p>
      </Section>

      <Section title="Yooits social accounts" note="Links to Yooits' own accounts, shown in the site footer. Leave one blank to hide it.">
        <div className="grid gap-3 sm:grid-cols-2">
          {SOCIAL_PLATFORMS.map((p) => (
            <div key={p.id}>
              <Label htmlFor={`so-${p.id}`}>{p.label}</Label>
              <Input
                id={`so-${p.id}`}
                placeholder={p.example}
                maxLength={200}
                value={site.socials[p.id] ?? ""}
                onChange={(e) => setSite({ ...site, socials: { ...site.socials, [p.id]: e.target.value } })}
              />
            </div>
          ))}
        </div>
      </Section>

      <div className="sticky bottom-4 mt-4 flex justify-end">
        <Button onClick={saveSite} disabled={!dirty || saving} className="shadow-lg">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save site and social links
        </Button>
      </div>

      <Section
        title="Email"
        note={
          <>
            Sending runs through the existing email service; nothing here changes how it's set up. Templates,
            test sends and delivery are on the{" "}
            <Link to="/owner/email" className="text-primary hover:underline">
              Email
            </Link>{" "}
            page.
          </>
        }
      >
        <SwitchRow
          label="Send email"
          note="The main switch. Off pauses every email the site sends."
          checked={state.email.sending_enabled}
          disabled={busyKey === "email:sending_enabled"}
          onChange={(v) => setEmail("sending_enabled", String(v), "Sending")}
        />
        {EMAIL_CATEGORIES.map((c) => (
          <SwitchRow
            key={c.key}
            label={c.label}
            note={c.note}
            checked={!!state.email[c.key]}
            disabled={busyKey === `email:${c.key}`}
            onChange={(v) => setEmail(c.key, String(v), c.label)}
          />
        ))}
        <SwitchRow
          label="Marketing email"
          note="Stays off until a postal address is added to marketing email, as the law requires."
          checked={state.email.marketing_enabled}
          disabled={!state.email.marketing_enabled}
          onChange={(v) => setEmail("marketing_enabled", String(v), "Marketing email")}
        />
        <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="e-admin">Owner alerts go to</Label>
            <div className="flex gap-2">
              <Input id="e-admin" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
              <Button
                variant="outline"
                disabled={adminEmail.trim().toLowerCase() === state.email.admin_email || busyKey === "email:admin_email"}
                onClick={() => setEmail("admin_email", adminEmail, "Owner address")}
              >
                Save
              </Button>
            </div>
          </div>
          <div>
            <Label htmlFor="e-limit">Optional emails per day, at most</Label>
            <div className="flex gap-2">
              <Input id="e-limit" type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)} />
              <Button
                variant="outline"
                disabled={limit === String(state.email.daily_optional_limit) || busyKey === "email:daily_optional_limit"}
                onClick={() => setEmail("daily_optional_limit", String(Number(limit) || 0), "Daily limit")}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Features" note="Switch site features on or off without a deploy.">
        {flags.map((f) => (
          <SwitchRow
            key={`${f.kind}:${f.key}`}
            label={FLAG_LABELS[f.key]?.label ?? f.key}
            note={FLAG_LABELS[f.key]?.note ?? f.note ?? undefined}
            checked={f.enabled}
            disabled={busyKey === `${f.kind}:${f.key}`}
            onChange={(v) => setFlag(f.kind, f.key, v)}
          />
        ))}
        {state.wishlist_claims && (
          <div className="border-t border-border pt-3">
            <SwitchRow
              label="Wishlist claiming"
              note="Visitors can mark a wishlist item as being bought, so nobody doubles up."
              checked={state.wishlist_claims.enabled}
              disabled={busyKey === "claims"}
              onChange={(v) => saveClaims(v, state.wishlist_claims!.max_claims_per_list)}
            />
            <div className="flex items-end gap-2">
              <div>
                <Label htmlFor="w-max">Claims one visitor can make per list</Label>
                <Input id="w-max" type="number" min={1} className="w-32" value={claimMax} onChange={(e) => setClaimMax(e.target.value)} />
              </div>
              <Button
                variant="outline"
                disabled={claimMax === String(state.wishlist_claims.max_claims_per_list) || busyKey === "claims"}
                onClick={() => saveClaims(state.wishlist_claims!.enabled, Number(claimMax) || 1)}
              >
                Save
              </Button>
            </div>
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Direct messages have their own switch on{" "}
          <Link to="/owner/messaging" className="text-primary hover:underline">
            Messages
          </Link>
          .
        </p>
      </Section>

      <Section
        title="Payments"
        note={
          <>
            Payment switches and Stripe keys are kept in the hosting settings, not here, so nobody can turn on
            charging from a browser. Their current state is on the{" "}
            <Link to="/owner/payments" className="text-primary hover:underline">
              Payments
            </Link>{" "}
            page.
          </>
        }
      >
        <ul className="space-y-1 text-sm">
          <li>Plus checkout: owner account only. Everyone else waits for your go-ahead.</li>
          <li>Pro, tips, creator subscriptions, Support Offerings and wishlist gift money: off.</li>
          <li>Free Plus from Founding Member and promotion codes: on, no card involved.</li>
        </ul>
      </Section>
    </div>
  );
}
