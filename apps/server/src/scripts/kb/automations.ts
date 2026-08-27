import type { SeedArticle } from "./types";

/**
 * Workflows — the largest area, and the one where "it isn't working" has the most
 * causes.
 *
 * NOTE ON THE NAV LABEL: the sidebar item is "Automation", SINGULAR. The feature
 * matcher is `\bAutomation\b`, so a body saying "open Automations" does NOT become a
 * placeholder and a client whose menu was renamed is told to click something that isn't
 * there. Write the singular whenever you mean the menu item.
 */
export const AUTOMATIONS: SeedArticle[] = [
  {
    slug: "setting-up-an-automation",
    title: "Setting up an automation",
    body: `Automations run a sequence of steps whenever something happens, so routine follow-up does not depend on somebody remembering.

Open Automation from the sidebar and create a workflow. Choose a trigger first, which is the event that starts it: a form submitted, an appointment booked, a tag added. Then add the actions that follow, such as sending an email, waiting two days, or updating a field on the contact.

Build the simplest version first and turn it on for real. A workflow with three steps that runs is worth more than a twenty step one that is still in draft.

Test with your own email address before pointing it at real clients. The preview shows the shape of the sequence, but only a real run tells you whether the timing feels right.`,
  },
  {
    slug: "why-an-automation-did-not-run",
    title: "Why an automation did not run",
    body: `When an automation does not fire, work down the list rather than rebuilding it.

Is it published? A draft saves fine and does nothing. Check the trigger next: one that starts on form submission will not start when you add a contact by hand.

Then check re-entry. By default a contact who has already been through will not go through again, which is exactly why a test with your own record works once and never again. Use a different contact, or allow re-entry deliberately.

Open the history and find the contact. It shows where they entered and where they stopped, and a contact sitting inside a wait step is not stuck — it is waiting.

If the step that failed sends an email or a text, the problem is usually sending rather than the automation: an unverified domain, or a number that is not registered yet.`,
  },
  {
    slug: "what-can-start-a-workflow",
    title: "The events that can start a workflow",
    body: `A trigger is the event that puts somebody into a workflow, and choosing the right one solves most problems before they exist.

The common ones fall into groups. Something the person did: submitted a form or survey, replied to a message, clicked a link in an email, booked or cancelled an appointment, abandoned a checkout, made a payment. Something about their record changed: a tag added or removed, a field updated, a stage or status changed on a deal, they were added to a list. Something about time: a date field arrived, a birthday, a set interval. Something from outside: a call came in and was missed, a message arrived on a particular channel, another system sent data in.

Two habits are worth forming. Use the most specific trigger available rather than a broad one plus a filter — "appointment booked on this calendar" beats "appointment booked" with a condition, because the intent is visible when somebody reads it in six months.

And be careful with triggers that can fire repeatedly. "Tag added" fires every time that tag is added, including by another workflow, which is how a loop starts.

You can add several triggers to one workflow, and any of them will start it.`,
  },
  {
    slug: "what-a-workflow-can-do",
    title: "The things a workflow can do",
    body: `Actions fall into a few families, and knowing the families is faster than reading the list.

Talking to the person: send an email, a text, a voicemail drop, a message on a connected channel, or queue a call for a human to make.

Changing the record: add or remove a tag, set a field, assign an owner, create or move a deal, add them to a list.

Waiting: a fixed delay, a wait until a specific time of day or day of week, or a wait until something happens.

Deciding: split the path on a condition, or check whether something is true before continuing.

Telling your team: an internal notification by email, text or a task assigned to somebody.

Reaching outside: send data to another system, or call something and use what comes back.

Housekeeping: add to or remove from another workflow, which is how you keep sequences short and composable rather than building one enormous one.

The most useful discipline is to keep each workflow about one thing. Three workflows that each do one job are far easier to fix than one that does three.`,
  },
  {
    slug: "if-else-branches",
    title: "Sending people down different paths",
    body: `A branch splits the sequence based on something true about the contact at that moment — a tag, a field value, which form they came from, whether they have booked.

Put the branch as late as possible. Everything before it is shared, so a change only has to be made once; everything after it is duplicated, and duplicated steps drift apart until the two paths behave differently for reasons nobody remembers.

Always account for the case where nothing matches. A contact who fits none of your conditions falls through to the default path, and if that path is empty they silently stop. That is the single most common reason "some people get the email and some do not".

Two or three branches is manageable. If you find yourself building seven, the thing you actually want is usually a field on the contact and one message that reads from it.

Name the branches for what they mean, not what they check. "Has booked" is readable; "condition 3" is not.`,
  },
  {
    slug: "wait-steps-and-timing",
    title: "Waits, delays and sending at sensible times",
    body: `A wait step is what turns a burst of messages into a sequence. Without one, every step runs within seconds of the trigger, which is how somebody receives your entire five-email course in one minute.

There are several kinds. A fixed delay waits a set time. A wait until waits for a specific time of day or day of the week. A wait for an event pauses until something happens — they reply, they book — with a maximum, so nobody waits forever.

Use a window so nothing sends at three in the morning. A text arriving at that hour costs you the customer, not just the reply, and it is the most preventable mistake in this whole area.

Get the timezone right. Sequences run on the account's timezone unless told otherwise, so a business with customers in another country sends at the wrong local time by default.

And be realistic about delays in testing. A workflow with a three-day wait cannot be verified in an afternoon; shorten the wait, test, then set it back and note that you did.`,
  },
  {
    slug: "goals-and-exiting-early",
    title: "Letting people leave a sequence early",
    body: `A goal is a condition that pulls somebody out of the sequence when it becomes true — usually because the thing you were chasing has happened.

The example that matters: a five-message follow-up sequence chasing a booking should stop the moment they book. Without a goal, they book on Tuesday and are still being asked to book on Friday, which reads as incompetence and undoes the good the sequence did.

The same applies to anyone who replies, pays, unsubscribes, or is marked lost.

Set goals early, because they are invisible when they work and painfully visible when they are missing. If you only ever build one, make it the goal that stops the follow up once somebody writes back.

Removing somebody from a workflow can also be an action in another workflow, which is how sequences that should be mutually exclusive stay that way.`,
  },
  {
    slug: "workflow-settings-and-re-entry",
    title: "Re-entry, stop on response, and the other settings",
    body: `Every workflow has settings that decide how it behaves in the awkward cases, and they explain most of the surprising behaviour people report.

Re-entry decides whether somebody who has already been through can enter again. Off by default, which is right for onboarding and wrong for anything recurring — and it is exactly why testing with your own record works once and never again.

Stop on response halts the sequence when the contact replies. Almost always what you want on anything conversational, because continuing to send scheduled messages at somebody who has just written to you is the fastest way to look automated.

A sending window restricts when messages may go out, holding anything scheduled outside it until the window opens.

There is also a setting for whether the workflow may message people marked do-not-disturb. Leave it alone.

Read these before debugging anything. A large share of "it did not run" is a setting doing exactly what it says.`,
  },
  {
    slug: "testing-a-workflow",
    title: "Testing a workflow before it touches real people",
    body: `Test with a real record and a real trigger. Clicking through the builder proves the shape; only an actual run proves the wiring.

Make yourself a test contact with an email address and phone number you control, and trigger it the way a customer would — submit the form, book the slot, add the tag. Watch it arrive.

Read what actually turned up, not what you meant to write. Fields that did not fill in show as blanks or as a raw placeholder, and that is only visible in the received message.

Shorten long waits for the test and put them back afterwards. Write yourself a note to put them back, because this is the single most common way a workflow reaches production sending five emails in a minute.

Then check the enrolment history for your test contact and confirm it went where you expected at every branch.

For anything going to a large number of people, run it against a handful of real customers first and read the replies before releasing it to the rest.`,
  },
  {
    slug: "enrollment-history",
    title: "Seeing who went through and where they stopped",
    body: `Every workflow keeps a record of who entered, when, which path they took and which step they are on. It is the first place to look when behaviour does not match expectation, and it usually ends the investigation in a minute.

Find the contact and read down. You will see one of a few things: they never entered, which is a trigger problem; they entered and stopped at a branch, which is a condition problem; they are sitting in a wait, which is not a problem at all; or a step failed, which usually points at sending rather than at the workflow.

A contact who appears to be stuck for days is nearly always inside a wait step that is doing its job. Check the step before concluding anything.

The same view is how you catch a workflow running far more often than you thought — a count climbing by hundreds a day is a loop, and it is better found here than on your messaging bill.`,
  },
  {
    slug: "internal-notifications",
    title: "Telling your team something happened",
    body: `A workflow can notify a person rather than the customer: an email, a text, or a task assigned to somebody with a due date.

This is the safest and most under-used category of automation, because nothing reaches a client and the value is immediate. A text to the owner when a high-value form comes in, an email to the account manager when a customer's payment fails, a task for whoever is on duty when a booking is cancelled.

Send them to a person, not to a shared address everyone has muted. A notification nobody owns is not a notification.

Put the useful details in the message itself — who, what, and the amount if there is one — so the recipient can decide whether to act without opening anything.

And apply the same restraint you would to customer messages. Ten internal alerts a day become invisible in a week, and then the one that mattered is invisible too.`,
  },
  {
    slug: "sending-data-to-another-system",
    title: "Sending data out to another tool",
    body: `A workflow step can send the contact's details to another system as they pass through, which is how this connects to something it has no built-in integration with — an accounts package, a spreadsheet, an internal tool, or an automation service that talks to everything else.

You give it the address the other system provides and choose what to send. Most receiving systems want a specific shape, so read their instructions first rather than sending everything and hoping.

Send the minimum that the other side needs. Every extra field is personal data leaving the building, and the fewer that go the less there is to explain later.

Failures here are quiet by nature: the other system rejects it and your workflow carries on. Test with the receiving end open in front of you so you can see it land, and check again after any change at their end.

If the other system needs a key or a token, treat it like a password — anyone who can open the workflow can read it.`,
  },
  {
    slug: "starting-a-workflow-from-another-system",
    title: "Starting a workflow from an outside system",
    body: `The reverse direction also works: another system can send data in and start a workflow with it. You get an address to give them, and whatever they send becomes available to the steps that follow.

This is how a lead from a source with no direct integration — a marketplace, an event platform, a bespoke website form — arrives as a proper contact with a proper follow-up sequence rather than as an email somebody has to retype.

Send one real example through before building anything on top of it. The workflow needs to see the shape of the incoming data once in order to let you map it onto contact fields, and guessing the field names does not work.

Map carefully and mind formats, especially phone numbers and dates. A number arriving without a country code will not text, and it will fail silently.

Anyone with that address can start the workflow, so do not publish it, and do not build anything that spends money on the first step without a check.`,
  },
  {
    slug: "keeping-workflows-manageable",
    title: "Keeping workflows manageable as they multiply",
    body: `Automations accumulate. Within a year most accounts have dozens, several of which nobody can confidently explain, and that is where the surprises come from.

Name them so the list reads as an index: what starts it and what it does. "Form — free quote — 5 day follow up" tells you everything; "New workflow 3" tells you to open it.

Use folders once there are more than about fifteen, grouped the way you actually think about the business rather than by feature.

Keep each one short and let workflows call each other. One shared "new customer welcome" sequence that three different entry points add people to is one thing to fix when the welcome changes.

Write a sentence in the description saying why it exists. In six months you will be reading it as a stranger.

Turn off what you are not using rather than leaving it published. A forgotten published workflow is not dormant — it is running, and it will send something one day.

Before deleting, check nothing else adds people to it. Removing a workflow that another one feeds leaves a dead end nobody notices.`,
  },
];
