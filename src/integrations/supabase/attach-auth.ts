import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "./client";

/**
 * Client-side function middleware: sends the signed-in user's access token
 * with a server-function call so `requireSupabaseAuth` can verify it.
 * Use as `.middleware([attachSupabaseAuth, requireSupabaseAuth])`.
 */
export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  },
);
