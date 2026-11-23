/**
 * The Yooits features marketing may talk about, because they work on
 * yooits.me today for everyone, for free. Every generated post is built only
 * from this list. Anything switched off or not public (tips, creator
 * subscriptions, gift money, Pro, Support Offerings, paid Plus checkout,
 * Founding Member invites) is deliberately absent; claims.ts blocks it too.
 *
 * When a feature ships or is switched off, change it here.
 */
export type FeatureId =
  | "page"
  | "links"
  | "themes"
  | "seasonal"
  | "effects"
  | "rewards"
  | "background"
  | "wishlists"
  | "gift_claims"
  | "messages"
  | "analytics"
  | "safety";

export type Audience = "creators" | "streamers" | "artists" | "small_business" | "everyone";

export type Feature = {
  id: FeatureId;
  name: string;
  /** One plain, true sentence about what it does. */
  claim: string;
  /** Short facts a post can lean on. Each must stay true. */
  facts: string[];
  /** A concrete thing to show on screen in a demo. */
  demo: string;
};

export const FEATURES: Record<FeatureId, Feature> = {
  page: {
    id: "page",
    name: "Your own page",
    claim: "Everyone gets a free page at yooits.me/yourname.",
    facts: ["Free to join", "You pick the username", "One link for your bio"],
    demo: "Type yooits.me/ and a username, and the page opens with every link on it.",
  },
  links: {
    id: "links",
    name: "Unlimited links",
    claim: "Add as many links as you want, free, and arrange them how you like.",
    facts: [
      "No cap on links on the free plan",
      "Drag to reorder",
      "Feature one link at the top",
      "Group links into sections",
      "Hide a link without deleting it",
      "Custom titles and icons",
      "Each link shows its own click count",
    ],
    demo: "Drag a link to the top, mark it featured, and drop two others into a section.",
  },
  themes: {
    id: "themes",
    name: "Themes",
    claim: "Twelve free themes, plus a custom theme with your own colors.",
    facts: ["12 free themes", "A custom theme with your own colors", "Switch any time"],
    demo: "Flip through a few themes on the same page, then set custom colors.",
  },
  seasonal: {
    id: "seasonal",
    name: "Seasonal themes",
    claim: "Seasonal themes show up for the time of year, like Snowfall for winter.",
    facts: ["Snowfall is free this winter", "Seasonal looks rotate through the year"],
    demo: "Switch the page to Snowfall.",
  },
  effects: {
    id: "effects",
    name: "Animated effects",
    claim: "Add a moving effect to your page: snow, leaves, hearts or stars.",
    facts: ["Snow, leaves, hearts or stars", "Turn it on or off in a tap"],
    demo: "Turn on falling snow, then swap it for hearts.",
  },
  rewards: {
    id: "rewards",
    name: "Rewards",
    claim: "Setting up your page unlocks extra themes as you go.",
    facts: [
      "Complete your profile",
      "Add 5 links",
      "Share your page for the first time",
      "Make your first wishlist",
      "A week on Yooits",
    ],
    demo: "Finish the profile and watch the new theme unlock.",
  },
  background: {
    id: "background",
    name: "Custom background",
    claim: "Pages that reach 1,000 visitors unlock a custom background image.",
    facts: ["Unlocks at 1,000 visitors"],
    demo: "Show the custom background on a page that has unlocked it.",
  },
  wishlists: {
    id: "wishlists",
    name: "Wishlists",
    claim: "Make wishlists, keep them private or share them, and show them on your page.",
    facts: [
      "Public or private",
      "Their own share link",
      "Show them on your profile",
      "Label who a list is for",
    ],
    demo: "Make a holiday list, add three items, and copy its share link.",
  },
  gift_claims: {
    id: "gift_claims",
    name: "Gift claims",
    claim: 'Friends tap "I\'ll buy it" on a wishlist item so nobody buys the same gift twice.',
    facts: ['"I\'ll buy it" marks an item as taken', "No more doubled-up gifts"],
    demo: 'Open a shared list as a friend and tap "I\'ll buy it".',
  },
  messages: {
    id: "messages",
    name: "Messages",
    claim: "Direct messages are opt-in, with blocking and reporting built in.",
    facts: ["You choose whether people can message you", "Block and report", "Safety controls"],
    demo: "Turn messages on, then show the block and report buttons.",
  },
  analytics: {
    id: "analytics",
    name: "Free analytics",
    claim: "See your page views, link clicks and where visitors came from, free.",
    facts: ["Views", "Clicks per link", "Where visitors came from"],
    demo: "Open the analytics tab and point at which link got the most taps.",
  },
  safety: {
    id: "safety",
    name: "Safety",
    claim: "Report buttons on pages and protection against people copying your username.",
    facts: ["Report button", "Username impersonation protection", "Notifications for what matters"],
    demo: "Show the report button and the notifications bell.",
  },
};

export const FEATURE_IDS = Object.keys(FEATURES) as FeatureId[];

export const AUDIENCES: Record<Audience, { label: string; who: string; angle: FeatureId[] }> = {
  creators: {
    label: "Creators",
    who: "people who post on several apps and only get one bio link",
    angle: ["links", "analytics", "themes", "background"],
  },
  streamers: {
    label: "Streamers",
    who: "streamers who need their schedule, socials and clips in one spot",
    angle: ["links", "effects", "analytics", "messages"],
  },
  artists: {
    label: "Artists",
    who: "artists and musicians showing off a portfolio, shop and releases",
    angle: ["themes", "links", "background", "seasonal"],
  },
  small_business: {
    label: "Small businesses",
    who: "small shops that need menus, booking, socials and reviews behind one link",
    angle: ["links", "analytics", "themes", "safety"],
  },
  everyone: {
    label: "Everyone",
    who: "anyone who wants one link for everything, and a wishlist people can actually use",
    angle: ["page", "wishlists", "gift_claims", "seasonal"],
  },
};
export const AUDIENCE_IDS = Object.keys(AUDIENCES) as Audience[];
