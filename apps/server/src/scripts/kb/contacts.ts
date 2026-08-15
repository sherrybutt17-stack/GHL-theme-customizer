import type { SeedArticle } from "./types";

/** People, the fields on them, and the ways of finding groups of them. */
export const CONTACTS: SeedArticle[] = [
  {
    slug: "adding-a-new-contact",
    title: "Adding a new contact",
    body: `Open Contacts from the left sidebar and click the New Contact button in the top right corner of the list.

Fill in whatever you know: first and last name, email address, phone number. Only one of email or phone is strictly needed, though records with both are much easier to work with later.

Save, and the record appears in your list straight away. You can open it again at any time to add tags, notes or custom fields.

If you have a spreadsheet of people to add rather than one contact, use the import option at the top of the Contacts list instead. Match your spreadsheet columns to the fields on screen, and check the preview before confirming, because an import that maps phone numbers into the name field is tedious to unpick afterwards.`,
  },
  {
    slug: "importing-a-spreadsheet-of-contacts",
    title: "Importing a spreadsheet of contacts",
    body: `Import Data in Settings, or the import option at the top of the Contacts list, takes a spreadsheet and turns it into records.

Save the file as a CSV first. One person per row, a header row naming each column, and split first and last names into separate columns before you start rather than after.

The mapping screen is the part that matters. Every column has to be pointed at the right field, and it is worth checking phone and email specifically, because those are the ones that quietly land in the wrong place.

Add a tag identifying where the list came from. It costs nothing and means you can find or undo that batch later.

Then check the preview and import a handful of rows first. Fixing five bad records is a minute; fixing four thousand is a day.`,
  },
  {
    slug: "custom-fields",
    title: "Storing information the standard fields do not cover",
    body: `Custom Fields in Settings let you record the things specific to your business — a policy number, a vehicle registration, a preferred appointment time, how somebody heard about you.

Create the field once and it appears on every contact record, and everywhere else that reads contact data: forms, automations, emails and page personalisation.

Pick the type carefully, because it is the part that is awkward to change later. A dropdown with fixed options gives you something you can filter and report on; the same information typed into a text box gives you forty spellings of the same three answers. Use a date field for dates rather than text, or you cannot use it to trigger anything.

Group related fields into folders once you have more than a dozen, otherwise the contact record becomes a wall.

The distinction that trips people up: a custom field holds something different for each person. Something that is the same for the whole business — your address, your booking link — is a custom value instead.`,
  },
  {
    slug: "smart-lists-and-filters",
    title: "Filtering contacts and saving the view",
    body: `The filters above the Contacts list narrow it by anything on the record: a tag, a field value, when they were added, where they came from, whether they have an appointment booked.

Once a set of filters is useful, save it as a list. It appears as a tab you can return to, and it stays current on its own — someone who matches the rules tomorrow appears in it tomorrow, and someone who stops matching drops out.

That self-updating behaviour is the reason to prefer a saved filter over a tag wherever the thing you are describing is a fact already on the record. Tag people for decisions ("wants the premium package"); filter for facts ("in this postcode", "added this month", "no appointment yet").

Saved lists are also the fastest way to start a campaign or a bulk action, because the list is already exactly the people you meant.`,
  },
  {
    slug: "tags",
    title: "Organising contacts with tags",
    body: `Tags are labels you put on contacts so you can find groups of them later. Add them by hand on a contact record, or automatically as a step in a workflow.

Keep tags meaningful and few. A tag applied to everybody tells you nothing, and forty overlapping tags nobody remembers the rules for is worse than none.

Agree a naming convention early, even a crude one. Prefixing by purpose — source, interest, status — keeps the list readable once it is long, and stops the same idea existing three times under three spellings.

Tags are also the most common way one part of the system talks to another: a form adds a tag, a workflow starts because that tag was added, a filter finds everybody carrying it. That is convenient and it is also how tag lists grow out of control, so delete the ones nothing references.

Tags in Settings shows every tag in the account and lets you rename or remove one everywhere at once.`,
  },
  {
    slug: "merging-duplicate-contacts",
    title: "Duplicate contacts, and how to merge them",
    body: `Duplicates almost always come from the same cause: the same person arriving through two routes under two different email addresses, or with a phone number formatted differently. Records are matched on an exact email address, so anything that does not match exactly creates a new one.

You can merge two records into one. Choose which is the primary — that decides which values win where the two disagree — and the history from both is combined onto it. Messages, appointments, notes and invoices all come across.

Merging cannot be undone, so check you have the right pair. Two people at the same company sharing an office number are not duplicates, and merging them loses one of them.

To stop it happening again, reduce the number of ways a record can be created without an email address, and standardise how numbers are entered on your forms.`,
  },
  {
    slug: "bulk-actions-on-contacts",
    title: "Doing something to a lot of contacts at once",
    body: `Select contacts in the list — individually, or everything matching the current filter — and the bulk actions appear above it.

You can add or remove a tag, add them to a workflow, send a one-off message, assign them to a person, or export them. It is the fastest way to act on a segment you have just built.

Two habits are worth having. First, filter to exactly the people you mean and check the count before acting: "all contacts" is nearly always wrong and it is the default. Second, prefer adding a tag as a first step, so that if the action was a mistake you can find precisely who it touched.

Bulk adding people to a workflow is the one to be most careful with, because it can send hundreds of messages in a few minutes. Send yourself a test through the same workflow first.`,
  },
  {
    slug: "do-not-disturb-and-unsubscribes",
    title: "Stopping messages to someone who has opted out",
    body: `Every contact has a do-not-disturb setting, which suppresses outbound messages to them without deleting anything.

It can be switched on by hand, and it is also set automatically when somebody replies with a stop word to a text, or unsubscribes from an email. That is deliberate: honouring an opt-out is a legal obligation in most places, not a courtesy, and it should not depend on a person noticing the reply.

You can suppress channels individually, so a customer who does not want texts can still receive their invoice by email.

Two things surprise people. A contact on do-not-disturb still enters workflows — they just do not receive the messages, so the record looks as though it is running normally. And re-enabling it by hand does not un-do an unsubscribe in any meaningful sense: if they asked to stop, get their explicit agreement before switching it back on.

Preference Management in Settings controls the wording of what people see when they manage their own subscriptions.`,
  },
  {
    slug: "notes-and-tasks-on-a-contact",
    title: "Notes and tasks on a contact record",
    body: `A note is what happened. A task is what still has to happen. Keeping them separate is the whole trick.

Notes are free text on the record, stamped with who wrote them and when, and they are the cheapest thing in the system to be generous with. Two lines after a call — what they asked, what you promised — is what makes the next conversation good, whoever picks it up.

Tasks carry a due date and an owner and show up in that person's list. Assign them to a real person rather than leaving them unassigned, because an unassigned task is a note with extra steps.

Both sit on the contact's timeline alongside their messages, appointments and invoices, so the record reads as one story rather than several.

Workflows can create tasks automatically, which is how "somebody should call this lead" stops depending on somebody remembering.`,
  },
  {
    slug: "the-contact-timeline",
    title: "Reading a contact's history",
    body: `Open a contact and the timeline down the middle is every interaction in one column: messages on every channel, calls and their recordings, emails opened, forms submitted, appointments booked and missed, invoices paid, notes added, workflows entered, labels applied.

This is the screen to open before answering anybody. It answers "have we already replied", "did they get the quote", "why are they annoyed" faster than asking a colleague.

It is also the first place to look when something did not happen. A missing confirmation email shows as absence on the timeline, which tells you the message was never sent — a different problem from one that was sent and went to spam, which shows as sent.

You can filter the timeline down to one activity type when a busy record gets hard to read.`,
  },
  {
    slug: "exporting-contacts",
    title: "Exporting contacts to a spreadsheet",
    body: `Filter the Contacts list to the people you want, select them, and choose export. The file arrives as a CSV, either downloaded directly or emailed to you depending on how large it is.

Export what you filtered rather than everything. A file of the whole database is slower, harder to work with, and a larger problem if it ends up somewhere it should not.

Custom fields come out as their own columns, which makes an export a reasonable way to check data quality across a lot of records at once — sorting a column is the quickest way to spot the ten people whose phone numbers were entered as text.

Treat the file as sensitive once it exists. It is other people's contact details sitting outside the system, and the usual rules about where it may be stored and who may see it apply.`,
  },
  {
    slug: "lead-scoring",
    title: "Scoring leads so the best ones surface",
    body: `Manage Scoring in Settings lets you attach points to the things a contact does, so a list of two thousand people sorts itself by who is actually worth calling.

Set rules for what earns points: opening an email, clicking a link, submitting a form, booking a call, visiting a pricing page. Weight them by what genuinely predicts a sale in your business rather than by what is easy to measure — booking a call is worth far more than opening a newsletter, and the scores should say so.

You can also subtract points, which is what keeps scores honest over time. Inactivity for sixty days should cost something, or everyone drifts upward forever and the score stops discriminating.

Then filter or sort by score, and let a workflow act on a threshold — notify an owner when somebody crosses it, rather than expecting anybody to watch the number.

Start with three or four rules. A scoring model with thirty rules is not more accurate, it is merely harder to explain when it is wrong.`,
  },
  {
    slug: "custom-objects",
    title: "Tracking things that are not people",
    body: `Objects in Settings is for the records your business cares about that are not contacts — a property, a vehicle, a policy, a pet, a course enrolment, a piece of equipment.

Each object gets its own fields and its own records, and links to the contacts it relates to. That relationship is the point: one person can have three vehicles, and one property can have a buyer and a seller, neither of which fits into fields on a contact record.

Before building one, check whether custom fields on the contact would do. If every contact has exactly one of the thing, and always will, a field is simpler and everything already reads it. Reach for an object when the answer is "they might have several", or "the thing outlives the person".

Once built, objects can be filtered, reported on, and referenced from automations in the same way contacts are.`,
  },
];
