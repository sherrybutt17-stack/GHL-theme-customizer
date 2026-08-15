import type { SeedArticle } from "./types";

/** The workflow builder past the basics. Remember: the nav label is "Automation", singular. */
export const AUTOMATIONS_ADVANCED: SeedArticle[] = [
  {
    slug: "date-and-time-triggers",
    title: "Starting a workflow on a date rather than an event",
    body: `Some sequences should start because a date arrived, not because somebody did something: a birthday, a renewal, a service due, a follow-up ninety days after a job.

Use a trigger based on a date field on the contact. It checks daily and enters anybody whose date matches, and it can be offset — fourteen days before the renewal date, or thirty days after the last visit.

That offset is what makes it useful. A renewal reminder on the day of renewal is too late to act on.

Two things to get right. The date has to be stored in a proper date field, not typed into a text box, or nothing will ever match. And these run on the account's time zone, so a business operating across time zones fires at the wrong local hour by default.

Test with a contact whose date is tomorrow rather than waiting a year. Then set it back.`,
  },
  {
    slug: "workflow-conditions-and-fields",
    title: "Checking a field before continuing",
    body: `A condition step reads something on the record and decides whether to carry on, or which way to go.

The failure that accounts for most confusion is the empty value. A condition testing "city is London" sends everybody with no city recorded down the other path — and on an imported list that can be most of them. Always ask yourself what happens to a record where the field was never filled in.

Prefer positive conditions to negative ones. "Has the enquiry tag" is readable; "does not have any of these six tags" is a rule nobody can verify a year later.

Where you are testing several things at once, consider setting a single field earlier in the workflow that captures the answer, and testing that. It moves the complexity to one place.

Name the branches for what they mean. "Existing customer" tells the next person what is going on; "condition 2" does not.`,
  },
  {
    slug: "updating-a-record-mid-workflow",
    title: "Changing the contact as the workflow runs",
    body: `A workflow can write to the record as it goes: set a field, add or remove a label, change an owner, move a deal, adjust a score.

This is how a sequence leaves a trace of itself. Setting a field like "last sequence" or "status" as somebody passes a milestone means the record explains its own history, and you can filter on it afterwards.

It is also how workflows talk to each other. One adds a label; another starts because that label was added. Keep that pattern deliberate and shallow — two hops is a design, five is a maze.

Remove what you add. A label applied on entry and never removed accumulates until it means nothing.

Be careful writing to fields a person also edits by hand. A workflow that overwrites a manually corrected value is genuinely maddening and very hard to spot, because the field simply reverts.`,
  },
  {
    slug: "formatting-and-calculations-in-workflows",
    title: "Doing sums and tidying text inside a workflow",
    body: `Beyond sending and updating, workflows can calculate and reformat — add a number of days to a date, total a value, trim or reformat text, split a full name.

The commonest genuinely useful cases: working out a renewal or expiry date from a start date, calculating a deposit as a percentage of a total, and standardising something messy that arrived from a form or an import.

Store the result in a field so you can use it in messages and conditions. A calculation whose output goes nowhere is a step that does nothing.

Everything needs the right type. Arithmetic on a value stored as text will either fail or produce something strange, and date maths on a date typed by hand is unreliable.

Test with the awkward cases before the ordinary ones: an empty field, a zero, a negative, a name with one word. Those are what break it, and they will occur within a week on real data.`,
  },
  {
    slug: "workflow-splits-and-testing-variants",
    title: "Testing two versions of a sequence",
    body: `A workflow can split people randomly down two paths, so you can compare two versions of a message or a timing.

Change one thing. Two paths differing in subject, wording and delay tell you which won and nothing about why.

The most valuable things to test are usually timing and channel rather than wording: a text at two hours against an email at one day is a real difference, and rewriting a subject line rarely is.

Give it enough volume and enough time. A split with forty people through it is noise, and acting on noise is worse than not testing, because you will now believe something untrue.

Judge on the outcome that matters — bookings or replies — not on opens.

When one wins, send everybody down it and start the next test. A workflow left permanently split is a workflow where half your customers get the worse experience forever.`,
  },
  {
    slug: "sending-in-batches",
    title: "Spreading sends out instead of all at once",
    body: `A workflow can release messages gradually rather than to everybody the moment they qualify — a set number per hour or per day.

Two reasons this matters. Sudden volume from a domain or number with no history gets filtered rather than delivered, particularly on a first campaign. And a hundred replies arriving in ten minutes is a queue nobody can answer, which converts far worse than the same hundred spread over a day.

Set the rate to what your team can actually handle. The constraint is usually people, not sending.

For anything going to a large list for the first time, start slower than feels necessary and increase over a few days.

Watch the replies as it runs. Releasing gradually means a problem discovered on message forty affects forty people rather than four thousand — that is the real benefit, and it is worth the delay on its own.`,
  },
  {
    slug: "notifying-the-right-person",
    title: "Making sure the alert reaches the right person",
    body: `Notifications work when they reach somebody who can act and who expects them. They fail by going to a shared address everyone has muted.

Send to the record's owner where there is one, so the alert follows the relationship rather than a hardcoded name. Hardcoding a person means that when they leave, the notification quietly goes nowhere.

Where there is no owner, send to a named person and a fallback, not to a group.

For anything that must be done rather than merely known, create a task as well. A message is read and forgotten; a task has an owner and a due date and shows up in a list.

Say what happened and what is wanted in the first line. "New enquiry — plumbing, Bristol, £4k — call today" is actionable from a lock screen. "You have a new form submission" requires opening something to find out whether it matters.`,
  },
  {
    slug: "workflow-costs",
    title: "What a workflow costs to run",
    body: `The workflow itself is not the cost — the messages it sends are. Texts, calls and emails are charged per use on top of the plan, and a sequence multiplies them by however many people go through it.

Do the arithmetic before switching on anything that will run at volume. Five texts in a sequence, four hundred people a month, is two thousand messages — a real number, and one worth knowing in advance rather than at the end of the month.

The expensive mistakes are loops and duplicates. A workflow that re-enters people, or two workflows both sending the same message, will not look wrong on screen and will show up on the bill.

Check the enrolment count after the first week. A number climbing far faster than your enquiries is the tell.

Some actions carry their own charges beyond the message itself. If a step involves a call, a lookup or an assistant, check what it costs before putting it in something that runs thousands of times.`,
  },
  {
    slug: "workflow-time-windows",
    title: "Stopping messages going out at three in the morning",
    body: `A workflow can be restricted to a window — working hours, weekdays only — with anything scheduled outside it held until the window opens.

Set this on anything that texts. A message at three in the morning does not merely go unanswered, it loses the customer, and it is the most preventable mistake in this whole area.

It matters most where a delay is involved. Somebody who fills in a form at eleven at night and gets a two-hour follow-up text receives it at one in the morning, which is nobody's intention and is easy not to notice while building.

Set the time zone deliberately. The window runs on the account's zone, so a business with customers elsewhere still sends at the wrong local hour unless you account for it.

Email is more forgiving but still benefits — mail arriving overnight is buried by morning.

Emergencies are the exception. If a workflow genuinely handles something urgent, exempt it consciously rather than by forgetting.`,
  },
  {
    slug: "reusing-workflows",
    title: "Building sequences you can reuse",
    body: `Rather than one large workflow per campaign, build small ones that do one job and have others add people to them.

One "new customer welcome" that three different entry points feed into means the welcome is fixed in one place when it changes. Three copies means finding all three, and missing one.

Good candidates for shared sequences: welcome, review request, win-back, appointment reminders, and the internal alerting.

Name them so the list reads as an index — what starts it and what it does — and put a sentence in the description saying why it exists. In six months you will be reading it as a stranger.

The trade-off is that a shared sequence is harder to trace: something entered it, and finding what takes a moment. Keep the chain shallow, and note the entry points in the description.`,
  },
  {
    slug: "cleaning-up-old-workflows",
    title: "Retiring a workflow safely",
    body: `Turn it off rather than deleting it, at least at first. A published workflow you have forgotten is not dormant — it is running, and it will send something one day.

Before switching anything off, check whether people are currently inside it. Contacts sitting in a wait step stop where they are and never receive the rest, which for a five-message sequence means somebody got two and then silence.

Check what feeds it. Removing a workflow that another one adds people to leaves a dead end nobody notices, because the adding step still succeeds.

Check what it sets. If a later condition tests a label this workflow applied, that condition now always fails.

Once it has been off for a month with nothing missing it, delete it. Keep a note of what it did and why it went — the reason to remove something is exactly what somebody needs when they wonder why it is gone.`,
  },
  {
    slug: "workflow-not-doing-what-i-expected",
    title: "The workflow runs but does the wrong thing",
    body: `Different from one that does not run at all, and diagnosed differently.

Open the enrolment history for one specific contact and read down it. Which branch did they take, and is that the one you expected? A branch taken wrongly is almost always an empty field falling through to the default path.

If messages went out with blanks in them, a field used for personalisation was empty on that record. Set fallbacks.

If the timing was wrong, look at the wait steps and at the time zone. A delay that felt right while building often reads very differently on the receiving end.

If somebody got the same thing twice, look for a second workflow that also sends it, or for re-entry being enabled with a trigger that fired again.

If the right thing happened to the wrong person, check the trigger's conditions rather than the steps — the sequence is fine, the entry rule is too broad.

Fix it with one specific contact in front of you, then re-test with a different one.`,
  },
];
