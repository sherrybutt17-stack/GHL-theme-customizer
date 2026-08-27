import type { SeedArticle } from "./types";

/** Measurement that leads to a decision rather than to a screenshot. */
export const REPORTING_ADVANCED: SeedArticle[] = [
  {
    slug: "tracking-where-a-lead-came-from",
    title: "Making sure every enquiry records where it came from",
    body: `Attribution only works if every route in is recorded, and the routes people forget are the ones that make a good channel look like nothing.

Online routes are handled by tracking on your pages, provided the tracking is on every page people land on — including any hosted elsewhere.

The gaps are offline. A phone call from a van, a walk-in, a recommendation, a card handed over at an event. Each of these needs something: a distinct phone number, a short memorable link, a code, or simply asking and recording the answer in a field.

Without that, all of them collect in "direct", which is not a channel — it is the bin where your unmeasured marketing goes, and it is usually your best.

Use one field with a small set of fixed options rather than free text. Forty spellings of "word of mouth" cannot be counted.

Ask at the point of enquiry rather than later. Nobody remembers a week afterwards.`,
  },
  {
    slug: "cost-per-customer",
    title: "Working out what a customer actually costs you",
    body: `The number that matters is not cost per click or cost per lead, it is what you paid to get a paying customer — and the two can rank channels in opposite orders.

Take the spend on a channel over a period, and divide by the number of customers who came from it in that period. Compare that against what a customer is worth to you.

The reason to go all the way to customers is that channels differ enormously in quality. A channel producing four times the enquiries at a tenth of the conversion rate looks best on every earlier metric and is the one to stop.

It needs two things to be true: attribution recorded properly at enquiry, and deals actually marked won or lost. Neither is technical work; both are habits.

Use a sensible period. Weekly numbers on a business with a long sales cycle are noise, and acting on noise is worse than not measuring.

Then act on it. This calculation is only worth doing if you are prepared to move money.`,
  },
  {
    slug: "response-time-reporting",
    title: "Measuring how quickly you respond",
    body: `Time to first response predicts conversion better than almost anything else you can measure, and it is entirely within your control — which makes it the most useful number in most businesses.

Measure from the enquiry arriving to a human replying, not to an automatic acknowledgement. The automatic reply is worth sending and it is not a response.

Look at the distribution rather than the average. An average of forty minutes made of mostly-five-minutes and a few six-hour outliers is a different business from one that is consistently forty, and the outliers are where you lose people.

Break it down by time of day and by channel. Almost every business has a specific gap — lunchtime, after five, weekends — and the fix is a rota rather than an exhortation.

Set a target you can actually meet and make it visible. A target nobody believes in is decoration.

Then reduce it with automation for the acknowledgement and a rota for the reply. The acknowledgement buys you the time; it does not replace the reply.`,
  },
  {
    slug: "conversion-through-the-pipeline",
    title: "Finding where deals actually die",
    body: `Conversion between stages tells you where you lose people, and it is rarely where anybody assumes.

Read across the board: how many enter each stage, how many reach the next. A large drop at one point is where the work is, and improving a step with a 70% pass rate matters far less than fixing one at 20%.

Look at time in stage alongside it. Deals sitting somewhere for weeks are decisions nobody has made, which is a different problem from deals actively being lost.

The commonest finding is a bulge at quoting: quotes are produced and never followed up. That is an automation, not a hiring problem.

All of it depends on the board being current, so fix that habit before trusting any of these numbers. A pipeline updated monthly produces confident, wrong charts, which is worse than none.

Record why deals are lost, even with four fixed options. It turns "we lose a lot at quoting" into something you can act on.`,
  },
  {
    slug: "reports-people-actually-read",
    title: "Setting up reporting people will actually use",
    body: `Most reporting is built once, admired, and never opened again. Three things change that.

Send it rather than hosting it. A short email on a schedule gets read; a dashboard somebody must remember to visit does not.

Keep it to a handful of numbers, each with a comparison against the previous period. A number with nothing beside it cannot be judged good or bad.

Give each number an owner — the person who would act if it moved. Numbers nobody owns are watched by nobody.

Pick the period to match the business. Weekly for anything high volume, monthly for a long sales cycle. Daily reporting on a business doing ten deals a month is pure noise.

Then delete the reports nobody mentions. Reports accumulate exactly like workflows, and an unused one still costs attention every time somebody scrolls past it.`,
  },
  {
    slug: "email-and-message-statistics",
    title: "Reading email and message statistics honestly",
    body: `Opens are the least reliable number in marketing and the one most quoted.

They are inflated by mailbox providers loading images to scan them, and undercounted for anybody who blocks images. Treat them as a rough trend on your own sends over time, never as a measure of interest and never compared against somebody else's benchmark.

Clicks are real behaviour and worth much more. Replies and bookings are worth more still.

Bounces are the number to watch defensively. A rising bounce rate means the list is decaying, and continuing to send to it damages delivery for everybody.

Unsubscribes are healthy in moderation. A rate near zero usually means you are sending too rarely or too blandly to provoke anything. A spike after one send tells you exactly which one was wrong.

Spam complaints are the serious one. Even a small rate does real damage to delivery, and the fix is always list quality and frequency rather than wording.

For texts, delivery is the number that matters, and a low rate points at registration or number formatting rather than content.`,
  },
  {
    slug: "comparing-periods-fairly",
    title: "Comparing this month against last",
    body: `Most alarming comparisons are artefacts, and it is worth ruling those out before reacting.

Check the number of working days. February against January, or a month with two bank holidays, differ by a tenth or more before anything real happens.

Check whether the periods align to weeks. Four weekends against five moves almost every number in a business that trades on weekends.

Check whether anything changed in how things are recorded. A new form, a renamed stage, tracking added or removed, or a habit changing — all of these shift a number without the business changing at all.

Check the time zone the report groups by, particularly around midnight.

Then compare against the same period last year as well as last month, which controls for seasonality that a month-on-month view reads as a trend.

Three points make a line. Two make a story, and usually the wrong one.`,
  },
];
