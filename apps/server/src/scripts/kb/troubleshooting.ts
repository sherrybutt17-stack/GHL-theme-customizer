import type { SeedArticle } from "./types";

/**
 * "It isn't working" — indexed by the SYMPTOM, because that is what people type.
 *
 * These exist separately from the how-to articles on purpose. Retrieval is full-text:
 * somebody typing "my texts aren't sending" shares almost no vocabulary with an article
 * called "Setting up calls and text messages", and would get a setup guide instead of a
 * diagnosis. Titling by symptom is what makes the right one come back.
 */
export const TROUBLESHOOTING: SeedArticle[] = [
  {
    slug: "texts-not-sending",
    title: "My text messages are not being delivered",
    body: `Texts that show as sent and never arrive are nearly always one of five things.

Business messaging registration is not approved yet, or was rejected. Until it clears, carriers filter your messages rather than delivering them, and nothing on your side reports an error. This is the most common cause by a wide margin.

The account balance has run out. Texts are charged per message on top of the plan, and sending stops when the balance does.

The contact is on do-not-disturb, usually because they replied with a stop word at some point. The message is suppressed and the record still looks normal.

The number is wrong or missing a country code. A number stored without one will not send and fails quietly.

The recipient's carrier blocked it as spam, which happens with links, all-capitals text, no business name, or sudden volume from a number with no history.

Check in that order. Send yourself one to a phone you hold as the first test — if that arrives, the problem is the recipient or the content, not the setup.`,
  },
  {
    slug: "emails-not-arriving",
    title: "My emails are not arriving",
    body: `Separate two cases first, because they have different causes: nothing sends at all, or it sends and does not appear.

If nothing sends, the sending domain is not verified, or its DNS records were changed or removed — commonly during a website move. Open the sending settings and look at whether it still shows as verified.

If it sends but does not appear, it is being filtered. Check the spam and promotions folders before anything else, on more than one provider, since one inbox is not a sample.

Then check the contact is not unsubscribed or on do-not-disturb, which suppresses sending without an error.

Look at the contact's timeline. An email that was never sent is absent; one that was sent and filtered shows as sent. That single distinction halves the search.

If it was sent to a work address, ask whether their company filter blocked it. That is common, invisible to you, and only their administrator can release it.`,
  },
  {
    slug: "contact-not-getting-automation-messages",
    title: "One contact is not receiving anything from an automation",
    body: `When it works for everybody except one person, check the record rather than the workflow.

Do-not-disturb, or an unsubscribe. This is the answer most of the time, and everything else on the list is rarer.

They never entered. Open the workflow's history and search for them — if they are not there, the trigger did not match, and the trigger is the thing to look at.

They entered and stopped at a branch, because a field the condition tests is empty on their record. Empty values falling through to a path with nothing in it is the classic version of this.

They are sitting in a wait step, which is not a fault.

A duplicate record: the person you are looking at is not the one in the workflow, and there are two of them under different addresses.

Their address hard-bounced earlier, so sending to it has stopped.

Reading the contact's timeline alongside the workflow history usually settles it in under a minute.`,
  },
  {
    slug: "appointments-not-syncing",
    title: "Appointments are not appearing in my own calendar",
    body: `Sync problems are almost always the connection rather than the appointment.

Reconnect the calendar first. Access expires after password changes and periodic security reviews, and the failure is silent — no error, appointments simply stop moving.

Check the direction. Reading your calendar and writing to it are separate settings, and only one may be on.

Check which calendar was selected. If you have several under one account, bookings may be landing correctly in one you are not looking at.

Timezone mismatch shows as appointments syncing but at the wrong hour, which is a different fix: set the calendar's timezone explicitly rather than leaving it inferred.

Sync is not instantaneous. A minute or two is normal; twenty is not.

If new bookings sync and older ones did not, they were created while the connection was broken and will not backfill by themselves.`,
  },
  {
    slug: "duplicate-contacts-appearing",
    title: "The same person keeps appearing twice",
    body: `Records are matched on an exact email address. Anything that does not match exactly creates a new record, and that explains nearly every duplicate.

The usual sources: they used a work address once and a personal one later; a form collected only a phone number so there was no email to match on; an import ran with a slightly different address; or two channels created records independently.

Merge the pair, choosing the primary carefully — that decides which values survive — and both timelines combine onto it. Merging cannot be undone.

To reduce it happening: ask for email on every form, keep phone number formats consistent, and avoid re-importing lists you have already imported.

Be careful with people who share an address, like a couple using one mailbox. Those are not duplicates, and merging them loses one person entirely.`,
  },
  {
    slug: "cannot-find-a-menu-item",
    title: "A menu item I was told about is not there",
    body: `The sidebar shows what is included in your setup, so an item that is not there is not hidden behind a setting you can find.

Two things account for nearly all of it. It is not part of what you have, in which case somebody from the team can tell you what is included and what adding it would involve. Or your permissions do not include it, in which case whoever administers the account can widen them.

A third, less common: you are in a different account than you think. If you have access to more than one, check the name at the top.

Menu items can also be renamed, so the thing you are looking for may be present under a different word. If you know what it does, describe that rather than the name you were given.

Refreshing the page is worth one try — a recent change to your access needs a reload to appear.`,
  },
  {
    slug: "page-or-form-not-working",
    title: "My form or page is not working for visitors",
    body: `Test it the way a visitor experiences it: a private browser window, on a phone, not logged in. Half of all reports here are a caching or a logged-in difference and disappear at this step.

If the page will not load at all, check it is published, and that the domain is still verified. A domain that lapsed takes every page on it down at once.

If the form shows but submissions do not arrive, check whether a contact was created — if it was, the form worked and the problem is the notification or the follow-up. If nothing was created, the form is not connected to anything, which is a setting on the form.

If it works on desktop and not on a phone, it is a layout problem rather than a fault. Look at the mobile preview in the editor.

If submissions arrive without the details, a required field was not mapped to a real field, so the answer went nowhere.

Submit it yourself with a real address and watch the record appear. That single test locates the break faster than any amount of reading.`,
  },
  {
    slug: "cannot-log-in",
    title: "I cannot log in",
    body: `Use the forgot-password link rather than trying variations, and check the address you are using is exactly the one the account was created against.

If the reset email does not arrive, look in spam, then consider that the account may be under a different address entirely.

If the reset works and you still cannot get in, the login may have been disabled by whoever administers the account. No amount of resetting helps with that; they have to switch it back on.

If you get in but the account looks empty or unfamiliar, you are probably in a different account than you expect. Check the name at the top before concluding data is missing.

If a page loads but nothing works, try a private window with extensions disabled. Browser extensions, particularly blockers and password managers, break specific screens surprisingly often.`,
  },
  {
    slug: "something-is-slow",
    title: "Everything is running slowly",
    body: `First, work out whether it is you or everyone. Ask a colleague on a different connection to open the same screen. If it is fast for them, the problem is local.

Local causes, in order: browser extensions, a browser that has been open for weeks and needs restarting, and the connection itself. A private window with extensions disabled tests all three in one go.

If a specific screen is slow while everything else is fine, it is usually the amount of data on it. A contact list with no filter, a board with hundreds of open cards, or a report over two years will all be slow, and filtering to a sensible range fixes it permanently.

If pages you have published are slow for visitors, that is nearly always images uploaded straight from a phone at full size. Resizing them is the single biggest improvement available.

If it is slow for everyone on every screen, that is worth telling us about rather than retrying — it is something we can see from our side.`,
  },
  {
    slug: "data-looks-missing",
    title: "My contacts or records have disappeared",
    body: `Almost always a filter or the wrong account, and it is worth exhausting those before anything else.

Check the account name at the top. If you have access to more than one, this is the answer more often than not.

Clear the filters on the list. A saved view, a date range or a search term left in the box will hide everything not matching, and it persists between visits.

Check whether you are looking at a saved list rather than all records. The tab you are on may be a filter somebody created.

Check your permissions. Some access levels show only records assigned to you, so a colleague's contacts are genuinely invisible to you.

If records really were deleted, Audit Logs shows what was removed and by whom. That will not restore them, but it turns speculation into a fact, and deletion is usually a bulk action somebody ran with a filter that was nearly right.`,
  },
  {
    slug: "an-automation-sent-twice",
    title: "Someone received the same message twice",
    body: `Four causes, and they are distinguishable from the workflow history.

Two workflows both send it. This is the commonest one and it appears when sequences are built separately over months. Search your workflows for the message rather than assuming.

The workflow has re-entry enabled and the trigger fired again — a tag re-added, a form submitted twice, a stage changed back and forth.

The person exists twice as two records, so each got one message and they have one inbox.

Two triggers on one workflow both matched the same event.

The history tells you which: two entries for one contact means re-entry or duplicate triggers; entries in two different workflows means overlap; one entry and two messages means duplicate records.

The general prevention is fewer, longer workflows rather than many overlapping short ones, and goals that remove people once the thing you were chasing has happened.`,
  },
  {
    slug: "what-to-check-before-reporting",
    title: "Things worth trying before asking for help",
    body: `Four checks resolve a good proportion of problems and take about two minutes.

Hard refresh the page. This clears a stale copy your browser is holding and fixes most "the change I made is not showing".

Try a private window with extensions disabled. This separates a fault from something local to your browser.

Check you are in the right account, and that any filters and date ranges on screen are what you think they are.

Look at the contact's own timeline for the thing that did not happen. Absence and failure look identical from the outside and are completely different problems.

If it survives all four, it is worth telling us about — and worth including what you did, what you expected, what happened, the contact's email or number, and roughly when. That turns several exchanges into one.`,
  },
];
