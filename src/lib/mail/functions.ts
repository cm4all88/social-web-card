/**
 * Owner Mail server functions for the Owner Console (/owner/mail).
 *
 * Every call checks, on the server, that the caller is signed in and is a
 * Yooits.me admin, and only ever reads that admin's own connected mailbox.
 * Google tokens never leave the server.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { attachSupabaseAuth } from "@/integrations/supabase/attach-auth";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  beginConnect,
  disconnect,
  getAccount,
  googleConfigured,
  MailNotConnectedError,
  MailReconnectError,
  redirectUri,
} from "./google.server";
import {
  createLabel,
  getThread,
  listLabels,
  listThreads,
  modifyThread,
  prepare,
  send,
  sendAsList,
  trashThread,
} from "./mailbox.server";

const db = () => supabaseAdmin as unknown as SupabaseClient;

async function requireAdmin(userId: string): Promise<void> {
  const { data, error } = await db().rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error || data !== true) throw new Error("Only the Yooits.me owner can use Mail.");
}

function origin(): string {
  const req = getRequest();
  return new URL(req.url).origin;
}

/** Turns "sign in again" into a value the page can show instead of an error. */
async function guarded<T>(fn: () => Promise<T>): Promise<T | { reconnect: true; message: string }> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof MailReconnectError || e instanceof MailNotConnectedError)
      return { reconnect: true, message: e.message };
    throw e;
  }
}

export const getMailStatus = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const configured = googleConfigured();
    const account = await getAccount(context.userId);
    let sendAs: Awaited<ReturnType<typeof sendAsList>> = [];
    let problem: string | null = null;
    if (configured && account?.status === "connected") {
      try {
        sendAs = await sendAsList(context.userId);
      } catch (e) {
        problem = e instanceof Error ? e.message : "Gmail didn't answer.";
      }
    }
    const fresh = configured ? await getAccount(context.userId) : account;
    return {
      configured,
      redirectUri: redirectUri(origin()),
      account: fresh,
      sendAs,
      problem,
    };
  });

export const startMailConnect = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(z.object({ loginHint: z.string().email().max(254).optional() }))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.userId);
    if (!googleConfigured()) throw new Error("Google sign-in isn't set up on the server yet.");
    return { url: await beginConnect(context.userId, origin(), data.loginHint ?? null) };
  });

export const disconnectMail = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    await disconnect(context.userId);
    return { ok: true };
  });

export const mailLabels = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    return guarded(() => listLabels(context.userId));
  });

export const mailCreateLabel = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(z.object({ name: z.string().trim().min(1).max(100) }))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.userId);
    return guarded(() => createLabel(context.userId, data.name));
  });

export const mailThreads = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(
    z.object({
      label: z.string().max(64).nullable().optional(),
      q: z.string().max(500).nullable().optional(),
      pageToken: z.string().max(200).nullable().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    await requireAdmin(context.userId);
    return guarded(() => listThreads(context.userId, data));
  });

export const mailThread = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().max(64), showImages: z.boolean().optional() }))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.userId);
    return guarded(() => getThread(context.userId, data.id, !!data.showImages));
  });

const labelList = z.array(z.string().max(64)).max(10);

export const mailModify = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(
    z.object({
      id: z.string().max(64),
      add: labelList.default([]),
      remove: labelList.default([]),
      trash: z.enum(["trash", "restore"]).optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    await requireAdmin(context.userId);
    return guarded(async () => {
      if (data.trash) await trashThread(context.userId, data.id, data.trash === "restore");
      else await modifyThread(context.userId, data.id, data.add, data.remove);
      return { ok: true as const };
    });
  });

export const mailPrepare = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(
    z.object({ mode: z.enum(["reply", "replyAll", "forward"]), messageId: z.string().max(64) }),
  )
  .handler(async ({ context, data }) => {
    await requireAdmin(context.userId);
    return guarded(async () => {
      const me = (await sendAsList(context.userId)).map((s) => s.email);
      return prepare(context.userId, data.mode, data.messageId, me);
    });
  });

const sendInput = z.object({
  mode: z.enum(["new", "reply", "replyAll", "forward"]),
  messageId: z.string().max(64).nullable().optional(),
  from: z.string().email().max(254),
  to: z.string().max(4000),
  cc: z.string().max(4000).optional(),
  bcc: z.string().max(4000).optional(),
  subject: z.string().max(300),
  body: z.string().max(200_000),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1).max(200),
        mimeType: z.string().max(120),
        base64: z.string().max(4_500_000),
      }),
    )
    .max(10)
    .optional(),
  keepAttachments: z.boolean().optional(),
});

/** Sends only when the owner presses Send in the Owner Console. */
export const mailSend = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(sendInput)
  .handler(async ({ context, data }) => {
    await requireAdmin(context.userId);
    return guarded(async () => {
      const aliases = await sendAsList(context.userId);
      return send(context.userId, data, aliases);
    });
  });
