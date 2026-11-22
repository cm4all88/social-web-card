/**
 * Yooits legal pages.
 *
 * DRAFTS. None of this has been reviewed by an attorney. Every page says so
 * at the top, and the bracketed placeholders must be filled in before the
 * drafts are relied on. Keep the wording consistent with the product bible:
 * a flat $0.50 supporter fee on tips, free wishlists, no peer-to-peer money
 * transfers, and live payments off until Stripe approves the tipping model.
 */

export type LegalSection = { heading: string; paragraphs: string[] };

export type LegalDocument = {
  slug: string;
  title: string;
  summary: string;
  sections: LegalSection[];
};

export const LEGAL_DRAFT_NOTICE =
  "Draft. This page has not been reviewed by an attorney and may change before Yooits relies on it.";

export const LEGAL_LAST_UPDATED = "November 22, 2026";

/** Filled in before publication. Shown as-is on the draft pages. */
/**
 * Who runs Yooits. Yooits is the product and public brand; the legal owner and
 * operator is the company below. Change the legal name here only: every page
 * reads it from this one place. (Owner's correction, Nov 21, 2026.)
 * The pages stay marked as drafts until an attorney reviews them.
 */
export const LEGAL_DETAILS = {
  brand: "Yooits",
  site: "yooits.me",
  operator: "Tahoma Industries LLC",
  contact: "admin@tahomaindustries.com",
  governingLaw: "the State of Washington",
  minimumAge: "13",
} as const;

const P = LEGAL_DETAILS;

const terms: LegalDocument = {
  slug: "terms",
  title: "Terms of Service",
  summary: "The rules for using Yooits.",
  sections: [
    {
      heading: "Who we are",
      paragraphs: [
        `${P.brand} (${P.site}) is owned and operated by ${P.operator}, a Washington company ("Yooits", "we"). By creating an account or using the site you agree to these terms, the Privacy Policy and the Acceptable Use Policy.`,
      ],
    },
    {
      heading: "What Yooits is",
      paragraphs: [
        "Yooits lets you publish a public profile page with your links, a theme, an avatar and wishlists. Eligible creators may later be able to receive tips for their content or services.",
        "Yooits is not a bank, a money transmitter or a peer-to-peer payment service, and must not be used as one.",
      ],
    },
    {
      heading: "Your account",
      paragraphs: [
        `You must be at least ${P.minimumAge} years old to create an account, and at least 18 to receive tips. Give accurate information and keep your password safe. You are responsible for what happens under your account.`,
        "Usernames are first come, first served. We may reclaim a username that is reserved, misleading, impersonates someone, or infringes someone's rights.",
      ],
    },
    {
      heading: "Your content",
      paragraphs: [
        "You keep ownership of what you post. You give Yooits a non-exclusive, worldwide, royalty-free licence to host, display and share it as needed to run the service.",
        "You are responsible for your content and the links you share, including that you have the right to share them.",
      ],
    },
    {
      heading: "Links and wishlists",
      paragraphs: [
        "Links and wishlist items point to other websites. We don't control those sites, and purchases you make there are between you and the retailer. Yooits doesn't collect shipping addresses, hold carts or take payment for wishlist items. Wishlists are free.",
      ],
    },
    {
      heading: "Tips",
      paragraphs: [
        "Tipping is not yet available. When it is, it will be offered only to creators the Yooits owner approves, for content or services they provide, and it will be governed by the Creator Payment Terms.",
      ],
    },
    {
      heading: "Yooits Plus",
      paragraphs: [
        "Yooits Plus is an optional plan with extra profile features, such as premium themes and the option to hide the Yooits line on your page. Links stay free and unlimited on every plan.",
        "When Plus is offered for sale it costs $4.99 a month in US dollars, charged through Stripe. It renews automatically each month until you cancel. You can cancel at any time from your dashboard; Plus then stays on until the end of the month you have paid for and doesn't renew. We don't give refunds for part of a month unless the law requires it.",
        "If we change the price, we will tell you before it applies to you, and you can cancel before then. Founding Members' free months of Plus need no card, don't renew and never turn into a paid plan by themselves. A Founding Member can choose to keep Plus after the free months; the first charge is then made when the free months end.",
        "When Plus ends, your page goes back to the free look. Nothing you made is deleted, and your Plus settings come back if you return to Plus.",
      ],
    },
    {
      heading: "Our rights",
      paragraphs: [
        "We may hide, unpublish or remove content, stop tips, or suspend or close an account that breaks these terms or the Acceptable Use Policy, or that puts users, Yooits or our payment partners at risk. Where we can, we will tell you why.",
        "We may change or stop features. Paid features, if any, will be described before you buy them.",
      ],
    },
    {
      heading: "Disclaimers and liability",
      paragraphs: [
        'Yooits is provided "as is", without warranties of any kind, to the extent the law allows. To the extent the law allows, Yooits is not liable for indirect or consequential losses, and our total liability for any claim is limited to the amount you paid Yooits in the 12 months before it.',
      ],
    },
    {
      heading: "Ending your account",
      paragraphs: [
        "You can stop using Yooits at any time. You can delete your account yourself from the Account section of your dashboard.",
      ],
    },
    {
      heading: "Changes and law",
      paragraphs: [
        "We may update these terms. If a change is significant we will tell you before it takes effect. Continuing to use Yooits after that means you accept the new terms.",
        `These terms are governed by the laws of ${P.governingLaw}, United States.`,
        `Questions: ${P.contact}.`,
      ],
    },
  ],
};

