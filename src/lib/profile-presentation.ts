export const PROFILE_BIO_LIMIT = 1000;
export const MAX_EXTRA_AVATARS = 3;
export const PROFILE_AVATAR_SIZES = [112, 144, 176] as const;

export function bioLength(bio: string) {
  return Array.from(bio).length;
}

export function limitBio(bio: string, limit: number) {
  return Array.from(bio).slice(0, limit).join("");
}

export function skinAmount(motion?: string | null) {
  if (motion === "subtle") return 0.45;
  if (motion === "full") return 1.45;
  return 1;
}
