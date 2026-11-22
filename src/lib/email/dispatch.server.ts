/**
 * The email dispatcher: takes due emails from the database outbox, renders
 * them, sends them through Resend and records what happened. Called every
 * minute by the database (pg_cron -> email_kick -> /api/email/dispatch), right
 * after new email is queued, and from the Owner Console.
 *
 * Safe to run twice at once: the database hands each email to one run only,
 * and Resend's idempotency key (the outbox id) stops a retry sending twice.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { MarketingNotReadyError, renderEmail, UnknownTemplateError } from "./render";
import {
  normalizeResendEvent,
  resendConfigured,
  resendLastEvent,
  sendViaResend,
} from "./resend.server";
import { OPTIONAL_CATEGORIES, type EmailCategory, type Payload } from "./templates";

type Rpc = (
  fn: string,
  args?: object,
) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;

export type OutboxRow = {
  id: string;
  template: string;
  category: EmailCategory;
  user_id: string | null;
  to_email: string;
  payload: Payload;
  is_test: boolean;
  attempts: number;
};

export type DispatchDeps = {
  rpc: Rpc;
  send: typeof sendViaResend;
  lastEvent: typeof resendLastEvent;
  configured: () => boolean;
  log?: (msg: string, extra?: object) => void;
};

export type DispatchSummary = {
  configured: boolean;
  /** False when the email tables aren't in the database yet. */
  ready: boolean;
  claimed: number;
  sent: number;
  failed: number;
  retrying: number;
  statusChecked: number;
};

function defaultDeps(): DispatchDeps {
  const client = supabaseAdmin as unknown as SupabaseClient;
  return {
    rpc: (fn, args) => client.rpc(fn, args ?? {}) as never,
    send: sendViaResend,
    lastEvent: resendLastEvent,
    configured: resendConfigured,
    log: (msg, extra) => console.log(`[email] ${msg}`, extra ?? {}),
  };
}

export function isMissingFunction(e: { code?: string; message: string } | null): boolean {
  if (!e) return false;
  return (
    e.code === "42883" ||
    e.code === "PGRST202" ||
    /could not find the function|does not exist/i.test(e.message)
  );
}

export async function runDispatch(
  opts: { limit?: number } = {},
  deps: DispatchDeps = defaultDeps(),
): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    configured: deps.configured(),
    ready: true,
    claimed: 0,
    sent: 0,
    failed: 0,
    retrying: 0,
    statusChecked: 0,
  };
  // Without a Resend key nothing is claimed, so queued email waits safely.
  if (!summary.configured) return summary;

  const { data, error } = await deps.rpc("email_claim_batch", {
    _limit: Math.min(Math.max(opts.limit ?? 20, 1), 100),
  });
  if (error) {
    if (isMissingFunction(error)) return { ...summary, ready: false };
    throw new Error(`email_claim_batch: ${error.message}`);
  }
  const rows = (data ?? []) as OutboxRow[];
  summary.claimed = rows.length;

  for (const row of rows) {
    const outcome = await sendOne(row, deps);
    if (outcome === "sent") summary.sent++;
    else if (outcome === "retry") summary.retrying++;
    else summary.failed++;
  }

  summary.statusChecked = await refreshStatuses(deps);
  return summary;
}

async function sendOne(row: OutboxRow, deps: DispatchDeps): Promise<"sent" | "retry" | "failed"> {
  const mark = async (
    ok: boolean,
    extra: { provider_id?: string; subject?: string; error?: string; retryable?: boolean },
  ) => {
    const { data, error } = await deps.rpc("email_mark_result", {
      _id: row.id,
      _ok: ok,
      _provider_id: extra.provider_id ?? null,
      _subject: extra.subject ?? null,
      _error: extra.error ?? null,
      _retryable: extra.retryable ?? true,
    });
    if (error) deps.log?.("mark_result failed", { id: row.id, error: error.message });
    return (data as string | null) ?? null;
  };

  let token: string | null = null;
  if (OPTIONAL_CATEGORIES.includes(row.category) && row.user_id) {
    const { data } = await deps.rpc("email_unsubscribe_token", { _user_id: row.user_id });
    token = (data as string | null) ?? null;
    if (!token && !row.is_test) {
      await mark(false, { error: "No unsubscribe token for optional email", retryable: false });
      return "failed";
    }
  }

  let rendered;
  try {
    rendered = renderEmail(row.template, row.payload ?? {}, {
      category: row.category,
      unsubscribeToken: token,
      isTest: row.is_test,
    });
  } catch (e) {
    const permanent = e instanceof UnknownTemplateError || e instanceof MarketingNotReadyError;
    await mark(false, { error: (e as Error).message.slice(0, 300), retryable: !permanent });
    return permanent ? "failed" : "retry";
  }

  const result = await deps.send({
    from: rendered.from,
    to: row.to_email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    replyTo: rendered.replyTo,
    headers: rendered.headers,
    tags: [
      { name: "category", value: row.category },
      { name: "template", value: row.template },
    ],
    idempotencyKey: `yooits-email-${row.id}`,
  });

  if (result.ok) {
    await mark(true, { provider_id: result.id, subject: rendered.subject });
    return "sent";
  }
  const status = await mark(false, {
    subject: rendered.subject,
    error: result.error,
    retryable: result.retryable,
  });
  deps.log?.("send failed", { id: row.id, template: row.template, error: result.error, status });
  return status === "failed" ? "failed" : "retry";
}

/** Asks Resend what became of recent sends (delivered, bounced, complained). */
async function refreshStatuses(deps: DispatchDeps): Promise<number> {
  const { data, error } = await deps.rpc("email_needing_status", { _limit: 20 });
  if (error) return 0;
  const rows = (data ?? []) as { id: string; provider_id: string }[];
  let checked = 0;
  for (const r of rows) {
    const raw = await deps.lastEvent(r.provider_id);
    checked++;
    if (!raw) continue; // Resend didn't answer; looked at again in 10 minutes
    await deps.rpc("email_record_event", {
      _provider_id: r.provider_id,
      _type: normalizeResendEvent(raw) ?? raw,
      _detail: raw,
    });
  }
  return checked;
}