const privacy: LegalDocument = {
  slug: "privacy",
  title: "Privacy Policy",
  summary: "What Yooits collects, why, and your choices.",
  sections: [
    {
      heading: "Who we are",
      paragraphs: [
        `${P.brand} (${P.site}) is owned and operated by ${P.operator}, which is responsible for the information described here. Contact: ${P.contact}.`,
      ],
    },
    {
      heading: "What we collect",
      paragraphs: [
        "Account details: your email address, password (stored only as a secure hash by our sign-in provider), username and display name.",
        "Profile content: your avatar, links, theme and wishlists. Anything you publish on your profile or a public wishlist is visible to anyone. Private wishlists are visible only to you.",
        "Tips, once available: the amount, the Yooits fee, the supporter's optional name and message, and payment references from Stripe. Card details are entered on Stripe's pages and never reach Yooits.",
        "Reports: if you report a page or wishlist, we keep the reason, what you write, and your email if you choose to give it. The person you report doesn't see who sent it.",
        "Plus billing, if you pay for Plus: your Stripe customer and subscription references, the plan's status and renewal date. Card details are entered on Stripe's pages and never reach Yooits.",
        "Security data: to stop abuse we keep a one-way, salted hash of the IP address used to start a tip checkout or send a report, not the address itself. If our bot check is switched on, Cloudflare processes your browser's response to it.",
      ],
    },
    {
      heading: "Page analytics",
      paragraphs: [
        "When someone visits a Yooits page or wishlist, or taps a link on it, we record that it happened, which link was tapped and where the visit came from: the referring website, the app's in-app browser, any campaign (UTM) tags in the address, the kind of device and the country. Page owners see these totals for their own page on their dashboard, and Yooits uses site-wide totals to run and improve the service.",
        "We don't store IP addresses for this, use cookies for it, or follow visitors across other websites. To count unique visitors we keep a salted one-way hash of the IP address and browser that changes every day, so a visitor can't be recognised from one day to the next. If your browser sends Do Not Track or Global Privacy Control, your visit isn't recorded. Known bots and link-preview fetchers aren't counted. A page's analytics are deleted with the account.",
      ],
    },
    {
      heading: "How we use it",
      paragraphs: [
        "To run your account and public pages, to process and report tips and Plus payments, to prevent fraud and abuse, to answer you, and to meet legal duties. We don't sell your personal information and we don't show third-party advertising on profiles.",
      ],
    },
    {
      heading: "Who we share it with",
      paragraphs: [
        "Service providers that run Yooits for us: Vercel (hosting), Supabase (database, sign-in and file storage), Stripe (payments, once available), Cloudflare (bot check, if switched on) and our email provider for account emails. We also share information when the law requires it or to protect users and Yooits.",
      ],
    },
    {
      heading: "Cookies and storage",
      paragraphs: [
        "We store your sign-in session in your browser so you stay signed in. We don't use advertising cookies.",
      ],
    },
    {
      heading: "Keeping and deleting data",
      paragraphs: [
        `We keep your information while your account is open. You can edit or remove your profile content at any time. You can delete your account from the Account section of your dashboard; that removes your profile, links, wishlists and sign-in. To ask for a copy of your information, contact us at ${P.contact}. We keep tip, Plus billing and other payment records for as long as tax and payment rules require; if you delete your account they are kept without your account attached.`,
      ],
    },
    {
      heading: "Children",
      paragraphs: [
        `Yooits is not for children under ${P.minimumAge}. If you believe a child under ${P.minimumAge} has an account, email ${P.contact} and we will remove it.`,
      ],
    },
    {
      heading: "Changes and contact",
      paragraphs: [
        "We will post changes here and tell you about significant ones.",
        `Questions or requests: ${P.contact}.`,
      ],
    },
  ],
};

