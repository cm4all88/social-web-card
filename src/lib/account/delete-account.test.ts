import { describe, expect, it } from "vitest";
import { AccountDeletionRefused, deleteAccount, DELETED_TABLES, KEPT_TABLES } from "./delete-account.server";

type Opts = { username?: string | null; admin?: boolean; suspended?: boolean; files?: string[]; plus?: string };

function fakeAdmin(opts: Opts = {}) {
  const log: string[] = [];
  const single = (table: string) => {
    if (table === "profiles")
      return opts.username === null ? null : { username: opts.username ?? "maya" };
    if (table === "account_status") return opts.suspended ? { suspended_at: "2026-11-21" } : null;
    return null;
  };
  const from = (table: string) => ({
    select: () => ({
      eq: () => {
        const rows =
          table === "user_roles"
            ? opts.admin
              ? [{ role: "admin" }]
              : [{ role: "user" }]
            : table === "plus_subscriptions" && opts.plus
              ? [{ status: opts.plus }]
              : [];
        const p = Promise.resolve({ data: rows, error: null });
        return Object.assign(p, {
          maybeSingle: async () => ({ data: single(table), error: null }),
        });
      },
    }),
    delete: () => ({
      eq: async (col: string, val: string) => {
        log.push(`delete ${table} ${col}=${val}`);
        return { error: null };
      },
    }),
  });
  const client = {
    from,
    storage: {
      from: () => ({
        list: async () => ({ data: (opts.files ?? []).map((name) => ({ name })), error: null }),
        remove: async (paths: string[]) => {
          log.push(`remove ${paths.join(",")}`);
          return { error: null };
        },
      }),
    },
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          log.push(`deleteUser ${id}`);
          return { error: null };
        },
      },
    },
  };
  return { client: client as never, log };
}

describe("deleteAccount", () => {
  it("removes the page, its content, the avatar and the sign-in, in that order", async () => {
    const { client, log } = fakeAdmin({ files: ["avatar-1.png"] });
    await deleteAccount(client, "u1", " Maya ");
    expect(log).toEqual([
      "remove u1/avatar-1.png",
      // The same fake listing serves the creator-media and support-files buckets.
      "remove u1/avatar-1.png",
      "remove u1/avatar-1.png",
      ...DELETED_TABLES.map((t) => `delete ${t} user_id=u1`),
      "deleteUser u1",
    ]);
  });

  it("keeps payment records and the audit log", () => {
    for (const t of KEPT_TABLES) expect(DELETED_TABLES as readonly string[]).not.toContain(t);
  });

  it("needs the username typed to confirm", async () => {
    const { client, log } = fakeAdmin();
    await expect(deleteAccount(client, "u1", "someone")).rejects.toBeInstanceOf(AccountDeletionRefused);
    expect(log).toEqual([]);
  });

  it("refuses admin accounts", async () => {
    const { client, log } = fakeAdmin({ admin: true });
    await expect(deleteAccount(client, "u1", "maya")).rejects.toThrow(/Admin accounts/);
    expect(log).toEqual([]);
  });

  it("refuses suspended accounts", async () => {
    const { client, log } = fakeAdmin({ suspended: true });
    await expect(deleteAccount(client, "u1", "maya")).rejects.toThrow(/suspended/);
    expect(log).toEqual([]);
  });

  it("finishes a deletion that stopped after the profile was removed", async () => {
    const { client, log } = fakeAdmin({ username: null });
    await deleteAccount(client, "u1", "maya");
    expect(log.at(-1)).toBe("deleteUser u1");
  });

  it("refuses while a Plus subscription is still running, and allows it once it has ended", async () => {
    for (const status of ["active", "trialing", "past_due", "unpaid"]) {
      const { client, log } = fakeAdmin({ plus: status });
      await expect(deleteAccount(client, "u1", "maya")).rejects.toThrow(/Cancel Plus first/);
      expect(log).toEqual([]);
    }
    const { client, log } = fakeAdmin({ plus: "canceled" });
    await deleteAccount(client, "u1", "maya");
    expect(log.at(-1)).toBe("deleteUser u1");
    expect(log.some((l) => l.includes("plus_subscriptions") || l.includes("billing_customers"))).toBe(false);
  });
});
