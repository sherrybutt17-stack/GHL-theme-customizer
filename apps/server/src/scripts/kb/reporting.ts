import type { SeedArticle } from "./types";

/** Reports, dashboards, and what the numbers can and cannot tell you. */
export const REPORTING: SeedArticle[] = [
  {
    slug: "understanding-your-dashboard",
    title: "Reading your dashboard",
    body: `Dashboard is a summary built from data that lives elsewhere. Nothing on it is stored there, which is why a number that looks wrong is nearly always right about data that is wrong.

Set the date range first. Most confusion about a figure is a comparison between two different periods, and it is the first thing to check when today's number contradicts yesterday's memory.

The tiles can be rearranged and swapped, so keep the ones you act on and remove the rest. A dashboard nobody can take in at a glance is not read, and then nobody notices when something moves.

Treat it as a prompt rather than a report. It is good for noticing that something changed; the detail of why lives in Reporting or on the records themselves.`,
  },
  {
    slug: "where-leads-come-from",
    title: "Finding out where your leads actually come from",
    body: `Attribution reporting connects an enquiry back to what produced it — the ad, the search, the referral, the page.

It is the most commercially valuable report available, because it is the difference between spending more on what works and spending more on what is loudest.

Two things have to be in place for it to be honest. Tracking has to be installed on your pages, and it has to be on the pages people actually land on, including any hosted elsewhere. And every route in — the phone number on your van, the walk-in, the word of mouth — needs some way of being recorded, or those all land as "direct" and your best channel looks like nothing.

Read first-touch and last-touch as different questions. First touch says what created awareness; last touch says what closed. Judging a channel on the wrong one is how good top-of-funnel spend gets cut.

And judge on customers rather than leads. A channel producing four times the enquiries at a tenth of the conversion rate is a channel to stop, and only a report that follows through to revenue shows it.`,
  },
  {
    slug: "call-reporting",
    title: "Reporting on calls",
    body: `Call reporting covers volume, who answered, how long calls lasted, and how many were missed.

The missed-call number is the one to look at first, and for most businesses it is worse than anyone expects. Each one is a person who wanted to buy and got no answer.

Look at when they are missed rather than only how many. A pattern at lunchtime or at five o'clock is a rota problem with a straightforward fix; missed calls spread evenly are a capacity problem, which is a different conversation.

Duration is a rough quality signal. A lot of very short answered calls usually means they are being answered and dropped, or being answered by the wrong person.

Pair it with automatic follow-up so a missed call is recovered rather than merely counted. A report that measures a loss you do nothing about is expensive decoration.`,
  },
  {
    slug: "appointment-reporting",
    title: "Reporting on appointments",
    body: `Appointment reporting shows what was booked, by whom, from where, and how it ended — showed, cancelled or no-show.

All of it depends on statuses being kept current. If everything stays marked confirmed, every chart here is wrong in the same optimistic direction, and it will be believed.

The no-show rate is the number to act on. Above about one in ten, the fix is nearly always reminders and deposits rather than anything about your bookings.

Look at the gap between booking and appointment. Bookings made far ahead are missed far more often, which is an argument for offering nearer slots or reminding more.

Broken down by source, this tells you which channel produces people who actually turn up, which is a better measure of a channel than the raw number of bookings.`,
  },
  {
    slug: "team-reporting",
    title: "Reporting on people",
    body: `You can break most reporting down by user: calls handled, messages answered, appointments taken, deals won, response times.

Used well this finds where to help. Somebody with a low conversion rate on good leads needs coaching; somebody with slow first responses is probably drowning rather than idle.

Used badly it becomes a scoreboard, and people optimise for the number. Measure only on speed and you get fast, useless replies; measure only on closed deals and the leads that need work get abandoned.

Response time is the fairest single measure, because it is mostly within the person's control and it correlates with conversion better than almost anything else.

Compare like with like. Someone working inbound enquiries and someone working cold outreach cannot be read on the same chart, and doing so demoralises one of them for no reason.`,
  },
  {
    slug: "building-a-custom-report",
    title: "Building a report of your own",
    body: `Beyond the standard reports you can assemble your own from the data in the account, choosing what to count, how to break it down, and over what period.

Start from the decision, not the data. "Should we keep running these ads" produces a useful report; "let us see what we have" produces a page of charts nobody opens twice.

One question per report. A report answering four things answers none of them clearly.

Set a sensible default period and a comparison against the previous one. A number with nothing to compare it against cannot be read as good or bad.

Have it sent to whoever needs it on a schedule rather than relying on people to visit. A weekly email with three numbers in it gets read; a dashboard someone must remember to open does not.

Then delete the ones nobody mentions. Reports accumulate the same way workflows do.`,
  },
  {
    slug: "why-a-number-looks-wrong",
    title: "When a report does not match what you expected",
    body: `Almost always one of five things, and it is worth checking them before concluding the report is broken.

The date range, including the time zone it is applied in. A report on the account's time zone against a memory of local time will disagree at both ends of the period.

What is being counted. A lead, a person's record and a deal are three different things, and a report counting one against an expectation about another will never reconcile.

Records excluded by a filter you have forgotten is applied, including one saved into a view.

Statuses that were never updated, which is the big one for anything about appointments or deals. Reports built on a board people update monthly are confidently wrong.

Attribution gaps: enquiries arriving by routes that are not tracked all pile into "direct", which makes real channels look smaller than they are.

If it still does not reconcile, take one specific record the report should include and follow it through. A single example usually exposes the rule.`,
  },
];
