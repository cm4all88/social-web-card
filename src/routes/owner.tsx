import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Menu } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { OWNER_SECTIONS } from "@/lib/owner/nav";

/**
 * Owner console layout (Yooits admins only). This check only decides what the
 * browser shows; every owner read and write is checked again in the database.
 */
export const Route = createFileRoute("/owner")({
  component: OwnerLayout,
  head: () => ({
    meta: [{ title: "Owner console — Yooits" }, { name: "robots", content: "noindex" }],
  }),
});

function OwnerNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Owner console" className="flex flex-col gap-1">
      {OWNER_SECTIONS.map((s) => (
        <Link
          key={s.id}
          to={s.to}
          onClick={onNavigate}
          activeOptions={{ exact: s.to === "/owner" }}
          className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          activeProps={{ className: "bg-muted font-medium text-foreground" }}
        >
          <span>{s.label}</span>
          {s.status === "planned" && (
            <span className="rounded-full border border-border px-2 text-[10px] uppercase tracking-wide">
              Soon
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

function OwnerLayout() {
  const navigate = useNavigate();
  const [state, setState] = useState<"checking" | "ok" | "denied">("checking");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return navigate({ to: "/auth" });
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.session.user.id);
      if (cancelled) return;
      const admin = (roles ?? []).some((r: { role: string }) => r.role === "admin");
      setState(admin ? "ok" : "denied");
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) navigate({ to: "/auth" });
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  if (state === "checking") {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (state === "denied") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-muted-foreground">The owner console is only for Yooits admins.</p>
        <Button asChild variant="secondary">
          <Link to="/dashboard">Go to your dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Toaster />
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64">
              <SheetTitle className="mb-4">Owner console</SheetTitle>
              <OwnerNav onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="font-semibold">Owner console</span>
        </div>
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> My dashboard
        </Link>
      </header>
      <div className="mx-auto flex max-w-6xl gap-8 px-4 py-8">
        <aside className="hidden w-52 shrink-0 md:block">
          <div className="sticky top-20">
            <OwnerNav />
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
