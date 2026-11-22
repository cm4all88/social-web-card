/**
 * Google sign-in and Gmail API calls for Owner Mail. Server only.
 *
 * The Google client id and secret come from the server's environment
 * (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET). The owner's refresh
 * token lives in Supabase Vault and is read through service-role-only
 * database functions; access tokens are kept only in this server's memory
 * for their hour. Nothing here is ever sent to the browser.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { bytesToB64url } from "./mime";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
export const SCOPES = ["openid", "email", GMAIL_SCOPE];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_UPLOAD = "https://gmail.googleapis.com/upload/gmail/v1/users/me";
export const CALLBACK_PATH = "/api/owner/mail/callback";

const db = () => supabaseAdmin as unknown as SupabaseClient;

/** Thrown when Google no longer accepts the stored sign-in. */
export class MailReconnectError extends Error {}
/** Thrown when the owner hasn't connected a mailbox. */
export class MailNotConnectedError extends Error {}

export function googleConfigured(): boolean {
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() && process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  );
}

function client(): { id: string; secret: string } {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!id || !secret) throw new Error("Google sign-in isn't set up on the server yet.");
  return { id, secret };
}

export function redirectUri(origin: string): string {
  const fixed = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  return fixed || `${origin.replace(/\/+$/, "")}${CALLBACK_PATH}`;
}

export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

/** A new sign-in: state and PKCE verifier are saved (state hashed), the URL is returned. */
export async function beginConnect(ownerId: string, origin: string, loginHint?: string | null) {
  const { id } = client();
  const state = bytesToB64url(randomBytes(32));
  const verifier = bytesToB64url(randomBytes(48));
  const challenge = bytesToB64url(createHash("sha256").update(verifier).digest());
  const { error } = await db().rpc("owner_mail_begin", {
    _owner: ownerId,
    _state_hash: sha256Hex(state),
    _code_verifier: verifier,
  });
  if (error) throw new Error(error.message);
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (loginHint) params.set("login_hint", loginHint);
  return `${AUTH_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
    return payload.email_verified === false ? null : (payload.email ?? null);
  } catch {
    return null;
  }
}

/** Uses up a state without signing in (the owner said no at Google). */
export async function dropState(state: string): Promise<void> {
  await db().rpc("owner_mail_take_state", { _state_hash: sha256Hex(state) });
}

/** The callback: one-time state, code exchange, token saved to Vault. */
export async function finishConnect(
  state: string,
  code: string,
  origin: string,
): Promise<{ ok: true; email: string } | { ok: false; reason: string }> {
  const { data: taken, error } = await db().rpc("owner_mail_take_state", {
    _state_hash: sha256Hex(state),
  });
  if (error) return { ok: false, reason: "state" };
  const t = taken as { owner_user_id: string; code_verifier: string } | null;
  if (!t) return { ok: false, reason: "expired" };
  const { id, secret } = client();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
      code_verifier: t.code_verifier,
    }),
  });
  const tok = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !tok.access_token) return { ok: false, reason: "exchange" };
  const scopes = (tok.scope ?? "").split(/\s+/);
  if (!scopes.includes(GMAIL_SCOPE)) return { ok: false, reason: "scope" };
  if (!tok.refresh_token) return { ok: false, reason: "no_refresh" };
  const email = emailFromIdToken(tok.id_token);
  if (!email) return { ok: false, reason: "email" };
  const { error: saveErr } = await db().rpc("owner_mail_save_token", {
    _owner: t.owner_user_id,
    _google_email: email,
    _scopes: tok.scope ?? "",
    _refresh_token: tok.refresh_token,
  });
  if (saveErr) return { ok: false, reason: "save" };
  cache.set(t.owner_user_id, {
    token: tok.access_token,
    exp: Date.now() + (tok.expires_in ?? 3000) * 1000,
  });
  return { ok: true, email };
}

export type MailAccount = {
  google_email: string;
  status: "connected" | "needs_reconnect";
  last_error: string | null;
  connected_at: string;
};

export async function getAccount(ownerId: string): Promise<MailAccount | null> {
  const { data, error } = await db()
    .from("owner_mail_accounts")
    .select("google_email,status,last_error,connected_at")
    .eq("owner_user_id", ownerId)
    .maybeSingle();
  if (error) return null;
  return (data as MailAccount | null) ?? null;
}

/* ---------- access tokens ---------- */

const cache = new Map<string, { token: string; exp: number }>();

async function accessToken(ownerId: string, force = false): Promise<string> {
  const hit = cache.get(ownerId);
  if (!force && hit && hit.exp - 60_000 > Date.now()) return hit.token;
  const { data: refresh, error } = await db().rpc("owner_mail_token", { _owner: ownerId });
  if (error) throw new Error("Couldn't read the mailbox sign-in.");
  if (!refresh) throw new MailNotConnectedError("Gmail isn't connected.");
  const { id, secret } = client();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refresh as string,
      grant_type: "refresh_token",
    }),
  });
  const tok = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !tok.access_token) {
    cache.delete(ownerId);
    if (tok.error === "invalid_grant" || res.status === 400 || res.status === 401) {
      await db().rpc("owner_mail_mark_broken", {
        _owner: ownerId,
        _error: tok.error ?? `http ${res.status}`,
      });
      throw new MailReconnectError("Google asked to sign in again. Reconnect Gmail.");
    }
    throw new Error("Google didn't answer. Try again in a minute.");
  }
  cache.set(ownerId, {
    token: tok.access_token,
    exp: Date.now() + (tok.expires_in ?? 3000) * 1000,
  });
  return tok.access_token;
}

/* ---------- Gmail ---------- */

export class GmailError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call(ownerId: string, url: string, init: RequestInit = {}): Promise<Response> {
  let token = await accessToken(ownerId);
  const go = (t: string) =>
    fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` } });
  let res = await go(token);
  if (res.status === 401) {
    token = await accessToken(ownerId, true);
    res = await go(token);
  }
  if (res.status === 401 || res.status === 403) {
    const body = await res.text().catch(() => "");
    if (/insufficient|scope/i.test(body))
      throw new MailReconnectError("Gmail needs permission again. Reconnect Gmail.");
    throw new GmailError("Gmail refused that.", res.status);
  }
  return res;
}

