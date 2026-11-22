/**
 * An admin takes a custom background off a page. The database clears it and
 * writes the audit log (as the admin, so it checks they are one); then the
 * stored file is deleted so its public address stops loading too.
 */
import { storagePathInOwnFolder } from "@/lib/backgrounds";

type Rpc = {
  rpc: (
    fn: string,
    args: object,
  ) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
};
type Admin = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (
        k: string,
        v: string,
      ) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> };
    };
  };
  storage: {
    from: (b: string) => { remove: (p: string[]) => PromiseLike<{ error: unknown }> };
  };
};

export type RemoveBackgroundResult = {
  removed: boolean;
  /** The stored file was deleted, so its address no longer loads. */
  fileDeleted: boolean;
  /** Why the file was kept, when it was. */
  kept?: "is_profile_photo" | "not_in_own_folder" | "delete_failed";
};

export async function removeBackground(
  asAdmin: Rpc,
  service: Admin,
  userId: string,
  reason: string,
): Promise<RemoveBackgroundResult> {
  const { data, error } = await asAdmin.rpc("owner_remove_background", {
    _user_id: userId,
    _reason: reason,
  });
  if (error) {
    throw new Error(
      error.code === "42501" && /^Not authorized/.test(error.message)
        ? "Only Yooits admins can do this."
        : error.message,
    );
  }
  if (typeof data !== "string" || !data) return { removed: false, fileDeleted: false };

  const path = storagePathInOwnFolder(data, userId);
  if (!path) return { removed: true, fileDeleted: false, kept: "not_in_own_folder" };

  // The same file as their profile photo stays (deleting it would break the
  // photo); the admin sees that and can deal with the profile photo too.
  const { data: prof } = await service
    .from("profiles")
    .select("avatar_url")
    .eq("user_id", userId)
    .maybeSingle();
  const avatar = (prof as { avatar_url?: string | null } | null)?.avatar_url;
  if (avatar && storagePathInOwnFolder(avatar, userId) === path)
    return { removed: true, fileDeleted: false, kept: "is_profile_photo" };

  const { error: rmErr } = await service.storage.from("avatars").remove([path]);
  if (rmErr) {
    console.error("[owner] background file delete failed", (rmErr as Error).message ?? rmErr);
    return { removed: true, fileDeleted: false, kept: "delete_failed" };
  }
  return { removed: true, fileDeleted: true };
}
