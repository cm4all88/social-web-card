/** Dashboard header link to Messages, with the unread count. Hidden until messages are available. */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dm } from "@/lib/messages/api";

export function MessagesNavButton() {
  const [available, setAvailable] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let live = true;
    const poll = () =>
      dm("dm_unread_count", {}).then(
        (n) => live && setUnread(n),
        () => {},
      );
    dm("dm_my_settings", {}).then(
      (s) => {
        if (!live || !s.available) return;
        setAvailable(true);
        poll();
      },
      () => {},
    );
    const id = setInterval(() => {
      if (document.visibilityState === "visible") poll();
    }, 60_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  if (!available) return null;
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link to="/messages" aria-label={unread > 0 ? `Messages, ${unread} unread` : "Messages"}>
        <MessageCircle className="mr-2 h-4 w-4" />
        <span className="hidden sm:inline">Messages</span>
        {unread > 0 && (
          <span className="ml-1 rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Link>
    </Button>
  );
}
