/**
 * Creator posts on a public page. Shown only while creator subscriptions are
 * switched on. Subscriber-only posts arrive from the database as a title and
 * preview alone, and their photos get no link from storage, so nothing paid
 * reaches a visitor's browser. There is no subscribe button: subscriptions
 * can't be bought on Yooits.me yet.
 */
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { loadCreatorFeed, signedMediaUrls, type FeedPost } from "@/lib/creator/subscriptions";

type Look = { card: string; cardForeground: string; border: string; accent: string };

export function CreatorPosts({
  username,
  theme,
  radius,
  outline,
}: {
  username: string;
  theme: Look;
  radius: string | number;
  outline: boolean;
}) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    void loadCreatorFeed(username).then(async (f) => {
      if (!live || !f.enabled) return;
      setPosts(f.posts);
      const paths = f.posts.flatMap((p) => (p.locked ? [] : p.media_paths));
      const signed = await signedMediaUrls(paths).catch(() => ({}));
      if (live) setUrls(signed);
    });
    return () => {
      live = false;
    };
  }, [username]);

  if (posts.length === 0) return null;
  return (
    <section className="mt-6 w-full space-y-3" aria-label="Posts">
      {posts.map((p) => (
        <article
          key={p.id}
          className="border p-4 text-left"
          style={{
            background: outline ? "transparent" : theme.card,
            color: theme.cardForeground,
            borderColor: theme.border,
            borderRadius: radius,
          }}
        >
          <div className="flex items-center gap-2 font-semibold">
            {p.locked && <Lock className="h-4 w-4 shrink-0" style={{ color: theme.accent }} />}
            {p.title}
          </div>
          {p.locked ? (
            <>
              {p.preview && <p className="mt-1 text-sm opacity-80">{p.preview}</p>}
              <p className="mt-2 text-xs opacity-70">
                For subscribers
                {p.media_count > 0
                  ? ` · ${p.media_count} photo${p.media_count === 1 ? "" : "s"}`
                  : ""}
              </p>
            </>
          ) : (
            <>
              {p.body && <p className="mt-1 whitespace-pre-wrap text-sm">{p.body}</p>}
              {p.media_paths.some((m) => urls[m]) && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {p.media_paths.map((m) =>
                    urls[m] ? (
                      <img
                        key={m}
                        src={urls[m]}
                        alt=""
                        className="aspect-square w-full rounded-lg object-cover"
                      />
                    ) : null,
                  )}
                </div>
              )}
            </>
          )}
        </article>
      ))}
    </section>
  );
}
