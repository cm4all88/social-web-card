import { Link } from "@tanstack/react-router";
import {
  LEGAL_DETAILS,
  LEGAL_DOCUMENTS,
  LEGAL_LAST_UPDATED,
  type LegalDocument,
} from "@/lib/legal/documents";
import { socialLinks, useSiteSettings } from "@/lib/site/settings";

/** Renders one legal document. */
export function LegalPage({ doc }: { doc: LegalDocument }) {
  return (
    <div className="min-h-screen px-4 py-10">
      <article className="mx-auto max-w-2xl">
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
  const site = useSiteSettings();
  const socials = socialLinks(site);
  return (
    <nav aria-label="Legal" className={`flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground ${className}`}>
      {socials.length > 0 && (
        <span className="flex basis-full flex-wrap justify-center gap-x-4 gap-y-1">
          {socials.map((s) => (
            <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
              {s.label}
            </a>
          ))}
        </span>
      )}
      {LEGAL_DOCUMENTS.map((d) => (
        <Link key={d.slug} to="/legal/$doc" params={{ doc: d.slug }} className="hover:text-foreground">
          {d.title}
        </Link>
      ))}
      <a href={`mailto:${site.support_email}`} className="hover:text-foreground">
        Contact
      </a>
      <span className="basis-full text-center">
        {site.site_name} is owned and operated by {LEGAL_DETAILS.operator}.
      </span>
    </nav>
  );
}
