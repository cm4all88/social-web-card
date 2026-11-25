export const PROFILE_BLOCKS = ["links", "wishlists", "posts", "products"] as const;
export type ProfileBlock = (typeof PROFILE_BLOCKS)[number];

export const PROFILE_BLOCK_LABELS: Record<ProfileBlock, string> = {
  links: "Links",
  wishlists: "Wishlists",
  posts: "Posts",
  products: "Digital products",
};

export function profileBlocks(saved?: readonly string[] | null): ProfileBlock[] {
  if (!saved) return ["links", "wishlists", "posts"];
  return [
    ...new Set(saved.filter((id): id is ProfileBlock => PROFILE_BLOCKS.some((key) => key === id))),
  ];
}
