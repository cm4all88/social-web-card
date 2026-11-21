import { Link } from "@tanstack/react-router";
import {
  LEGAL_DOCUMENTS,
  LEGAL_DRAFT_NOTICE,
  LEGAL_LAST_UPDATED,
  type LegalDocument,
} from "@/lib/legal/documents";

/** Renders one legal document, with the draft notice at the top. */
export function LegalPage({ doc }: { doc: LegalDocument }) {
  return (
    <div className="min-h-screen px-4 py-10">
      <article className="mx-auto max-w-2xl">
        <div
          role="note"
          className="mb-6 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
        >
          {LEGAL_DRAFT_NOTICE}
        </div>
        <h1 className="text-3xl font-bold">{doc.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Last updated {LEGAL_LAST_UPDATED}</p>
        {doc.sections.map((s) => (
          <section key={s.heading} className="mt-8">
            <h2 className="text-lg font-semibold">{s.heading}</h2>
            {s.paragraphs.map((p, i) => (
              <p key={i} className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {p}
              </p>
            ))}
          </section>
        ))}
        <LegalLinks className="mt-12" />
      </article>
    </div>
  );
}

/** A row of links to every legal page, for footers and the sign-up form. */
export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={`flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground ${className}`}>
      {LEGAL_DOCUMENTS.map((d) => (
        <Link key={d.slug} to="/legal/$doc" params={{ doc: d.slug }} className="hover:text-foreground">
          {d.title}
        </Link>
      ))}
    </nav>
  );
}
