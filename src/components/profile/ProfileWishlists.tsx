import { Link } from "@tanstack/react-router";
import { Gift } from "lucide-react";
import { buttonRadiusFor, type ThemeTokens } from "@/lib/themes";

export type WishlistSummary = { id: string; slug: string; title: string; occasion: string | null };

export function ProfileWishlists({
  lists,
  username,
  theme,
}: {
  lists: WishlistSummary[];
  username: string;
  theme: ThemeTokens;
}) {
  if (!lists.length) return null;
  const radius = buttonRadiusFor(theme.buttonStyle);
  return (
    <section className="mt-6 w-full space-y-3" aria-label="Wishlists">
      {lists.map((w) => (
        <Link
          key={w.id}
          to="/$username/wishlist/$slug"
          params={{ username: username, slug: w.slug }}
          className="flex items-center gap-4 border p-4 transition-all hover:-translate-y-0.5"
          style={{
            background: theme.buttonStyle === "outline" ? "transparent" : theme.card,
            color: theme.cardForeground,
            borderColor: theme.border,
            borderRadius: radius,
          }}
        >
          <Gift className="h-6 w-6 shrink-0" style={{ color: theme.accent }} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{w.title}</div>
            {w.occasion && <div className="text-xs opacity-70">{w.occasion}</div>}
          </div>
          <span className="text-xs opacity-70">View list →</span>
        </Link>
      ))}
    </section>
  );
}
