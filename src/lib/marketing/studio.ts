import juliePortrait from "@/assets/julie-hope-demo.jpg?inline";
import { bioLength, MAX_EXTRA_AVATARS, PROFILE_BIO_LIMIT } from "@/lib/profile-presentation";
import { z } from "zod";

const photo = z
  .string()
  .max(400_000)
  .refine((value) => !value || /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value));

export const demoProfileSchema = z.object({
  name: z.string().trim().min(1).max(50),
  username: z
    .string()
    .trim()
    .regex(/^[a-z0-9_.-]{1,40}$/i),
  bio: z.string().refine((value) => bioLength(value) <= PROFILE_BIO_LIMIT),
  avatar: photo,
  avatarGallery: z.array(photo).max(MAX_EXTRA_AVATARS).optional(),
  background: photo,
  theme: z.string().max(40),
  skin: z.string().max(40),
  motion: z.enum(["subtle", "standard", "full"]).optional(),
  avatarSize: z.union([z.literal(112), z.literal(144), z.literal(176)]),
  bioAlignment: z.enum(["left", "center"]),
  links: z
    .array(
      z.object({
        platform: z.string().max(40),
        url: z
          .string()
          .max(2048)
          .url()
          .refine((value) => {
            try {
              const url = new URL(value);
              return (
                url.protocol === "https:" &&
                !url.username &&
                !url.password &&
                url.hostname.endsWith(".example")
              );
            } catch {
              return false;
            }
          }),
        title: z.string().max(80),
        featured: z.boolean().optional(),
        icon: z.string().max(40).optional(),
      }),
    )
    .max(8),
});

export type DemoProfile = z.infer<typeof demoProfileSchema>;

export const STUDIO_TEMPLATES = [
  "Theme of the day",
  "Seasonal skin showcase",
  "Creator spotlight",
  "Profile inspiration",
  "Theme transformation",
  "Before and after",
  "Feature demonstration",
  "Free account promotion",
  "Creator lifestyle",
  "New theme announcement",
] as const;

export const STUDIO_CANVASES = {
  portrait: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
  vertical: { width: 1080, height: 1920 },
} as const;

export const studioGraphicSchema = z.object({
  video: z.boolean().optional(),
  profiles: z.array(demoProfileSchema).min(1).max(4),
  canvas: z.enum(["portrait", "square", "vertical"]),
  presentation: z.enum(["standalone", "device"]),
});

export type StudioGraphicSpec = z.infer<typeof studioGraphicSchema>;

export function studioGraphic(value: unknown): StudioGraphicSpec | undefined {
  const result = studioGraphicSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

const portraits = import.meta.glob<string>("/src/assets/demo-avatars/*.webp", {
  eager: true,
  query: "?inline",
  import: "default",
});
const portrait = (username: string) => portraits[`/src/assets/demo-avatars/${username}.webp`] ?? "";

const fictional = [
  [
    "Julie Hope",
    "juliehope-demo",
    "BookTok",
    "snowfall",
    "snow",
    "Hope isn't just my middle name, it's my way of life. 🤍 Lover of people, meaningful connections, and all things books. Proud book nerd sharing my favorite reads, fictional crushes, and bookish adventures on BookTok. Big heart, hopeful soul, overflowing bookshelf. 📚✨",
    [
      ["instagram", ""],
      ["tiktok", ""],
    ],
  ],
  [
    "Rae Wilder",
    "raewilder-demo",
    "Music",
    "sunset",
    "none",
    "Bedroom pop, late-night demos, and the occasional song about the bus ride home.",
    [
      ["spotify", "Latest single"],
      ["youtube", "Live sessions"],
      ["soundcloud", "Rough demos"],
      ["website", "Show dates"],
    ],
  ],
  [
    "Mika Byte",
    "mikabyte-demo",
    "Gaming",
    "neon",
    "stars",
    "Cozy games on weeknights. Chaotic co-op on Sundays.",
    [
      ["twitch", "Watch live"],
      ["discord", "Chat with the community"],
      ["youtube", "Highlights"],
      ["tiktok", "Clips"],
      ["website", "Stream schedule"],
    ],
  ],
  [
    "Noa Vale",
    "noavale-demo",
    "Photography",
    "mono",
    "none",
    "Street photography and quiet corners of busy cities.",
    [
      ["website", "Photo portfolio"],
      ["instagram", "Street photos"],
      ["website", "Book a shoot"],
    ],
  ],
  [
    "Jules Meridian",
    "julesmeridian-demo",
    "Travel",
    "harvest",
    "leaves",
    "Slow trains, small towns, and notes from the road.",
    [
      ["youtube", "Train journeys"],
      ["instagram", "Postcards"],
      ["website", "Trip notes"],
      ["pinterest", "Route inspiration"],
    ],
  ],
  [
    "Kai Hart",
    "kaihart-demo",
    "Fitness",
    "matrix",
    "none",
    "Short movement sessions and a running log for the rest of us.",
    [
      ["youtube", "Run warm-ups"],
      ["instagram", "Training log"],
      ["tiktok", "Movement breaks"],
    ],
  ],
  [
    "Remy Moss",
    "remymoss-demo",
    "Art",
    "sweetheart",
    "hearts",
    "Illustrations, little comics, and a battered sketchbook.",
    [
      ["website", "Print shop"],
      ["instagram", "Sketchbook"],
      ["pinterest", "Studio inspiration"],
      ["patreon", "Behind the scenes"],
      ["youtube", "Painting process"],
      ["website", "Commission info"],
    ],
  ],
  [
    "Juniper Paper Co.",
    "juniperpaper-demo",
    "Small business",
    "peach",
    "none",
    "Small-batch notebooks and letterpress cards from an independent paper shop.",
    [
      ["website", "Shop notebooks"],
      ["website", "Store hours"],
      ["instagram", "Paper and ink"],
      ["pinterest", "Gift ideas"],
      ["website", "Wholesale"],
      ["website", "Workshops"],
      ["facebook", "Market dates"],
    ],
  ],
  [
    "Sam Rowan",
    "samrowan-demo",
    "Personal",
    "forest",
    "none",
    "Weekend hikes, family recipes, and a place to keep my favorite links.",
    [["website", "Weekend notes"]],
  ],
  [
    "Leila Nasser",
    "leilanasser-demo",
    "Software developer",
    "ocean",
    "none",
    "I build accessible interfaces and write about the small decisions that make them work.",
    [
      ["github", "Open source"],
      ["website", "Portfolio"],
      ["linkedin", "Work history"],
      ["website", "Writing"],
      ["youtube", "Talks"],
    ],
  ],
] as const;

export const DEMO_PROFILES = fictional.map(
  ([name, username, audience, theme, skin, bio, links]) => ({
    audience,
    profile: {
      name,
      username,
      theme,
      skin,
      bio,
      avatar: username === "juliehope-demo" ? juliePortrait : portrait(username),
      avatarGallery:
        username === "juliehope-demo" ? [portrait("juliehope-cafe")].filter(Boolean) : [],
      background: "",
      avatarSize: 144,
      bioAlignment: "center",
      links: links.map(([platform, title], index) => ({
        platform,
        title,
        featured: index === 0 && links.length >= 5,
        url: `https://${platform}.example/${username}/${index + 1}`,
      })),
    } satisfies DemoProfile,
  }),
);