const acceptableUse: LegalDocument = {
  slug: "acceptable-use",
  title: "Acceptable Use Policy",
  summary: "What you can't do on Yooits.",
  sections: [
    {
      heading: "Don't use Yooits to",
      paragraphs: [
        "Break the law, or link to or promote anything illegal.",
        "Harass, threaten, bully or impersonate anyone, or share someone's private information without their consent.",
        "Post or link to sexual content involving minors, non-consensual intimate images, or content that promotes violence or hate.",
        "Spread malware, phishing, scams or deceptive links.",
        "Send spam, run fake accounts, or use bots to create accounts or inflate activity.",
        "Sell or promote regulated goods or services you aren't allowed to sell, such as drugs, weapons or gambling.",
        "Collect money for anything other than content or services you provide, or present Yooits as a way to send money between people.",
        "Interfere with the site, test its security without permission, or get around limits or suspensions.",
      ],
    },
    {
      heading: "Tips and payments",
      paragraphs: [
        "Tips must be for real content or services. Tipping yourself, arranging tips with others to move money, or using tips for gifts, loans, fundraising or resale is not allowed. Stripe's own rules on restricted businesses also apply.",
      ],
    },
    {
      heading: "What happens if you break these rules",
      paragraphs: [
        `We may remove content, hide your profile, stop your tips, or suspend or close your account. To report a page or a wishlist, use the Report link at the bottom of it, or email ${P.contact} with its address and what is wrong. We review every report.`,
      ],
    },
  ],
};

const creatorPaymentTerms: LegalDocument = {
  slug: "creator-payment-terms",
  title: "Creator Payment Terms",
  summary: "How tips will work for creators. Tipping is not yet available.",
  sections: [
    {
      heading: "Status",
      paragraphs: [
        "Tipping is not yet available on Yooits. These terms describe how it will work once Stripe has approved it and the Yooits owner has switched it on.",
      ],
    },
    {
      heading: "Who can receive tips",
      paragraphs: [
        "Tips are for creators and service providers who are at least 18, in the United States, and who receive tips for content or services they provide. Tips are not personal gifts, loans or money transfers. Each creator needs the Yooits owner's approval before tips are switched on, and must complete Stripe's account setup.",
      ],
    },
    {
      heading: "Payments go through Stripe",
      paragraphs: [
        "Tips are processed by Stripe through your own connected Stripe account. You agree to Stripe's Connected Account Agreement. Yooits never holds your money; payouts come from Stripe on Stripe's schedule.",
      ],
    },
    {
      heading: "Amounts and fees",
      paragraphs: [
        `Tips are in US dollars, from $5 to $500. The supporter pays a flat $0.50 Yooits service fee on top of the tip, shown separately at checkout and collected by ${P.operator}. Yooits takes no percentage of the tip. Stripe's processing fees are deducted from the payment to your Stripe account.`,
      ],
    },
    {
      heading: "Refunds and disputes",
      paragraphs: [
        "You can refund a tip from your dashboard; the $0.50 fee is refunded with it. If a supporter disputes a payment, Stripe's dispute process applies, and any dispute amount and fee is charged to your Stripe account.",
      ],
    },
    {
      heading: "Taxes",
      paragraphs: [
        "You are responsible for any taxes on tips you receive. Stripe may ask for tax information and issue tax forms.",
      ],
    },
    {
      heading: "Stopping tips",
      paragraphs: [
        "Yooits may pause or stop tips on an account, or withhold approval, if it breaks these terms or the Acceptable Use Policy or puts supporters, Yooits or Stripe at risk. You can disconnect your Stripe account at any time.",
        `Questions: ${P.contact}.`,
      ],
    },
  ],
};

export const LEGAL_DOCUMENTS: LegalDocument[] = [terms, privacy, acceptableUse, creatorPaymentTerms];

export function getLegalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((d) => d.slug === slug);
}
