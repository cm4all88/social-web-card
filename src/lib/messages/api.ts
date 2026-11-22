/**
 * Direct messages: typed calls to the database functions from migration
 * 20261122140000_direct_messages.sql. Every rule (who may message whom,
 * blocks, rate limits, the 18+ confirmation) is enforced in the database;
 * these helpers only call it and turn its short codes into plain words.
 */
import { supabase } from "@/integrations/supabase/client";

export type MessageMode = "off" | "requests" | "everyone";

export type MySettings = {
  available: boolean;
  site_enabled: boolean;
  mode: MessageMode;
  adult_confirmed: boolean;
  suspended: boolean;
};

export type ConversationSummary = {
  id: string;
  status: "request" | "active" | "declined";
  last_message_at: string;
  created_at: string;
  i_requested: boolean;
  other_username: string | null;
  other_display_name: string | null;
  other_avatar_url: string | null;
  i_blocked: boolean;
  preview: string | null;
  preview_is_mine: boolean | null;
  unread: number;
};

export type Message = {
  id: string;
  mine: boolean;
  body: string | null;
  removed: boolean;
  created_at: string;
};

export type Conversation = {
  id: string;
  status: "request" | "active" | "declined";
  i_requested: boolean;
  other: { username: string; display_name: string | null; avatar_url: string | null } | null;
  i_blocked: boolean;
  /** Null when the caller can send; otherwise the reason they can't. */
  can_send: string | null;
  messages: Message[];
};

export type CanMessage = { status: string; conversation_id: string | null };

type Fns = {
  dm_my_settings: { args: Record<string, never>; result: MySettings };
  dm_set_mode: { args: { _mode: MessageMode; _confirm_adult?: boolean }; result: MySettings };
  dm_can_message: { args: { _username: string }; result: CanMessage };
  dm_start: {
    args: { _username: string; _body: string };
    result: { conversation_id: string; status: string };
  };
  dm_send: { args: { _conversation_id: string; _body: string }; result: string };
  dm_respond: { args: { _conversation_id: string; _accept: boolean }; result: string };
  dm_list_conversations: { args: Record<string, never>; result: ConversationSummary[] };
  dm_get_conversation: {
    args: { _conversation_id: string; _before?: string | null };
    result: Conversation;
  };
  dm_mark_read: { args: { _conversation_id: string }; result: null };
  dm_unread_count: { args: Record<string, never>; result: number };
  dm_set_block: { args: { _username: string; _blocked: boolean }; result: boolean };
  dm_list_blocks: {
    args: Record<string, never>;
    result: { username: string; display_name: string | null; created_at: string }[];
  };
  dm_report_message: {
    args: { _message_id: string; _reason: string; _details?: string | null };
    result: string;
  };
};

export const MESSAGE_MAX = 2000;

/** Plain-language text for the database's refusal codes. */
const CODES: Record<string, string> = {
  signed_out: "Sign in to use messages.",
  unavailable: "Messages aren't available yet.",
  suspended: "Messaging is turned off for your account.",
  not_found: "We couldn't find that conversation.",
  self: "You can't message yourself.",
  own_off: "Turn on messages in your settings first.",
  you_blocked: "You've blocked this person. Unblock them to send a message.",
  closed: "This person isn't accepting messages.",
  awaiting_accept: "You can send one message until they accept your request.",
  no_links_in_request: "Links can't be sent until they accept your request.",
  rate_limited: "You're sending messages too quickly. Please wait a moment.",
  too_many_new: "You've started a lot of conversations today. Please try again tomorrow.",
  empty: "Write a message first.",
  too_long: `Messages can be up to ${MESSAGE_MAX} characters.`,
  adult_required: "Please confirm you're 18 or older to turn on messages.",
};

export function messageError(codeOrMessage: string): string {
  const code = codeOrMessage.trim();
  return CODES[code] ?? "Something went wrong. Please try again.";
}

/** True for reasons that mean "you may not message this person", where the button should hide. */
export function hidesMessageButton(status: string): boolean {
  return !["ok", "request", "own_off"].includes(status);
}

export async function dm<K extends keyof Fns>(
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
  if (error) throw new Error(messageError(error.message));
  return data as Fns[K]["result"];
}

/** Short relative time for the inbox ("now", "5m", "3h", "2d", or a date). */
export function shortTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}
