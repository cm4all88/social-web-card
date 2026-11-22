/**
 * Owner Console email actions that need the server: whether the sender is
 * set up, test sends, running the queue now, and announcements. Each handler
 * checks that the caller is a Yooits admin first.
 *
 * Test sends only ever go to the admin's own sign-in address or the admin
 * address in the email settings, never to anyone else.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { attachSupabaseAuth } from "@/integrations/supabase/attach-auth";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { MAILING_ADDRESS, REPLY_TO } from "./brand";
import { isMissingFunction, runDispatch } from "./dispatch.server";
import { renderEmail } from "./render";
import { resendConfigured, sendViaResend } from "./resend.server";
import { TEMPLATE_BY_ID } from "./templates";

const db = () => supabaseAdmin as unknown as SupabaseClient;

async function requireAdmin(userId: string): Promise<void> {
  const { data, error } = await db().rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error || data !== true) throw new Error("Only Yooits admins can do this.");
}

async function adminAddress(): Promise<string> {
  const { data, error } = await db().from("email_settings").select("admin_email").maybeSingle();
  if (error || !data) return REPLY_TO;
  return (data as { admin_email: string | null }).admin_email ?? REPLY_TO;
}

async function databaseReady(): Promise<boolean> {
  const { error } = await db().from("email_settings").select("id").limit(1);
  return !error;
}

export const getEmailServerStatus = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const { data: me } = await db().auth.admin.getUserById(context.userId);
    return {
      resend: resendConfigured(),
      dispatchSecret: !!process.env.EMAIL_DISPATCH_SECRET,
      webhookSecret: !!process.env.RESEND_WEBHOOK_SECRET,
      mailingAddress: !!MAILING_ADDRESS,
      database: await databaseReady(),
      myEmail: me?.user?.email ?? null,
      adminEmail: await adminAddress(),
    };
  });

const testInput = z.object({
  template: z.string().max(60),
  to: z.enum(["me", "admin"]),
});

export const sendTestEmail = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(testInput)
  .handler(async ({ context, data }) => {
    await requireAdmin(context.userId);
    const def = TEMPLATE_BY_ID[data.template];
    if (!def) throw new Error("Unknown template.");
    if (!resendConfigured())
      throw new Error("The email sender isn't connected yet (RESEND_API_KEY).");

    let to: string | null;
    if (data.to === "me") {
      const { data: me } = await db().auth.admin.getUserById(context.userId);
      to = me?.user?.email ?? null;
    } else {
      to = await adminAddress();
    }
    if (!to) throw new Error("No address to send the test to.");

    // With the email tables in place the test goes through the queue, so it
    // shows in the delivery log exactly like real email.
    if (await databaseReady()) {
      const { data: id, error } = await db().rpc("email_queue", {
        _template: def.id,
        _category: def.category,
        _user_id: def.category === "admin" ? null : context.userId,
        _payload: def.sample,
        _dedupe_key: `test:${crypto.randomUUID()}`,
        _to_email: to,
        _is_test: true,
        _created_by: context.userId,
      });
      if (error) throw new Error(error.message);
      if (!id) throw new Error("The test wasn't queued.");
      const summary = await runDispatch({ limit: 10 });
      const { data: row } = await db()
        .from("email_outbox")
        .select("status,last_error")
        .eq("id", id as string)
        .maybeSingle();
      const r = row as { status: string; last_error: string | null } | null;
      return { to, status: r?.status ?? "queued", error: r?.last_error ?? null, summary };
    }

    // Before the email tables exist: send straight through Resend.
    const rendered = renderEmail(def.id, def.sample, { isTest: true });
    const result = await sendViaResend({
      from: rendered.from,
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      replyTo: rendered.replyTo,
      headers: rendered.headers,
      tags: [{ name: "category", value: "test" }],
      idempotencyKey: `yooits-test-${crypto.randomUUID()}`,
    });
    return result.ok
      ? { to, status: "sent", error: null, summary: null }
      : { to, status: "failed", error: result.error, summary: null };
  });

export const runEmailQueueNow = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    return runDispatch({ limit: 50 });
  });

const announcementInput = z.object({
  subject: z.string().trim().min(3).max(120),
  heading: z.string().trim().min(3).max(120),
  body: z.string().trim().min(10).max(4000),
  button_label: z.string().trim().max(40).optional(),
  button_url: z.string().trim().url().max(500).optional(),
  /** "test" sends to the admin only. "everyone" needs confirm = "SEND". */
  mode: z.enum(["test", "everyone"]),
  confirm: z.string().optional(),
});

/**
 * Announcements go only to people who switched on "News from Yooits".
 * A real send needs the marketing switch on, the postal address in the
 * footer, and the word SEND typed in the Owner Console.
 */
export const sendAnnouncement = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(announcementInput)
  .handler(async ({ context, data }) => {
    await requireAdmin(context.userId);
    const payload = {
      subject: data.subject,
      heading: data.heading,
      body: data.body,
      button_label: data.button_label || null,
      button_url: data.button_url && /^https:\/\//.test(data.button_url) ? data.button_url : null,
    };
    if (!resendConfigured())
      throw new Error("The email sender isn't connected yet (RESEND_API_KEY).");
    if (!(await databaseReady())) throw new Error("The email tables aren't in the database yet.");

    if (data.mode === "test") {
      const to = await adminAddress();
      const { error } = await db().rpc("email_queue", {
        _template: "announcement",
        _category: "marketing",
        _user_id: context.userId,
        _payload: payload,
        _dedupe_key: `test:${crypto.randomUUID()}`,
        _to_email: to,
        _is_test: true,
        _created_by: context.userId,
      });
      if (error) throw new Error(error.message);
      await runDispatch({ limit: 10 });
      return { mode: "test" as const, to, queued: 1 };
    }

    if (data.confirm !== "SEND") throw new Error("Type SEND to confirm.");
    if (!MAILING_ADDRESS) throw new Error("Add the postal address for the email footer first.");
    const { data: s } = await db()
      .from("email_settings")
      .select("marketing_enabled,sending_enabled")
      .maybeSingle();
    const settings = s as { marketing_enabled: boolean; sending_enabled: boolean } | null;
    if (!settings?.sending_enabled || !settings.marketing_enabled) {
      throw new Error("Turn on email sending and News from Yooits in the settings first.");
    }

    const batch = crypto.randomUUID();
    let queued = 0;
    for (let from = 0; ; from += 500) {
      const { data: rows, error } = await db()
        .from("email_preferences")
        .select("user_id")
        .eq("marketing", true)
        .range(from, from + 499);
      if (error) throw new Error(error.message);
      const ids = (rows ?? []) as { user_id: string }[];
      for (const r of ids) {
        const { data: id, error: qErr } = await db().rpc("email_queue", {
          _template: "announcement",
          _category: "marketing",
          _user_id: r.user_id,
          _payload: payload,
          _dedupe_key: `announcement:${batch}:${r.user_id}`,
          _created_by: context.userId,
        });
        if (qErr && isMissingFunction(qErr))
          throw new Error("The email tables aren't in the database yet.");
        if (id) queued++;
      }
      if (ids.length < 500) break;
    }
    await db()
      .from("admin_audit_log")
      .insert({
        actor_user_id: context.userId,
        action: "email.announcement",
        target_type: "announcement",
        target_id: batch,
        details: { subject: data.subject, queued },
      });
    return { mode: "everyone" as const, to: null, queued };
  });
