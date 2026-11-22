/** "Message" button on a profile. Shown only to signed-in people who could message this person. */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { dm, hidesMessageButton, type CanMessage } from "@/lib/messages/api";

export function MessageButton({
  username,
  style,
  className,
}: {
  username: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  const [check, setCheck] = useState<CanMessage | null>(null);

  useEffect(() => {
    let live = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      dm("dm_can_message", { _username: username }).then(
        (c) => live && setCheck(c),
        () => {},
      );
    });
    return () => {
      live = false;
    };
  }, [username]);

  if (!check || hidesMessageButton(check.status)) return null;
  const inner = (
    <>
      <MessageCircle className="h-5 w-5" /> Message
    </>
  );
  return check.conversation_id ? (
    <Link
      to="/messages/$conversationId"
      params={{ conversationId: check.conversation_id }}
      className={className}
      style={style}
    >
      {inner}
    </Link>
  ) : (
    <Link to="/messages" search={{ to: username }} className={className} style={style}>
      {inner}
    </Link>
  );
}