/** JSON call to the Gmail API for the owner's mailbox. */
export async function gmail<T = unknown>(
  ownerId: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await call(ownerId, `${GMAIL}/${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) {
    let msg = `Gmail error ${res.status}`;
    try {
      msg = JSON.parse(text).error?.message ?? msg;
    } catch {
      /* keep */
    }
    throw new GmailError(msg, res.status);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Sends a full RFC 5322 message (any size up to Gmail's limit) in a thread. */
export async function gmailSendRaw(ownerId: string, raw: string, threadId?: string | null) {
  const boundary = `yooits_${randomBytes(12).toString("hex")}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(threadId ? { threadId } : {}),
    `--${boundary}`,
    "Content-Type: message/rfc822",
    "",
    raw,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const res = await call(ownerId, `${GMAIL_UPLOAD}/messages/send?uploadType=multipart`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `Gmail didn't send it (${res.status}).`;
    try {
      msg = JSON.parse(text).error?.message ?? msg;
    } catch {
      /* keep */
    }
    throw new GmailError(msg, res.status);
  }
  return JSON.parse(text) as { id: string; threadId: string; labelIds?: string[] };
}

/** Disconnect: tells Google to drop the access, then removes the stored token. */
export async function disconnect(ownerId: string): Promise<void> {
  try {
    const { data: refresh } = await db().rpc("owner_mail_token", { _owner: ownerId });
    if (refresh) {
      await fetch(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refresh as string }),
      });
    }
  } catch {
    /* the stored copy is removed either way */
  }
  cache.delete(ownerId);
  const { error } = await db().rpc("owner_mail_forget", { _owner: ownerId });
  if (error) throw new Error(error.message);
}

export async function audit(
  ownerId: string,
  action: "mail.sent" | "mail.trashed",
  target: string,
  details: object,
) {
  await db().rpc("owner_mail_audit", {
    _owner: ownerId,
    _action: action,
    _target_id: target,
    _details: details,
  });
}

/** For tests. */
export function _clearTokenCache() {
  cache.clear();
}
