import type { SeedArticle } from "./types";

/** Pages, funnels, forms, surveys, blogs, stores and the files behind them. */
export const SITES: SeedArticle[] = [
  {
    slug: "building-and-publishing-a-page",
    title: "Building and publishing a page",
    body: `Sites in the sidebar covers the pages and funnels you publish.

Create a page, and build it from sections you drag into place, adjusting text and images as you go. What you see while editing is what visitors get.

Publish when you are ready, and use the preview first on both a desktop and a phone. Most visitors arrive on a phone, and a layout that looks balanced on a wide screen often needs its spacing adjusted for a narrow one.

Pages work best pointed at one action. A page asking a visitor to book a call, and nothing else, consistently beats one offering five things at once.`,
  },
  {
    slug: "funnels-versus-websites",
    title: "The difference between a funnel and a website",
    body: `A website is somewhere people browse. A funnel is a short path with one destination, and visitors are meant to move along it rather than wander.

The practical differences: a website has a menu and many entry points; a funnel usually has no navigation at all, deliberately, because every link is somewhere to leak out of. A website answers "who are these people"; a funnel answers "will you do this one thing".

Use a funnel for an offer, a lead magnet, a booking flow or a checkout. Use a website for the general presence people find by searching your name.

Most businesses need both, and they can live on the same domain — the site at the root, funnels on their own paths.

The most common mistake is building a funnel with a full navigation bar across the top, which turns it back into a website and cuts the conversion rate substantially.`,
  },
  {
    slug: "funnel-steps",
    title: "Steps in a funnel and what order they go in",
    body: `A funnel is a series of steps, each a page, in the order a visitor moves through them.

The usual shape is three: the page that makes the offer, the form or checkout that collects the details, and the thank-you page that confirms and says what happens next.

The thank-you page is the one people treat as an afterthought and it is the most valuable. It is the only moment you have somebody's full attention having just said yes — put the booking link there, or the next step, or the referral ask. A page that only says "thanks" wastes it.

Steps can be reordered by dragging, and the first step is what the funnel's URL loads.

Keep the count low. Every additional step loses people, and a three-step funnel that converts beats a seven-step one that qualifies beautifully and finishes with nobody.`,
  },
  {
    slug: "building-a-form",
    title: "Building a form and using what it collects",
    body: `Forms are how information gets in without anyone typing it for you.

Create a form, add the fields you actually need, and keep it short. Every extra field costs you completions, and you can always ask for more later once someone is a real prospect.

Once it is built you can embed it on a page or share it as a link. A submission creates or updates the contact automatically, so the person shows up in Contacts without any manual step.

Forms pair naturally with automations: submitting a form is one of the triggers available, so you can send a confirmation email or notify yourself the moment somebody fills it in.`,
  },
  {
    slug: "where-a-form-sends-people",
    title: "Where a form sends people after they submit",
    body: `Every form and page has a setting for what happens after someone submits it, and leaving it at the default is the most common reason a working form feels broken.

Open the form's settings and choose: show a message on the same page, or send them to a different page. A thank-you page is usually better, because it gives you something to measure and somewhere to put the next step.

Submissions land on the contact record either way. If one created a brand new contact when you expected it to update an existing one, the email address did not match exactly — that is what records are matched on.

If you want something to happen on submission — a text, an email, a task — that belongs in an automation triggered by the form, not in the form itself.`,
  },
  {
    slug: "surveys-and-conditional-questions",
    title: "Surveys, and questions that change based on the answers",
    body: `A survey is a form spread over several screens, with the ability to change what comes next based on what somebody answered.

Use it where a single long form would be intimidating, or where the questions genuinely branch — a quote request where the answers differ entirely for a house and a flat.

Conditional logic is the point. Show the follow-up question only to the people it applies to, and skip whole sections that are irrelevant. A survey that asks everybody everything is just a long form with extra clicking.

Show progress. People abandon when they cannot see the end.

Answers land on the contact record as fields, so map each question to a real field rather than leaving them as loose text — otherwise you have collected information you cannot filter, report on or use in a message.

Keep it as short as the decision requires. Every question after the ones you truly need costs completions.`,
  },
  {
    slug: "order-forms-and-upsells",
    title: "Checkouts, order bumps and upsells",
    body: `An order form is the step that takes the money. It needs a payment provider connected before it can do anything.

Keep it minimal. Every field beyond what you must have to fulfil and to bill loses sales, and this is the page where losses are most expensive because these people had decided.

An order bump is a small tick-box addition on the checkout itself. It is the highest-return thing on the page — a genuinely related, modestly priced extra taken by a meaningful share of buyers at no extra traffic cost.

An upsell is a separate offer shown after the payment goes through, on a page of its own. It must be skippable clearly and honestly; a forced or disguised upsell produces refunds and chargebacks that cost more than it made.

Test the whole path with a real card and a small amount, then refund it. Confirm the payment lands, the contact is created, the receipt arrives and any follow-up fires. A checkout that half-works is worse than none because it takes money without fulfilling.`,
  },
  {
    slug: "split-testing-a-page",
    title: "Testing two versions of a page",
    body: `A split test shows different visitors different versions of a page and reports which converts better.

Change one thing at a time. Two pages differing in headline, layout, image and price tell you which page won and nothing about why, so you cannot apply the lesson anywhere else.

Test the big things first: the headline, the offer, the number of form fields. Button colour is a famous example of a test that almost never matters.

Wait for enough traffic. A page at nine conversions against six is noise, and acting on it is worse than not testing, because you will now believe something untrue. Hundreds of visitors per version is a reasonable floor for most businesses.

Let it run over whole weeks. Weekday and weekend traffic behave differently, and a test that starts on Friday reads strangely by Monday.

When a version wins, make it the only version and start the next test. A pile of half-finished tests is how a site ends up in an unexplained state.`,
  },
  {
    slug: "the-chat-widget-on-your-website",
    title: "Putting a chat widget on your website",
    body: `A chat widget sits in the corner of your own website and drops those conversations into the same inbox as everything else.

Set what it asks for before starting a conversation. Requiring a name and a number turns it into a lead capture that works even when nobody is watching; asking nothing gets more conversations and more of them anonymous. Requiring a number is usually the better trade for a service business.

Say honestly when someone will reply. A widget promising instant chat that answers in four hours is worse than one saying "we usually reply within the hour".

Route it to a person and turn on notifications, or it becomes another unwatched inbox.

Out of hours, capture the details and set expectations rather than pretending to be live.

Install it by adding the snippet it gives you to your site, which for most sites is a setting rather than editing code.`,
  },
  {
    slug: "blogs",
    title: "Publishing blog posts",
    body: `Blog posts live under Sites alongside pages, with their own list, categories and authors.

Write for a question somebody actually types. A post titled after a real question outperforms a clever title reliably, because that is how people arrive.

Fill in the title and description that appear in search results, and set the address deliberately rather than accepting whatever is generated from a long title.

Add an image and check how it looks when the post is shared, because that preview is what most people judge before clicking.

Put a call to action in the post itself. Traffic that reads and leaves is worth very little; a booking link or a form near the end is what turns reading into enquiries.

Publishing consistently matters more than publishing often. Two good posts a month sustained for a year beats twenty in one month and then silence.`,
  },
  {
    slug: "stores-and-products",
    title: "Selling products from a store",
    body: `A store lists products people can browse and buy, as opposed to a single checkout for one offer.

Set up products with a name, description, images and price. Variants — sizes, colours, options — belong on one product rather than as separate products, or your listing becomes unreadable.

Decide about stock. If you track it, the store can stop selling what has run out, which is the difference between a good week and forty apology emails.

Shipping and tax need configuring before you open. Both are easy to leave at defaults and both produce real problems: a rate that undercharges on every order, or tax collected wrongly.

Connect a payment provider, then buy something yourself with a real card and refund it. That single test catches most of what is misconfigured.

For a business selling one or two things, a plain checkout page usually converts better than a store. Use a store when browsing is genuinely part of the purchase.`,
  },
  {
    slug: "media-storage",
    title: "Uploading and organising images and files",
    body: `Media Storage holds the images, documents and videos used across pages, emails and messages, so a logo lives in one place rather than being re-uploaded ten times.

Organise into folders from the start, and name files as something you could search for. A library of four hundred files called image1 is functionally empty.

Resize images before uploading. A photo straight from a phone is several megabytes and will be the reason a page is slow; a couple of hundred kilobytes is plenty for anything on a web page. This is the single biggest lever on page speed for most sites.

Replacing a file that pages already use updates it everywhere, which is convenient and also a way to change something you did not intend. Check what uses it first.

Deleting a file that a live page references leaves a broken image on that page — there is no warning, so check before removing anything.`,
  },
  {
    slug: "tracking-code-and-pixels",
    title: "Adding tracking code and advertising pixels",
    body: `External Tracking in Settings is where advertising and analytics snippets go, so they apply across your pages without editing each one.

Paste exactly what the provider gives you. A partially copied snippet fails silently, which is indistinguishable from working until you look at the reports a month later and find nothing.

Add one at a time and verify each before adding the next. Providers publish a way to check their tag is firing, and it takes two minutes.

Fewer is better. Every script slows the page, and page speed affects conversion more than most of the things these scripts are measuring.

Be aware of the consent rules where your visitors are. In several regions tracking scripts may not run until the visitor agrees, and that is a legal position rather than a technical setting.

Conversion tracking specifically needs the thank-you page to be the only page that fires it, or your reported conversions will be wildly inflated.`,
  },
  {
    slug: "page-changes-not-showing",
    title: "Changes to a page are not showing up",
    body: `Four causes, and they are quick to separate.

It was saved but not published. Editing changes the draft; visitors see the published version until you publish again.

Your browser is holding the old copy. Hard refresh, or open the page in a private window, which is the fastest way to tell a caching problem from a real one.

You are looking at a different version of the page than the one you edited — a duplicate step, or another funnel with a similar name. Check the address bar against the page you have open in the editor.

If the page sits behind a service that caches your site, that cache needs clearing separately; the page here is correct and something in front of it is serving the old one.

Check on a phone as well as a laptop before concluding anything, because a change that only appears on one is a layout setting rather than a publishing problem.`,
  },
];
