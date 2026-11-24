import { describe, expect, it } from "vitest";
import { removeBackground } from "./remove-background.server";

const U = "11111111-2222-4333-8444-555555555555";
const pub = (name: string, who = U) =>
  `https://zlunoczkptknsxviddiw.supabase.co/storage/v1/object/public/avatars/${who}/${name}`;

function fakes(opts: {
  rpc?: unknown;
  rpcError?: { code?: string; message: string };
  avatar?: string | null;
  rmError?: unknown;
}) {
  const removed: string[][] = [];
  const asAdmin = {
    rpc: async () => ({ data: opts.rpc ?? null, error: opts.rpcError ?? null }),
  };
  const service = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { avatar_url: opts.avatar ?? null }, error: null }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        remove: async (p: string[]) => {
          removed.push(p);
          return { error: opts.rmError ?? null };
        },
      }),
    },
  };
  return { asAdmin, service, removed };
}

describe("removing a custom background", () => {
  it("clears it, then deletes the stored photo so its address stops loading", async () => {
    const f = fakes({ rpc: pub("background-1.webp") });
    expect(await removeBackground(f.asAdmin, f.service, U, "Reported")).toEqual({
      removed: true,
      fileDeleted: true,
    });
    expect(f.removed).toEqual([[`${U}/background-1.webp`]]);
  });

  it("keeps the file when it's also their profile photo", async () => {
    const f = fakes({ rpc: pub("me.png"), avatar: pub("me.png") });
    expect(await removeBackground(f.asAdmin, f.service, U, "Reported")).toMatchObject({
      removed: true,
      fileDeleted: false,
      kept: "is_profile_photo",
    });
    expect(f.removed).toEqual([]);
  });

  it("never deletes anything outside that creator's folder", async () => {
    const other = "99999999-2222-4333-8444-555555555555";
    const f = fakes({ rpc: pub("background-1.webp", other) });
    expect(await removeBackground(f.asAdmin, f.service, U, "Reported")).toMatchObject({
      kept: "not_in_own_folder",
    });
    expect(f.removed).toEqual([]);
  });

  it("does nothing more when there was no background, and says when the delete failed", async () => {
    const none = fakes({ rpc: null });
    expect(await removeBackground(none.asAdmin, none.service, U, "x y z")).toEqual({
      removed: false,
      fileDeleted: false,
    });
    expect(none.removed).toEqual([]);
    const failed = fakes({ rpc: pub("background-1.webp"), rmError: new Error("boom") });
    expect(await removeBackground(failed.asAdmin, failed.service, U, "Reported")).toMatchObject({
      removed: true,
      kept: "delete_failed",
    });
  });

  it("passes on the database's refusal for non-admins", async () => {
    const f = fakes({ rpcError: { code: "42501", message: "Not authorized" } });
    await expect(removeBackground(f.asAdmin, f.service, U, "Reported")).rejects.toThrow(
      "Only Yooits.me admins can do this.",
    );
    expect(f.removed).toEqual([]);
  });
});
