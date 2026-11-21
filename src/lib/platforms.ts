import {
  Instagram,
  Facebook,
  Mail,
  Twitter,
  Youtube,
  Linkedin,
  Github,
  Twitch,
  Music2,
  MessageCircle,
  Send,
  Globe,
  Ghost,
  DollarSign,
  Wallet,
  ShoppingCart,
  CreditCard,
  Coffee,
  Pin,
  Camera,
  Music,
  Phone,
  type LucideIcon,
} from "lucide-react";

export type PlatformMeta = {
  label: string;
  icon: LucideIcon;
  color: string; // tailwind gradient classes
  hint: string;
};

export const PLATFORMS: Record<string, PlatformMeta> = {
  instagram: { label: "Instagram", icon: Instagram, color: "from-pink-500 via-fuchsia-500 to-orange-400", hint: "https://instagram.com/yourhandle" },
  snapchat: { label: "Snapchat", icon: Ghost, color: "from-yellow-300 to-yellow-500", hint: "https://snapchat.com/add/yourhandle" },
  facebook: { label: "Facebook", icon: Facebook, color: "from-blue-500 to-blue-700", hint: "https://facebook.com/yourprofile" },
  gmail: { label: "Gmail", icon: Mail, color: "from-red-400 to-rose-600", hint: "mailto:you@gmail.com" },
  twitter: { label: "X / Twitter", icon: Twitter, color: "from-slate-700 to-slate-900", hint: "https://x.com/yourhandle" },
  youtube: { label: "YouTube", icon: Youtube, color: "from-red-500 to-red-700", hint: "https://youtube.com/@yourchannel" },
  linkedin: { label: "LinkedIn", icon: Linkedin, color: "from-sky-600 to-blue-800", hint: "https://linkedin.com/in/you" },
  github: { label: "GitHub", icon: Github, color: "from-zinc-600 to-zinc-900", hint: "https://github.com/you" },
  tiktok: { label: "TikTok", icon: Music2, color: "from-cyan-400 via-pink-500 to-fuchsia-600", hint: "https://tiktok.com/@you" },
  twitch: { label: "Twitch", icon: Twitch, color: "from-purple-500 to-purple-800", hint: "https://twitch.tv/you" },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, color: "from-green-400 to-emerald-600", hint: "https://wa.me/15555555555" },
  telegram: { label: "Telegram", icon: Send, color: "from-sky-400 to-blue-600", hint: "https://t.me/yourhandle" },
  discord: { label: "Discord", icon: MessageCircle, color: "from-indigo-400 to-indigo-700", hint: "yourhandle#0001" },
  cashapp: { label: "Cash App", icon: DollarSign, color: "from-green-400 to-green-600", hint: "https://cash.app/$yourhandle" },
  paypal: { label: "PayPal", icon: Wallet, color: "from-blue-400 to-indigo-700", hint: "https://paypal.me/yourhandle" },
  venmo: { label: "Venmo", icon: DollarSign, color: "from-sky-400 to-sky-700", hint: "https://venmo.com/yourhandle" },
  zelle: { label: "Zelle", icon: DollarSign, color: "from-purple-500 to-violet-700", hint: "your@email.com" },
  amazon: { label: "Amazon", icon: ShoppingCart, color: "from-orange-400 to-yellow-600", hint: "https://www.amazon.com/hz/wishlist/ls/yourlist" },
  applepay: { label: "Apple Pay", icon: CreditCard, color: "from-zinc-700 to-black", hint: "https://cash.me/yourhandle" },
  googlepay: { label: "Google Pay", icon: CreditCard, color: "from-blue-400 via-red-400 to-yellow-400", hint: "your@email.com" },
  stripe: { label: "Stripe", icon: CreditCard, color: "from-indigo-500 to-purple-700", hint: "https://buy.stripe.com/yourlink" },
  buymeacoffee: { label: "Buy Me a Coffee", icon: Coffee, color: "from-yellow-400 to-amber-600", hint: "https://buymeacoffee.com/you" },
  patreon: { label: "Patreon", icon: Coffee, color: "from-orange-500 to-red-600", hint: "https://patreon.com/you" },
  onlyfans: { label: "OnlyFans", icon: Camera, color: "from-sky-400 to-blue-600", hint: "https://onlyfans.com/you" },
  pinterest: { label: "Pinterest", icon: Pin, color: "from-red-500 to-rose-700", hint: "https://pinterest.com/you" },
  spotify: { label: "Spotify", icon: Music, color: "from-green-400 to-green-700", hint: "https://open.spotify.com/user/you" },
  applemusic: { label: "Apple Music", icon: Music, color: "from-pink-500 to-red-600", hint: "https://music.apple.com/profile/you" },
  soundcloud: { label: "SoundCloud", icon: Music, color: "from-orange-400 to-orange-600", hint: "https://soundcloud.com/you" },
  phone: { label: "Phone", icon: Phone, color: "from-emerald-400 to-teal-600", hint: "tel:+15555555555" },
  website: { label: "Website", icon: Globe, color: "from-violet-500 to-fuchsia-600", hint: "https://yoursite.com" },
};

export function getPlatform(key: string): PlatformMeta {
  return (
    PLATFORMS[key.toLowerCase()] ?? {
      label: key,
      icon: Globe,
      color: "from-violet-500 to-fuchsia-600",
      hint: "https://...",
    }
  );
}

export const PLATFORM_KEYS = Object.keys(PLATFORMS);

/**
 * The presets offered when someone adds a link.
 *
 * Product decision, 21 Nov 2026: Yooits never presents itself as a way to
 * send money, so there is no "Payments" category, and there is no OnlyFans
 * preset while Stripe reviews the tipping model. A payment or creator
 * platform's address can still be added as an ordinary Website link.
 * Amazon store and wishlist links are allowed.
 *
 * The older keys stay in PLATFORMS above only so that a link saved with one
 * of them still shows its name and icon; they are never offered here.
 */
export const PLATFORM_CATEGORIES: { label: string; keys: string[] }[] = [
  { label: "Social", keys: ["instagram", "tiktok", "snapchat", "facebook", "twitter", "youtube", "twitch", "linkedin", "pinterest"] },
  { label: "Messaging", keys: ["whatsapp", "telegram", "discord", "gmail", "phone"] },
  { label: "Shopping & creators", keys: ["amazon", "patreon", "buymeacoffee"] },
  { label: "Music", keys: ["spotify", "applemusic", "soundcloud"] },
  { label: "Other", keys: ["github", "website"] },
];

/** Keys that are no longer offered as presets (see PLATFORM_CATEGORIES). */
export const RETIRED_PLATFORM_KEYS = [
  "cashapp",
  "paypal",
  "venmo",
  "zelle",
  "applepay",
  "googlepay",
  "stripe",
  "onlyfans",
] as const;

export const PICKABLE_PLATFORM_KEYS: string[] = PLATFORM_CATEGORIES.flatMap((c) => c.keys);
