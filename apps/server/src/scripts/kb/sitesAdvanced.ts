import type { SeedArticle } from "./types";

/** Page building past the basics: SEO, popups, speed, templates, redirects. */
export const SITES_ADVANCED: SeedArticle[] = [
  {
    slug: "page-seo-settings",
    title: "How your page appears in search results and when shared",
    body: `Every page has settings for the title and description that appear in search results and in the preview when somebody shares the link.

Left blank, these fall back to whatever can be scraped from the page, which is usually the first heading and a fragment of body text. It reads badly and it costs clicks.

Write the title as a person searching would recognise it, with the important words early — many results are truncated after about sixty characters. Write the description as an advertisement for clicking, not as a summary.

Set the share image too. A link posted with no image gets a grey box, and a grey box is scrolled past.

Set the page address deliberately rather than accepting one generated from a long title. Short, readable and unchanging is what you want, because changing it later breaks every link anybody has saved.

Check the preview by pasting the link into a message to yourself before you publish it anywhere real.`,
  },
  {
    slug: "popups-on-a-page",
    title: "Adding a popup",
    body: `A popup can be shown on a page after a delay, on scroll, or when the visitor moves to leave.

They work, which is why they persist, and they are also the fastest way to make a page unpleasant. Two rules keep them on the right side of that: one per page, and never within the first few seconds.

Exit intent is usually the best trigger on a desktop page — the visitor was leaving anyway, so the interruption costs nothing. It does not exist meaningfully on a phone, where a scroll-depth or timed trigger is the alternative.

Make the close button obvious and large enough to hit on a phone. A popup somebody cannot dismiss is a page they leave.

Do not show it again to somebody who dismissed it, or who has already done the thing it asks for. Being asked to subscribe on every visit after subscribing reads as a broken site.

Offer something specific. "Join our newsletter" converts poorly; a named, useful thing converts.`,
  },
  {
    slug: "countdown-timers",
    title: "Countdown timers and deadlines",
    body: `A timer on a page counts down to a deadline, either a fixed date or a period starting when that visitor first arrived.

A fixed deadline is honest and works for a real launch or event. A per-visitor timer is for an offer that genuinely lasts a set time from when somebody joins.

The rule that matters: the deadline has to be real. A timer that resets when the page is reloaded, or an offer still available a week after the timer expired, is noticed by exactly the people most likely to buy, and it costs their trust permanently.

Say what happens when it ends, and then make that happen. If the price goes up, put it up.

Do not put one on a page that is not actually time limited. It reads as a trick, because it is one.`,
  },
  {
    slug: "making-pages-load-faster",
    title: "Making a page load faster",
    body: `Page speed affects conversion more than almost anything else you can change on the page, and most of the problem is images.

Resize before uploading. A photo straight from a phone is several megabytes and a few thousand pixels wide, displayed at a fraction of that. A couple of hundred kilobytes is plenty for anything on a web page, and this single change usually accounts for most of the improvement available.

Then count the scripts. Every tracking, chat and analytics snippet costs load time, and several of them add up to more than the measurement is worth.

Then look at video. An auto-playing background video is expensive on a phone and on a data plan.

Test on a phone on mobile data, not on a laptop on office broadband. That is what your visitors have, and the difference is dramatic.

The thing to protect above all is what a visitor sees first. A page whose top half appears immediately feels fast even if things below are still loading.`,
  },
  {
    slug: "redirects",
    title: "Sending an old address to a new page",
    body: `A redirect sends anybody arriving at one address to a different page, and it is what stops old links breaking when things move.

Set them up whenever a page address changes. Links live in other people's emails, bookmarks, printed material and other websites, and you cannot edit those — the redirect is the only lever you have.

Use a permanent redirect for a permanent move, which tells search engines to transfer the page's standing to the new address. A temporary one is for something genuinely temporary, like a page down for maintenance.

Avoid chains. An address redirecting to an address that redirects again is slow and fragile; point the first one straight at the final destination.

Redirects are also useful as short, memorable links for print and radio — a short address on your own domain that points wherever you need it to today, and can be changed without reprinting anything.`,
  },
  {
    slug: "page-templates",
    title: "Saving a page as a template",
    body: `A page you will build again should be saved as a template rather than duplicated, and there is a real difference.

A template is a starting point you deliberately begin from, which keeps the good version identifiable. Duplicating last month's page copies last month's mistakes, last month's offer, and occasionally last month's tracking code pointed at the wrong campaign.

Build a small set that covers your real cases: a lead capture page, a booking page, a sales page, a thank-you page. Four good ones beat forty.

Strip anything campaign-specific before saving — dates, prices, particular offers — so the template does not carry a stale detail into every future page.

Note in the name what it is for. Templates called "Template 1" through "Template 6" are chosen at random.

When you improve one, improve the template. Otherwise the good version exists only on one live page and everything new starts from the old one.`,
  },
  {
    slug: "custom-code-on-a-page",
    title: "Adding your own code to a page",
    body: `Pages accept custom styling and scripts where the builder does not cover something.

Reach for it last. Anything achievable in the builder should be, because a builder change survives redesigns and version changes, and pasted code does not.

Legitimate cases: a font or style rule the builder does not expose, an embed from a third party, a tracking snippet that has to sit in a specific place.

Add one thing at a time and check the page afterwards, on a phone as well as a desktop. Broken custom code can take a whole page down, and it will not always be obvious which addition did it.

Comment what each block is for and when you added it. Unexplained code on a page is the thing nobody dares remove three years later.

Never paste code you do not understand from a source you do not trust. It runs on your page, in your visitors' browsers, with access to what they type.`,
  },
  {
    slug: "forms-that-are-not-being-submitted",
    title: "People are visiting the page but not filling in the form",
    body: `Before assuming the copy is wrong, rule out the mechanical causes — they are commoner and they are free to fix.

Test it yourself in a private window on a phone. A form that works on your laptop while logged in tells you nothing.

Count the fields. Every one costs completions, and most forms ask for two or three things that could be collected later or never. Name and one contact method is usually enough to start a conversation.

Check the form is visible without scrolling on a phone, or that there is an obvious reason to scroll.

Check what happens after submitting. If nothing visibly happens, people submit repeatedly and then leave.

Check the page speed. Visitors who leave before it loads never see the form at all, and they look identical in the numbers to visitors who chose not to fill it in.

Then look at the offer. If the mechanics are fine, the problem is that you are asking for details in exchange for something nobody wants.`,
  },
  {
    slug: "thank-you-pages",
    title: "What to put on the page after somebody submits",
    body: `The thank-you page is the most under-used page anybody builds. It is the one moment you have somebody's full attention immediately after they said yes.

Confirm what happened and say what comes next, with a time. "We have your enquiry — someone will call within two working hours" prevents a follow-up message asking whether it went through.

Then ask for one more thing. Booking a call is the strongest, because it converts an enquiry into a commitment while they are still engaged. A referral ask, a useful download, or a link to your best content are alternatives.

Keep it to one. A page offering four next steps gets none of them.

It is also where conversion tracking should fire, and nowhere else — that is what keeps the reported numbers honest.

If you send a confirmation email as well, make it say the same thing. Two different accounts of what happens next is worse than one.`,
  },
  {
    slug: "sections-rows-and-mobile-layout",
    title: "Why a page looks wrong on a phone",
    body: `Pages are built from sections holding rows holding elements, and the layout adapts to narrow screens by stacking columns on top of each other.

That stacking is where most mobile problems come from. Two columns that read left-to-right on a desktop become one above the other on a phone, and the order is not always what you intended — an image meant to sit beside text can end up above it, pushing the text below the fold.

There are separate settings for how things appear on a phone: spacing, text size, and whether an element is shown at all. Use them rather than compromising the desktop layout.

Generous padding on a desktop is often too much on a phone, where it becomes a screen of empty space between paragraphs.

Check every page in the mobile preview before publishing, and then on a real phone. The preview is close but not identical, particularly for fonts and for anything sticky.

Most visitors are on a phone. When the two conflict, the phone wins.`,
  },
  {
    slug: "client-portal",
    title: "Giving customers their own login area",
    body: `A portal gives your customers a place to sign in and see what belongs to them — their appointments, their invoices, any content they have access to, and their own details.

The case for it is fewer messages asking things they could look up, and a more finished impression.

The case against is that a portal nobody visits is a thing you maintain for nothing. Before switching it on, be honest about whether your customers have a reason to return, or whether they interact with you three times a year.

If you do open one, tell people it exists more than once. Mention it in the welcome, in confirmations, and in your signature. The most common failure is a working portal nobody knew about.

Make the login recovery obvious. Any login you use rarely is a login you have forgotten.

Check what it shows before opening it, as a real customer with real data on screen.`,
  },
  {
    slug: "collecting-files-from-customers",
    title: "Collecting documents and photos from customers",
    body: `A form can include a file upload, which is the tidy way to collect photographs, documents or identification without a thread of email attachments.

The upload lands on the contact's record, so it is findable later without hunting through somebody's mailbox.

Say what you need and in what form. "Photograph of the damage" gets you something usable; "please attach relevant files" gets you a screenshot of an email.

Set expectations about size. People will try to upload a video of a job, and a limit hit silently reads as a broken form.

Say what you will do with it, particularly for anything identifying. That is a legal requirement in many places and it is also what makes people comfortable enough to comply.

Delete what you no longer need. Identification documents sitting on records indefinitely are a liability, not an asset.`,
  },
  {
    slug: "blogs-and-content-that-brings-traffic",
    title: "Writing content that actually brings people in",
    body: `Most business blogs fail the same way: they publish news about the business, which nobody searches for.

Write for questions people type. The questions your customers ask before buying are the list — you already have it, in your inbox. "How much does X cost", "how long does X take", "X versus Y" are the ones that bring people who are ready to buy.

Answer properly and completely. A short post that hedges ranks badly and converts worse than nothing.

Put a call to action in the post itself, not only in the menu. Traffic that reads and leaves is worth very little.

Set the title, description and address deliberately, and add an image for sharing.

Consistency beats volume. Two useful posts a month for a year beats twenty in one month and then silence — both for search and for the people who start reading you.

Update the good ones rather than always writing new ones. A post that already brings people in is the cheapest thing to improve.`,
  },
];
