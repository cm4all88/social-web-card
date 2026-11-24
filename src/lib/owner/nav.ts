/**
 * Owner console sections, in the order the menu shows them, grouped. Every
 * section here is a working page; there are no placeholders.
 */
export const OWNER_GROUPS = ["Home", "People", "Money", "Safety", "Outreach", "Console"] as const;
export type OwnerGroup = (typeof OWNER_GROUPS)[number];

export type OwnerSection = {
  id: string;
  label: string;
  to: string;
  group: OwnerGroup;
  /** One line for the overview page. */
  summary: string;
};

export const OWNER_SECTIONS: OwnerSection[] = [
  {
    id: "overview",
    label: "Overview",
    to: "/owner",
    group: "Home",
    summary: "Headline numbers.",
  },
  {
    id: "analytics",
    label: "Analytics",
    to: "/owner/analytics",
    group: "Home",
    summary: "Users, traffic, destinations, platforms, conversions and growth.",
  },
  {
    id: "users",
    label: "Users",
    to: "/owner/users",
    group: "People",
    summary: "Find people and see their account.",
  },
  {
    id: "invites",
    label: "Invites",
    to: "/owner/invites",
    group: "People",
    summary: "Invite codes: single use or shared, with expiry, revoking and who used them.",
  },
  {
    id: "founding",
    label: "Founding Members",
    to: "/owner/founding",
    group: "People",
    summary: "Founding Member invites, members and feedback.",
  },
  {
    id: "promotions",
    label: "Promotions",
    to: "/owner/promotions",
    group: "People",
    summary: "Campaign codes with free Plus, eligibility, limits and a report.",
  },
  {
    id: "money",
    label: "Money",
    to: "/owner/revenue",
    group: "Money",
    summary: "Tip revenue and stopping tips for a creator.",
  },
  {
    id: "payments",
    label: "Payments",
    to: "/owner/payments",
    group: "Money",
    summary: "The Stripe account, setting it up, and which payment features are ready to switch on.",
  },
  {
    id: "creators",
    label: "Creators",
    to: "/owner/creators",
    group: "Money",
    summary: "Qualifying visitors, milestones, creator applications, prices, fees, posts and Support Offerings.",
  },
  {
    id: "reports",
    label: "Reports",
    to: "/owner/reports",
    group: "Safety",
    summary: "Pages, wishlists and messages people have reported.",
  },
  {
    id: "wishlists",
    label: "Wishlists",
    to: "/owner/wishlists",
    group: "Safety",
    summary: "Every wishlist, claiming, gift money and affiliate status, and hiding a list.",
  },
  {
    id: "messaging",
    label: "Messages",
    to: "/owner/messaging",
    group: "Safety",
    summary: "Turn direct messages on or off and see how they're used.",
  },
  {
    id: "blocked-sites",
    label: "Blocked sites",
    to: "/owner/blocked-sites",
    group: "Safety",
    summary: "Sites links may not point to, and exceptions for mistakes.",
  },
  {
    id: "marketing",
    label: "Marketing",
    to: "/owner/marketing",
    group: "Outreach",
    summary: "Campaigns, post drafts and approval, the publishing calendar, social accounts and what campaigns bring in.",
  },
  {
    id: "announcements",
    label: "Announcements",
    to: "/owner/announcements",
    group: "Outreach",
    summary: "Dashboard announcements and the notifications switch.",
  },
  {
    id: "email",
    label: "Email",
    to: "/owner/email",
    group: "Outreach",
    summary: "Email templates, test sends, announcements and delivery.",
  },
  {
    id: "mail",
    label: "Mail",
    to: "/owner/mail",
    group: "Outreach",
    summary: "Your Gmail inbox: read, search, reply and send, plus system email delivery.",
  },
  {
    id: "settings",
    label: "Settings",
    to: "/owner/settings",
    group: "Console",
    summary: "Site name, tagline, contact email, Yooits.me social links, email defaults and feature switches.",
  },
  {
    id: "audit",
    label: "Audit log",
    to: "/owner/audit",
    group: "Console",
    summary: "Every owner action, newest first.",
  },
];

/** The sections of one group, in menu order. */
export function sectionsIn(group: OwnerGroup): OwnerSection[] {
  return OWNER_SECTIONS.filter((s) => s.group === group);
}
