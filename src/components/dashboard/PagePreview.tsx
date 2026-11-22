/** A small live preview of the public page, drawn from what's on the dashboard right now. */
import { Star } from "lucide-react";
import { buttonRadiusFor, fontFamilyFor, getTheme, type ThemeTokens } from "@/lib/themes";
import { linkDisplay } from "@/lib/platforms";
import { groupLinks, type LinkSection } from "@/lib/links/groups";
import type { ManagedLink } from "@/lib/links/api";

const MAX_ROWS = 6;

export function PagePreview({
  profile,
  links,
  sections,
  isPlus,
}: {
  profile: {
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    theme: string | null;
    custom_theme: Partial<ThemeTokens> | null;
  };
  links: ManagedLink[];
  sections: LinkSection[];
  isPlus: boolean;
}) {
  // Reward themes are checked on the server; the preview just shows the chosen look.
  const theme = getTheme(profile.theme, profile.custom_theme, { plus: isPlus, unlocked: true });
  const radius = buttonRadiusFor(theme.buttonStyle);
  const name = profile.display_name || profile.username;
  const visible = links.filter((l) => l.enabled && l.url.trim().length > 0);
  const groups = groupLinks(visible, sections);
  let shown = 0;
  const total = visible.length;

  return (
    <div
      aria-label="Preview of your page"
      role="img"
      className="w-full overflow-hidden rounded-3xl border-4 border-black/70 shadow-xl"
      style={{
        background: theme.background,
        color: theme.foreground,
        fontFamily: fontFamilyFor(theme.font),
      }}
    >
      <div className="flex max-h-80 flex-col items-center gap-1 overflow-hidden px-3 py-4">
        <div className="h-12 w-12 rounded-full p-0.5" style={{ background: theme.accent }}>
          <div
            className="flex h-full w-full items-center justify-center overflow-hidden rounded-full text-sm font-bold"
            style={{ background: theme.card, color: theme.cardForeground }}
          >
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              name.slice(0, 1).toUpperCase()
            )}
          </div>
        </div>
        <div className="max-w-full truncate text-sm font-bold">{name}</div>
        <div className="mb-1 text-[10px] opacity-70">@{profile.username}</div>
        <div className="w-full space-y-1">
          {groups.map((g) => {
            if (shown >= MAX_ROWS) return null;
            const rows = g.links.slice(0, MAX_ROWS - shown);
            shown += rows.length;
            return (
              <div key={g.key} className="space-y-1">
                {g.section && (
                  <div className="pt-1 text-[9px] font-semibold uppercase tracking-wide opacity-70">
                    {g.section.title}
                  </div>
                )}
                {rows.map((l) => {
                  const d = linkDisplay(l);
                  return (
                    <div
                      key={l.id}
                      className="flex items-center gap-1.5 border px-2 py-1.5 text-[11px] font-medium"
                      style={{
                        background: theme.buttonStyle === "outline" ? "transparent" : theme.card,
                        color: theme.cardForeground,
                        borderColor: l.featured ? theme.accent : theme.border,
                        borderRadius: radius,
                      }}
                    >
                      <d.icon className="h-3 w-3 shrink-0" />
                      <span className="truncate">{d.label}</span>
                      {l.featured && (
                        <Star
                          className="ml-auto h-2.5 w-2.5 shrink-0"
                          style={{ color: theme.accent }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {total === 0 && (
            <div className="py-3 text-center text-[10px] opacity-60">Your links show here</div>
          )}
          {total > MAX_ROWS && (
            <div className="text-center text-[10px] opacity-60">+{total - MAX_ROWS} more</div>
          )}
        </div>
      </div>
    </div>
  );
}
