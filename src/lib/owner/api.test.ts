import { describe, expect, it, vi } from "vitest";

// A stand-in client whose rpc needs its own `this`, like the real Supabase client.
const calls: unknown[] = [];
vi.mock("@/integrations/supabase/client", () => {
  const client = {
    rest: { tag: "rest" },
    rpc(this: { rest?: unknown }, fn: string, args: object) {
      if (!this?.rest) throw new Error("rpc called without its client");
      calls.push([fn, args]);
      if (fn === "owner_overview") return Promise.resolve({ data: { total_users: 1 }, error: null });
      return Promise.resolve({ data: null, error: { code: "42501", message: "Not authorized" } });
    },
  };
  return { supabase: client };
});

import { OwnerAccessError, ownerRpc } from "./api";

describe("ownerRpc", () => {
  it("calls the database function on the client and returns its data", async () => {
    await expect(ownerRpc("owner_overview", {})).resolves.toEqual({ total_users: 1 });
    expect(calls[0]).toEqual(["owner_overview", {}]);
  });

  it("turns the database's not-authorized error into a plain message", async () => {
    await expect(ownerRpc("owner_audit_log", {})).rejects.toBeInstanceOf(OwnerAccessError);
  });
});
