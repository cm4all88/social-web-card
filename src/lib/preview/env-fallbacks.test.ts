import { describe, expect, it } from "vitest";
import { applySupabaseEnvFallbacks } from "./env-fallbacks";

describe("applySupabaseEnvFallbacks", () => {
  it("fills the names the app reads from the Supabase–Vercel integration's names", () => {
    const env: Record<string, string | undefined> = {
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co/",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SECRET_KEY: "secret",
    };
    applySupabaseEnvFallbacks(env);
    expect(env.SUPABASE_URL).toBe("https://abc.supabase.co");
    expect(env.SUPABASE_PUBLISHABLE_KEY).toBe("anon");
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("secret");
  });

  it("keeps the app's own names first and trims what was pasted around them", () => {
    const env: Record<string, string | undefined> = {
      SUPABASE_URL: ' "https://abc.supabase.co" \n',
      SUPABASE_PUBLISHABLE_KEY: "own",
      SUPABASE_ANON_KEY: "other",
    };
    applySupabaseEnvFallbacks(env);
    expect(env.SUPABASE_URL).toBe("https://abc.supabase.co");
    expect(env.SUPABASE_PUBLISHABLE_KEY).toBe("own");
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });
});
