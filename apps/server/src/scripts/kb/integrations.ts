import type { SeedArticle } from "./types";

/**
 * Connecting the client's OWN other tools.
 *
 * Naming these is safe and useful — they are the customer's accounts, not the vendor
 * whose name this product exists to hide. What must never appear is the infrastructure
 * behind our own sending and calling; describe those as "the carrier" or "the provider".
 */
export const INTEGRATIONS: SeedArticle[] = [
  {
    slug: "connecting-google-account",
    title: "Connecting your Google account",
    body: `A Google connection covers several things at once: your calendar, your email, and any advertising or business listing you manage with the same login.

Connect it through Integrations in Settings, signing in with the account that actually owns the thing you want — not a colleague's, and not a personal one you use for convenience. Ownership is what decides whether it works, and it is the commonest reason a connection appears to succeed and then delivers nothing.

Grant every permission it asks for. Declining one produces a connection that half works: the calendar reads but does not write, or the mailbox sends but never receives.

Connections expire. A password change, a security review, or Google's own periodic re-consent will end it silently — no error, things simply stop. If your bookings stop appearing or your email stops sending, reconnect before investigating anything else.

Use a business account rather than a free one wherever the choice exists. Free accounts carry sending limits that a business account does not.`,
  },
  {
    slug: "connecting-a-video-meeting-tool",
    title: "Adding a video meeting link to bookings",
    body: `A calendar can generate a video meeting link automatically when somebody books, so the confirmation carries a joining link rather than an address.

Connect your meeting tool through Integrations in Settings, then set the calendar's location type to that tool. Every booking on that calendar then gets its own unique link.

The link belongs in the confirmation and in the reminder, not only in the confirmation. Somebody booking three weeks ahead will not scroll back through their inbox on the day.

Two things catch people. The connection has to be made with the account that will host the meeting, so a booking assigned to a colleague needs their account connected too, not just yours. And if you change the calendar's location type later, existing bookings keep the link they were created with rather than being regenerated.

For a round robin, connect every team member individually or the ones you missed will send an address instead of a link.`,
  },
  {
    slug: "connecting-accounting-software",
    title: "Connecting your accounting software",
    body: `An accounting connection keeps invoices, payments and customers in step so nobody retypes them at month end.

Connect through Integrations in Settings and choose what syncs in which direction. That decision is the whole job, and it is worth making deliberately rather than accepting defaults.

Pick one system as the master for customer records. Two-way syncing of contacts between two systems that both allow edits produces duplicates and overwrites, and untangling that after three months is genuinely painful.

Usually the right shape is: customers and invoices flow out to the accounts package, payment status flows back. Your accountant works in their system, you work in yours, and neither has to visit the other.

Check how tax is mapped before the first sync. A mismatch between tax rates on the two sides is quiet, cumulative, and discovered by your accountant rather than by you.

Run it for a week and reconcile by hand once before trusting it.`,
  },
  {
    slug: "connecting-an-online-store",
    title: "Connecting an existing online store",
    body: `If you already sell through a separate store platform, you can connect it so customers and orders arrive here as contacts with a purchase history.

That history is the point. It means follow-up, review requests and win-back campaigns can be built on what somebody actually bought, rather than on a list of email addresses.

Connect through Integrations in Settings using an account with admin rights on the store.

Decide what an order should do. Common and useful: tag the customer with the product, start a post-purchase sequence, and add them to a list for related offers. Do that with one or two automations rather than fifteen.

Historic orders may not import — many connections only carry data from the moment they are made. If your existing customer history matters, export it from the store and import it separately before connecting.

Keep the store as the master for stock and fulfilment. This is where the relationship lives, not where the warehouse lives.`,
  },
  {
    slug: "connecting-advertising-accounts",
    title: "Connecting your advertising accounts",
    body: `Connecting an advertising account lets spend and results sit beside the enquiries they produced, so you can see cost per customer rather than cost per click.

Connect through Integrations in Settings with an account that has admin access to the ad account itself — not merely to the business or the page. This is the single commonest reason the connection succeeds and reports stay empty.

Two directions are worth setting up. Bringing spend and performance in gives you reporting. Sending conversions back out tells the ad platform which clicks turned into customers, which is what lets its own optimisation improve.

The second is worth more than the first and is more often skipped. An ad platform optimising toward form fills will happily buy you cheap, useless form fills; one that knows which enquiries became sales buys differently.

Check the numbers against the ad platform's own reporting in the first week. Small discrepancies from attribution windows are normal; a factor of two is a setup problem.`,
  },
  {
    slug: "lead-forms-on-social-platforms",
    title: "Getting leads from forms on social platforms",
    body: `Ads on the big social platforms can carry a form the user fills in without leaving the app. Those submissions can flow straight in as contacts.

Connect the page through Integrations in Settings, then map each form field to a real field here. Unmapped answers arrive as text nobody can filter or use.

Speed is the entire game with these. In-app forms are easy to fill, which means intent is lower and memory is short — a reply within five minutes converts several times better than one within an hour. Build the automation before you run the ad.

Send a text as well as an email. These leads gave a phone number without typing it, and they answer texts.

Test with a real submission before spending anything. There is a preview tool on the ad platform for exactly this, and a broken mapping discovered after a week of spend is expensive.`,
  },
  {
    slug: "sending-notifications-to-a-team-chat",
    title: "Sending notifications into your team chat",
    body: `If your team lives in a chat tool, workflow notifications can be posted there instead of emailed.

The advantage is that they land where people already are and can be acted on by whoever is free, rather than sitting in one person's inbox while they are out.

Send them to a specific channel created for the purpose, not to a general one. A busy channel with alerts mixed into conversation is a channel where alerts get scrolled past.

Include enough in the message to decide without clicking: who, what, and the value if there is one.

Be strict about volume. This is the easiest place to create noise, and a channel with two hundred messages a day is a channel that is muted within a fortnight — after which it is worse than having nothing, because everyone believes they are being notified.

Anything that genuinely must be actioned should also create a task, so it exists somewhere with an owner.`,
  },
  {
    slug: "connecting-analytics",
    title: "Measuring traffic with your own analytics",
    body: `Your own analytics or tag manager can be added alongside the built-in reporting, which is worth doing if you already run analytics across a wider website.

Add the code through External Tracking in Settings so it applies to every page rather than being pasted onto each one.

Use a tag manager if you have more than two or three scripts. It keeps them in one place, lets you change them without touching pages, and means a broken script can be switched off in seconds.

Watch page speed. Each script costs load time, and load time costs conversions — usually more than the extra measurement is worth.

Mind the consent rules where your visitors are. In several regions analytics may not run until the visitor agrees, and that is a legal position rather than a setting.

Set conversion tracking on the thank-you page only. Firing it on every page inflates the numbers until they are useless.`,
  },
  {
    slug: "connecting-a-custom-email-provider",
    title: "Using your own email sending service",
    body: `If you already send through a dedicated email service, you can point sending at it instead of the built-in one.

Reasons to bother: you have an established sending reputation you do not want to abandon, your volume is high enough that separate pricing matters, or your organisation requires mail to leave through a specific route.

Reasons not to: it is another thing to configure, another place to look when mail does not arrive, and the built-in sending is fine for most volumes once the domain is verified.

You will need the connection details from that provider and the same DNS verification on your domain. Verification is not optional either way.

After switching, send test messages to accounts on several different providers and check which folder they land in. A switch that quietly halves your inbox rate is invisible from inside.

Keep a note of what you changed and when, because the next deliverability question will start there.`,
  },
  {
    slug: "connecting-a-payment-provider-account",
    title: "Which payment provider to connect",
    body: `Several providers can be connected, and the choice matters less than finishing the setup properly.

Pick on three things: whether it supports your country and currency, what it charges, and how quickly it pays out. Features are broadly similar; payout timing varies from one day to a week and affects cash flow more than the fee does.

Use one provider rather than several. Two connected providers means reconciling two sets of payouts and answering "which one took this payment" every time something is queried.

The account must be fully activated on the provider's side. One still in review will accept the connection here and decline every real payment, which presents as the whole checkout being broken.

Test with a real card and a small amount, then refund it. That single test proves checkout, receipt, contact record and payout in one go, and it is worth doing again after any change.`,
  },
  {
    slug: "using-a-connector-service",
    title: "Connecting to something with no direct integration",
    body: `When there is no built-in connection for a tool, there are two routes.

A connector service sits between the two systems and speaks both. It is the right choice when you want it working today, the volume is modest, and nobody on the team writes software. Set the trigger here, the action there, and test with one real record.

A direct connection using a workflow step that sends data out, or an address that receives it, is the right choice when volume is high enough that a per-task price matters, or when the other end needs something specific.

Either way, send one real example through with the receiving end open in front of you. Mapping guessed from documentation is wrong more often than not, particularly for phone numbers and dates.

Failures in both directions are silent by nature — the other system rejects it and everything here carries on. Build a check you would actually notice, even if it is only a weekly glance at whether records are arriving.`,
  },
  {
    slug: "why-an-integration-stopped-working",
    title: "An integration that was working has stopped",
    body: `Nearly always the connection expired rather than anything breaking.

Reconnect it first, before investigating. Access is revoked by password changes, security reviews, and the other platform's own periodic re-consent, and none of those announce themselves here — things simply stop.

Second: the account used to connect it lost access at the other end. If a colleague connected it and has left, or their role on the page changed, the connection dies with their permissions. Reconnect using an account that will still exist next year.

Third: permissions were reduced at the other end during a review, leaving a connection that half works.

Fourth: the other platform changed something. Less common, but it does happen, and it looks identical from here.

The tell for all of these is a channel going quiet rather than throwing an error. If posts stopped publishing, appointments stopped syncing, or messages stopped arriving on one channel while everything else is fine, start by reconnecting.`,
  },
  {
    slug: "custom-menu-links",
    title: "Adding your own link into the menu",
    body: `You can add your own items to the sidebar, pointing at anything your team uses — an internal tool, a shared document, a dashboard, a booking page.

It is a small feature with a real effect: the thing people are supposed to use is one click away in the place they already look, rather than a link somebody has to find.

Choose whether it opens inside the page or in a new tab. Inside is tidier; a new tab is safer for anything that needs its own login or will not display in a frame.

Set who sees it. A link only two people need should not be in everyone's menu.

Keep the list short. The value comes from the menu being scannable, and four extra items undoes that.

If a link opens to a blank area, the destination refuses to be displayed inside another page. Set it to open in a new tab instead.`,
  },
  {
    slug: "importing-from-another-crm",
    title: "Moving in from another system",
    body: `Bring the data across in a deliberate order, because the order is what determines how much cleanup you do afterwards.

Contacts first, as a CSV, with the fields you actually use. Create the custom fields here before importing so there is somewhere for everything to land — importing first and adding fields afterwards means doing it twice.

Then the structure: pipelines and their stages, calendars and availability, templates. These are rebuilt rather than imported, and it is a good moment to drop what you were not using.

Then open deals, as a second import mapped onto the pipeline you just built.

Historic conversations usually do not come across, and chasing them is rarely worth it. Export them from the old system, keep the file, and let the history start fresh here.

Run both systems for a fortnight. Switch new enquiries here on day one and leave the old one readable, so nothing in flight is lost while people learn.

Tag everything imported with the source and the date. When something looks wrong in three months, that tag is how you find out whether it came across or was created here.`,
  },
];
