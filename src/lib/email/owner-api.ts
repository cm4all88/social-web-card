/**
 * Browser calls for the Owner Console's email page. The database checks
 * has_role(admin) in every owner_email_* function. The generated Supabase
 * types don't know these yet (migration 20261122160000_email_system.sql).
 */
import { supabase } from "@/integrations/supabase/client";
import type { EmailCategory } from "./templates";

export type EmailSettings = {
  sending_enabled: boolean;
  account_enabled: boolean;
  security_enabled: boolean;
  billing_enabled: boolean;
  messages_enabled: boolean;
  activity_enabled: boolean;
  admin_enabled: boolean;
  marketing_enabled: boolean;
  admin_email: string;
  daily_optional_limit: number;
  dispatch_url: string | null;
};

export type EmailStatus = {
  settings: EmailSettings;
  counts_24h: Record<string, number>;
  counts_7d: Record<string, number>;
  queued: number;
  suppressed: number;
  marketing_opted_in: number;
  last_sent_at: string | null;
};

export type EmailLogRow = {
  id: string;
  template: string;
  category: EmailCategory;
  user_id: string | null;
  username: string | null;
  to_email: string;
  status: string;
  skip_reason: string | null;
  attempts: number;
  last_error: string | null;
  subject: string | null;
  is_test: boolean;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  last_event: string | null;
  next_attempt_at: string | null;
};

export type Suppression = {
  email: string;
  reason: string;
  detail: string | null;
  created_at: string;
};

type Fns = {
  owner_email_status: { args: Record<string, never>; result: EmailStatus };
  owner_email_log: {
    args: { _status?: string | null; _limit?: number; _offset?: number };
    result: EmailLogRow[];
  };
  owner_email_set_setting: { args: { _key: string; _value: string }; result: EmailSettings };
  owner_email_retry: { args: { _id: string }; result: boolean };
  owner_email_unsuppress: { args: { _email: string }; result: boolean };
  owner_email_suppressions: { args: Record<string, never>; result: Suppression[] };
  my_email_preferences: {
    args: Record<string, never>;
    result: { messages: boolean; activity: boolean; marketing: boolean };
  };
  set_my_email_preferences: {
    args: { _messages: boolean | null; _activity: boolean | null; _marketing: boolean | null };
    result: { messages: boolean; activity: boolean; marketing: boolean };
  };
};

/** Thrown when the email tables aren't in the database yet. */
export class EmailNotInstalledError extends Error {}

export async function emailRpc<K extends keyof Fns>(
  fn: K,
  args: Fns[K]["args"],
): Promise<Fns[K]["result"]> {
  const client = supabase as unknown as {
    rpc: (
      f: string,
      a: object,
    ) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
  };
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    if (
      error.code === "PGRST202" ||
      error.code === "42883" ||
      /could not find the function/i.test(error.message)
    ) {
      throw new EmailNotInstalledError("Email isn't switched on in the database yet.");
    }
    if (error.code === "42501")
      throw new Error(
        /^Not authorized/.test(error.message) ? "Only Yooits admins can do this." : error.message,
      );
    throw new Error(error.message);
  }
  return data as Fns[K]["result"];
}
