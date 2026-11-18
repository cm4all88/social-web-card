import { describe, expect, it } from "vitest";
import { previewGate, suppliedPassword } from "./gate";

const req = (path: string, auth?: string) =>
  new Request(`https://yooits-preview.example.workers.dev${path}`, auth ? { headers: { authorization: auth } } : {});
const basic = (user: string, pw: string) => `Basic ${btoa(`${user}:${pw}`)}`;

describe("preview gate", () => {
  it("does nothing when no preview password is set", () => {
    expect(previewGate(req("/dashboard"), undefined)).toBeNull();
    expect(previewGate(req("/dashboard"), "")).toBeNull();
  });

  it("asks for the password on pages and server functions", async () => {
    for (const path of ["/", "/alice", "/owner", "/_serverFn/abc"]) {
      const res = previewGate(req(path), "s3cret-pass");
      expect(res?.status).toBe(401);
      expect(res?.headers.get("WWW-Authenticate")).toMatch(/^Basic/);
    }
  });

  it("lets the right password through, with any user name", () => {
    expect(previewGate(req("/owner", basic("chris", "s3cret-pass")), "s3cret-pass")).toBeNull();
    expect(previewGate(req("/owner", basic("", "s3cret-pass")), "s3cret-pass")).toBeNull();
  });

  it("refuses a wrong or malformed password", () => {
    expect(previewGate(req("/", basic("chris", "nope")), "s3cret-pass")?.status).toBe(401);
    expect(previewGate(req("/", "Basic !!!notbase64"), "s3cret-pass")?.status).toBe(401);
    expect(previewGate(req("/", "Bearer s3cret-pass"), "s3cret-pass")?.status).toBe(401);
    expect(suppliedPassword(`Basic ${btoa("nocolon")}`)).toBeNull();
  });

  it("leaves Stripe's webhook open (Stripe signs it)", () => {
    expect(previewGate(req("/api/stripe/webhook"), "s3cret-pass")).toBeNull();
    expect(previewGate(req("/api/stripe/webhook2"), "s3cret-pass")?.status).toBe(401);
  });
});
