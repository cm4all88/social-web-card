/**
 * Turns the weekly numbers into a short summary and a few recommendations.
 * Plain rules on real counts; nothing is guessed when there's no data.
 */
import { PLATFORMS, type PlatformId } from "./platforms";

export type Weekly = {
  this: {
    published: number;
    failed: number;
    campaign_visits: number;
    home_views: number;
    signup_clicks: number;
    signups: number;
    attributed_signups: number;
    profile_completions: number;
  };
  last: {
    published: number;
    campaign_visits: number;
    home_views: number;
    signup_clicks: number;
    signups: number;
    attributed_signups: number;
  };
  sources: { source: string | null; visits: number }[];
  due_now: number;
  awaiting_approval: number;
  scheduled_next_7: number;
  approved_unscheduled: number;
  stuck_publishing: number;
};

export type PlatformRow = {
  platform: PlatformId;
  visits: number;
  signups: number;
  completions: number;
  paid: number;
  published: number;
};

export function change(now: number, before: number): string {
  if (before === 0) return now === 0 ? "no change" : `up from 0`;
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? "no change" : pct > 0 ? `up ${pct}%` : `down ${Math.abs(pct)}%`;
}

export function recommendations(w: Weekly, platforms: PlatformRow[] = []): string[] {
  const out: string[] = [];
  if (w.stuck_publishing > 0)
    out.push(
      `${w.stuck_publishing} post${w.stuck_publishing === 1 ? " has" : "s have"} been due for over a day. Post them or mark them failed so the calendar stays true.`,
    );
  if (w.due_now > 0)
    out.push(
      `${w.due_now} post${w.due_now === 1 ? " is" : "s are"} due now. Open Queue > Due to post.`,
    );
  if (w.scheduled_next_7 < 5 && (w.awaiting_approval > 0 || w.approved_unscheduled > 0)) {
    out.push(
      `Only ${w.scheduled_next_7} post${w.scheduled_next_7 === 1 ? "" : "s"} scheduled for the next 7 days. ${w.awaiting_approval} draft${w.awaiting_approval === 1 ? " is" : "s are"} waiting for approval.`,
    );
  } else if (w.scheduled_next_7 === 0) {
    out.push(
      "Nothing is scheduled for the next 7 days. Load the launch plan or generate a few posts.",
    );
  }
  if (w.this.failed > 0)
    out.push(
      `${w.this.failed} post${w.this.failed === 1 ? "" : "s"} failed this week. Retry them from the Queue, or move them back to draft.`,
    );
  if (w.this.published > 0 && w.this.campaign_visits === 0) {
    out.push(
      "Posts went out but no one arrived through a campaign link. Check the link is in each bio and in the X and Facebook posts.",
    );
  }
  if (w.this.signup_clicks > 0 && w.this.signups < w.this.signup_clicks / 4) {
    out.push(
      `${w.this.signup_clicks} people tapped "Claim your link" but ${w.this.signups} signed up. Worth trying the sign-up page on a phone to see where it sticks.`,
    );
  }
  if (w.this.signups > 0 && w.this.profile_completions < w.this.signups / 2) {
    out.push(
      `${w.this.profile_completions} of ${w.this.signups} new accounts finished their profile. A tutorial post on setup could help.`,
    );
  }
  const ranked = platforms
    .filter((p) => p.published > 0)
    .sort((a, b) => b.signups / b.published - a.signups / a.published);
  if (ranked.length >= 2 && ranked[0].signups > 0) {
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    out.push(
      `${PLATFORMS[best.platform].label} brought the most sign-ups per post (${best.signups} from ${best.published}). Consider moving a post a week from ${PLATFORMS[worst.platform].label} to it.`,
    );
  }
  if (!out.length) {
    out.push(
      w.this.published === 0
        ? "Nothing has gone out yet. Approve the first week of the launch plan to get started."
        : "Steady week. Keep the schedule going.",
    );
  }
  return out.slice(0, 5);
}
