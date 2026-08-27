import type { SeedArticle } from "./types";

/** Records past the basics: businesses, hygiene, deletion, segmentation. */
export const CONTACTS_ADVANCED: SeedArticle[] = [
  {
    slug: "business-and-company-records",
    title: "Tracking businesses as well as people",
    body: `Where you sell to organisations rather than individuals, the people are still the records you talk to, but the organisation is the thing you are actually selling to.

Link the people to the business so a record shows everyone you deal with there, and so a deal belongs to the organisation rather than to whichever individual happened to enquire.

That link is what protects you when your contact leaves. Their replacement inherits a relationship with a history instead of starting from nothing.

Keep the details that belong to the organisation on the organisation — address, account terms, who signs things — and the details that belong to a person on the person.

For a business that sells to consumers, skip all of this. Adding an organisation layer where every customer is one household makes every screen more complicated for no benefit.`,
  },
  {
    slug: "keeping-contact-data-clean",
    title: "Keeping your contact data usable",
    body: `Data quality decays on its own, and the cost shows up as campaigns that underperform for reasons nobody can see.

Four habits cover most of it.

Standardise on entry. Decide how phone numbers are stored, make the important fields required on your forms, and use dropdowns rather than free text for anything you will filter on. Forty spellings of one answer is a field you cannot use.

Deduplicate regularly rather than never. A monthly pass over obvious duplicates is ten minutes; a yearly one is an afternoon.

Deal with bounces. An address that hard-bounced will never work, and repeatedly sending to it damages delivery for everybody else.

Prune. Contacts who have never engaged and never will are costing you send volume and skewing every percentage you look at. Archive them rather than deleting, so the history survives.

An export sorted by column is the fastest way to see how bad it actually is.`,
  },
  {
    slug: "segmenting-your-list",
    title: "Sending different things to different people",
    body: `Sending everything to everybody is what kills a list, and the fix is segmentation rather than sending less.

The segments that earn their keep in most businesses are simple: people who have never bought, current customers, lapsed customers, and people who engage with everything you send.

Build each as a saved filter rather than a tag where you can, so it stays current on its own.

The single most valuable one is engagement. People who have opened nothing for six months should be sent to rarely — they do not buy, and their silence teaches mailbox providers to filter you for everyone else. That is the mechanism by which sending more produces less.

Two or three segments used consistently beats a dozen that nobody maintains.

Check the count before every send. A segment that has quietly grown to include everybody is a segment that stopped being one.`,
  },
  {
    slug: "deleting-contacts-and-data-requests",
    title: "Deleting somebody's data when they ask",
    body: `In many places a person can require you to delete what you hold about them, and you have a limited window to comply.

Deleting the contact removes the record and its history. It cannot be undone, so confirm you have the right person and that you are not legally required to keep something — invoices and transaction records usually must be kept for accounting purposes even when the rest goes.

Where you must keep records, keep the minimum and delete the rest, and be able to say what you kept and why.

Suppression is different from deletion. Somebody who asks to stop hearing from you should be marked do-not-disturb, which is not the same as being erased — and you need the record to stay suppressed, because deleting them entirely means they can be re-imported next month.

Ask in writing and keep the request. What you did and when is what you will be asked to demonstrate.

Remember exports. A file downloaded to somebody's laptop is data you still hold.`,
  },
  {
    slug: "bulk-deleting-records",
    title: "Deleting a lot of records at once",
    body: `Filter to exactly what you mean, check the count, and then check the filter again. Bulk deletion has no undo, and a filter that was nearly right is expensive in a way that is not recoverable.

Export the set first. A CSV of what you are about to remove takes a minute and is the difference between a mistake and a disaster.

Prefer archiving or tagging over deleting where the goal is a tidier list. You almost always want the history later, and a filter excludes them just as well.

Delete in a small batch first and look at the result before doing the rest.

Never bulk delete to fix duplicates. Merge them — deleting one of a pair loses whichever history was on the record you removed.

Audit Logs records what was removed and by whom, which will not bring anything back but does end the argument about what happened.`,
  },
  {
    slug: "assigning-owners-to-contacts",
    title: "Giving contacts an owner",
    body: `An owner is the person responsible for a relationship. It drives who gets notified, whose list it appears in, and — where access is restricted — who can see it at all.

Assign on creation rather than later, by round robin, by source, or as a step in a workflow. Records that arrive unowned tend to stay unowned, and unowned means everybody assumes somebody else has it.

Use the owner in your messages so email comes from a person rather than the business. It measurably outperforms, and replies reach whoever knows the history.

Reassign properly when somebody leaves rather than leaving their name on four hundred records. Tell the person receiving them first — a list appearing overnight with no context is a bad Monday.

Where several people work one relationship, still pick one owner. Shared responsibility is the state in which nothing is followed up.`,
  },
  {
    slug: "activity-and-engagement-history",
    title: "Seeing whether somebody is actually engaged",
    body: `Two things look identical on a list and are completely different: a contact who has never heard from you, and one who has ignored fourteen messages.

The record's timeline separates them. Look at what has been sent and what came back — opens, clicks, replies, bookings, money spent.

A contact with no engagement over a long period is not a prospect. Continuing to send to them costs you delivery for everybody else, and moving them to a low-frequency segment is the fix.

A contact who engages with everything and has never bought is worth a phone call rather than another email.

Filter on last engagement rather than on when they were added. Somebody added two years ago who clicked last week is a live prospect; somebody added last month who has done nothing is not.

This is also the first screen to open before any conversation, so you know what has already been said.`,
  },
  {
    slug: "restoring-something-deleted-by-mistake",
    title: "Getting back something that was deleted",
    body: `Assume deletion is permanent and act accordingly, because in most cases it is.

If it has just happened, stop and do not do anything else — particularly do not re-import, which creates a fresh record that then conflicts with any recovery.

Check whether a recent export exists. A CSV downloaded last week is the usual route back for contact data, even if the history does not survive.

Audit Logs will tell you what was removed and by whom, which narrows what you are looking for.

Then ask for help, quickly, with the specifics: what was removed, roughly when, and by whom. Recovery options are time-limited where they exist at all, and the difference between asking in an hour and asking in a fortnight is often the difference between possible and not.

Afterwards, tighten who has permission to delete. This particular mistake is almost always a permission that was broader than it needed to be.`,
  },
  {
    slug: "what-a-contact-can-see-about-themselves",
    title: "What your customers can see and change",
    body: `Contacts do not see your record of them. They see what you send, plus whatever you deliberately expose — a preference page, a portal, their own invoices and appointments.

Preference Management controls the page where somebody manages what they hear from you. Offering choices there rather than only a full unsubscribe keeps people on your list who would otherwise leave entirely.

Internal notes are internal. That said, write them as though they could be read one day: notes are disclosable in several jurisdictions if somebody requests their data, and a note written carelessly is a genuinely awkward thing to hand over.

The same applies to tags. A label describing a person unkindly is a label you would rather not explain.

If you run a portal, look at it as a customer with real data on screen before opening it, and check what appears there that you assumed was private.`,
  },
];
