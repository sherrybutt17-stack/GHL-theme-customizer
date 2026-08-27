import type { SeedArticle } from "./types";

/** Campaigns, social, links and the deliverability rules that govern all of it. */
export const MARKETING: SeedArticle[] = [
  {
    slug: "sending-an-email-campaign",
    title: "Sending an email to a list of people",
    body: `Marketing in the sidebar is where one-to-many sending lives. A campaign goes to a segment; a reply to one person belongs in the inbox instead.

Build it in three decisions. Who: a saved list or a filter, and check the count before you go further. What: subject line, sender name, and the body. When: now, or scheduled.

Before you send, three checks that catch nearly everything. Send yourself a test and read it on a phone, because most people will. Check the personalisation actually filled in — a test to your own record with your own name proves nothing if the list has people missing a first name, so set a fallback. And confirm the unsubscribe link is present, which is a legal requirement in most places, not a style choice.

Sending to everybody every time is what kills a list. People who have not opened anything in six months should be sent to less often or not at all: they do not buy, and their non-engagement teaches mailbox providers to filter you for everybody else.

After it goes, opens are a soft signal and clicks are a real one. Judge on replies and bookings.`,
  },
  {
    slug: "building-an-email-template",
    title: "Building an email people will read",
    body: `The editor builds emails from blocks you drag into place: text, images, buttons, dividers, columns.

Restraint outperforms design here. A plain email that looks like a person wrote it consistently beats an elaborate newsletter layout for anything that asks for a reply. Save the designed template for announcements and keep the follow-up plain.

One clear action per email, and put it high enough to see without scrolling. Two competing buttons halve both.

Use fields for personalisation and set a fallback for every one of them. "Hi {first name}" with no fallback becomes "Hi ," for everybody who was imported without a first name, and that is usually more people than you think.

Check the mobile preview. A two-column layout that reads well on a laptop often stacks into nonsense on a phone, where most of it will be opened.

Save anything you will reuse as a template rather than duplicating the last campaign, which is how an old offer ends up in a new email.`,
  },
  {
    slug: "bulk-text-campaigns",
    title: "Sending a text to a lot of people",
    body: `Bulk texting works like an email campaign but the rules are stricter and the tolerance is lower.

You must have consent to text each person, your number must be registered for business messaging, and every message needs a way to opt out. Those are legal and carrier requirements, and they are enforced by messages simply not being delivered.

Keep it short and say who you are in the first few words. Include the opt-out. Long messages are split and billed as several.

Send at a civilised hour in the recipient's time, not yours. This is the channel where a mistimed message loses the customer entirely.

Start with a small batch. Carriers throttle sudden volume from a number with no history, and a first campaign to four thousand people will be filtered rather than delivered.

Watch the replies. Text gets answered far more than email, and a campaign nobody is staffed to answer produces a queue of annoyed people.`,
  },
  {
    slug: "trigger-links",
    title: "Links that know who clicked them",
    body: `A trigger link is a trackable link you put in an email or a text. When somebody clicks it, you know who, and a workflow can act on it.

That makes it the most useful signal available for intent, far better than an open. "Clicked the pricing link" is a person to call today.

Common uses: a link that tags somebody with their interest so you can follow up on the right thing; a link that starts a specific sequence; a link that removes somebody from a nurture because they have asked for a call.

Create the link once and reuse it across messages, so the numbers aggregate rather than fragmenting.

Two cautions. Some mailbox providers click every link in an email to scan it, so a single click with no other activity is not proof of a human — require a second signal before doing anything expensive. And a link in a text costs characters, so keep the rest of the message short.`,
  },
  {
    slug: "the-social-planner",
    title: "Scheduling social posts",
    body: `The social planner writes and schedules posts to your connected social accounts from one place, on a calendar, so a month of posting is an hour of work rather than a daily interruption.

Connect each account through the same permissions flow as the message channels, using a login that manages the page rather than merely following it.

Write once and adapt per network rather than posting identical text everywhere. Length, tone and image sizes differ enough that the lowest common denominator underperforms on all of them.

Schedule in batches and leave gaps for the things you cannot plan. A calendar full to the day leaves no room for the post that actually matters this week.

Connections expire the same way message channels do, usually after a password change, and the symptom is posts failing quietly. Check that a scheduled post actually published rather than assuming.

Comments and messages arriving in reply still need answering, and that happens in the inbox rather than here.`,
  },
  {
    slug: "affiliate-and-referral-tracking",
    title: "Tracking referrals and paying commission",
    body: `The affiliate tools let you give partners their own link, track what comes through it, and calculate what they are owed.

Set up a campaign with the commission rule — a percentage, a fixed amount, one-off or recurring — then add partners, each of whom gets a unique link and a login to see their own numbers.

Attribution is the part to decide early and write down: what counts as their sale, and for how long after the click. A referral that converts four months later either belongs to them or does not, and disagreements about that are far worse after the fact.

Payouts happen outside the system. Track what is owed here, pay it however you pay everyone else, and mark it paid.

Your best partners are usually existing customers rather than professional affiliates, and they respond to being asked directly rather than to a programme page.`,
  },
  {
    slug: "unsubscribes-and-compliance",
    title: "Consent, unsubscribes and staying within the rules",
    body: `The rules vary by country, but the parts that matter are consistent enough to work to.

Send only to people who agreed to hear from you. A bought list is not consent, and the damage is not only legal — it wrecks how mailbox providers judge your domain, which then filters your legitimate mail too.

Every marketing email needs a working unsubscribe and your real business address. Every marketing text needs a way to stop. Both must be honoured immediately and automatically, which they are: a stop word or an unsubscribe sets do-not-disturb on the record without anyone acting.

Keep the evidence. Where and when somebody opted in is worth recording, and a form submission does that for you.

Transactional messages — a receipt, an appointment reminder, a delivery update — are treated differently from marketing in most jurisdictions, but the line is narrower than people assume, and adding an offer to a receipt moves it across.

If you send to another country, the stricter rule applies. Design for the strictest and stop thinking about it.`,
  },
  {
    slug: "warming-up-a-new-sending-domain",
    title: "Why a new domain should not send in volume immediately",
    body: `Mailbox providers decide whether to deliver you based on history, and a brand new sending domain has none. A first send of several thousand from an unknown domain is the exact pattern of a spammer, so it gets filtered — and that first impression is expensive to undo.

Build up instead. A few dozen a day for the first week, a few hundred by the second, growing steadily over a fortnight or so. Boring, and it works.

Send to your most engaged people first. Opens and replies from real humans are the signal that establishes trust in the domain; sending to your coldest list first does the opposite.

Keep bounces low. Clean obviously bad addresses out of the list before you start, because a high bounce rate on early sends is read as a purchased list.

The same logic applies to a number that has never texted. Volume from nowhere gets filtered by carriers just as reliably.`,
  },
  {
    slug: "why-emails-go-to-spam",
    title: "Emails arriving in spam",
    body: `In order of how often it is the cause.

The sending domain is not properly authenticated. The records that prove you may send as that address — the ones added when you verified your sending domain — are missing, wrong, or were removed during a website move. This accounts for most cases on its own.

The list is not engaged. Sending repeatedly to people who never open teaches providers to filter you, and it affects delivery to everyone else too.

Volume appeared from nowhere on a domain with no sending history.

The content pattern: a single large image with almost no text, lots of links, shouting subject lines, or the words people associate with a scam. Modern filters are less naive than folklore suggests, but the extremes still matter.

Missing unsubscribe, or a reply-to address that does not accept replies.

Fix them in that order. Test by sending to accounts on two or three different providers and looking at which folder it lands in — one inbox is not a sample.`,
  },
  {
    slug: "what-to-measure",
    title: "The numbers actually worth watching",
    body: `Most of what gets measured is decorative. Four numbers carry nearly all the signal.

Where leads come from. If you know which source produced the enquiries that became customers, you know where to spend, and that single question outranks everything else.

Reply and booking rate on your follow-up. Not opens — opens are inflated by scanning and tell you about your subject line rather than your offer.

Speed to first response. Across almost every business this predicts conversion more strongly than anything about the message, and it is entirely within your control.

Conversion between pipeline stages, which tells you where deals die.

Pick those, look at them monthly, and ignore the rest until something specific makes you curious. A screen with thirty tiles gets glanced at; four numbers get acted on.`,
  },
];
