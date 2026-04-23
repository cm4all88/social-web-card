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
