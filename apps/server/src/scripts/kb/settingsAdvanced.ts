import type { SeedArticle } from "./types";

/** Account-level configuration people only look for once something is wrong. */
export const SETTINGS_ADVANCED: SeedArticle[] = [
  {
    slug: "time-zone-and-business-hours",
    title: "Time zone and business hours",
    body: `The account's time zone drives everything that happens on a schedule: when a campaign sends, when a reminder goes out, when a workflow's sending window opens, and how every report is bucketed by day.

Set it before you build anything that runs on a schedule. Changing it later shifts the meaning of everything already configured, and the symptom is messages arriving an hour or several hours out with nothing obviously wrong.

Business hours are separate and are about promises rather than mechanics: what your automatic replies say, what response time you offer, and when a workflow may send.

Set them to what you actually do, not what you would like. Hours that say you are open until six when the phone stops being answered at four generate complaints that a shorter, honest window would not.

Include your holidays. An automatic reply promising a response tomorrow, sent during a week you are closed, is worse than an honest out-of-office.

If you serve customers in other time zones, decide deliberately whose time everything runs in and be consistent.`,
  },
  {
    slug: "notification-settings",
    title: "Deciding what you get notified about",
    body: `Notifications fail in one direction far more than the other: too many, until people stop reading any of them.

Turn on what you act on. A new inbound message, a booking, a payment failure, a high-value form. Turn off everything you merely like knowing.

Choose the channel by urgency. Anything needing a response within the hour should be a push notification or a text; anything else is email or nothing.

Send to individuals rather than a shared address. A notification everybody can see is one nobody owns.

Check what your team actually receives rather than assuming. The commonest discovery is one person getting everything and everybody else getting nothing, usually because assignment was never set up.

Review after a month. Any alert that has never once caused somebody to do something is noise hiding the ones that matter.`,
  },
  {
    slug: "managing-tags-across-the-account",
    title: "Tidying up your labels",
    body: `Tags in Settings lists every label in the account and lets you rename or remove one everywhere at once.

Do this once a quarter. Left alone, the list grows to hundreds, with the same idea existing under three spellings, and at that point nobody can use them to filter anything reliably.

Rename rather than recreate. Renaming updates every record and every automation referencing it; creating a replacement leaves the old one applied to half your contacts.

Before deleting one, check whether anything references it. A workflow that starts when a label is added, or a filter built on one, breaks silently when the label goes.

Adopt a naming convention even a crude one — prefix by purpose, keep them lower case, decide singular or plural once. Consistency matters more than the specific scheme.

Delete what nothing references and nothing uses. A label applied to everybody tells you nothing, and one applied to nobody is clutter.`,
  },
  {
    slug: "custom-fields-maintenance",
    title: "Keeping custom fields under control",
    body: `Custom Fields accumulate the same way labels do, and a record with ninety fields is a record nobody fills in.

Group them into folders once there are more than a dozen, arranged the way somebody using the record thinks rather than the order they were created.

Get the type right at creation, because it is the awkward thing to change later. Dropdowns for anything you will filter or report on; a proper date field for dates, or you cannot trigger anything from it; numbers as numbers if you will ever calculate with them.

Before adding one, check whether it already exists under another name. Duplicate fields holding the same thing are the main reason exports are unusable.

Before deleting one, check what reads it — forms, automations, message personalisation, filters. Removing a field that a message uses leaves a blank in every message.

Delete fields nothing has written to in a year. They are a question every new team member has to ask about.`,
  },
  {
    slug: "preference-management",
    title: "Letting people choose what they hear from you",
    body: `Preference Management controls the page somebody sees when they manage their subscription, and its wording is worth ten minutes.

Offering choices rather than only "unsubscribe from everything" keeps people who would otherwise leave entirely. Somebody who wants your monthly summary but not the weekly offer will take that option if it exists, and will unsubscribe completely if it does not.

Keep the list short and describe each option by what they will actually receive and how often.

Honour it immediately and automatically, which it does — but check the outcome once yourself, end to end, because this is the one place where a mistake is both a legal problem and a very visible one.

Put the link in every marketing message. Hiding it does not reduce unsubscribes, it increases spam complaints, which are far more damaging.

An unsubscribe is not a deletion. The record stays, suppressed, which is what stops them being re-imported and mailed again next month.`,
  },
  {
    slug: "who-owns-the-account",
    title: "Making sure the account does not depend on one person",
    body: `The most common serious problem is administrative rather than technical: one person set everything up with their own accounts, and then they leave.

Check three things now.

Who is the administrator here, and is there more than one? A single administrator is a single point of failure, including for holidays.

Which connections were made with a personal login? Calendar, email, social pages, advertising accounts and payment providers made under somebody's individual account die with their access. Reconnect them with an account the business controls.

Where do the domains and the sending domain live, and who can log in there? This is the one people cannot answer, and it is the one that takes a business offline.

Write the answers down somewhere that is not one person's laptop.

None of this is about distrust. It is about the ordinary case where somebody is ill, on holiday, or has simply moved on.`,
  },
  {
    slug: "trying-things-safely",
    title: "Testing changes without affecting real customers",
    body: `There is no separate practice copy, so build the habit of testing safely inside the live account.

Make a test contact with an email address and a phone number you control, and use it for everything. Label it clearly and exclude it from your real segments and reports.

Build new workflows unpublished, then publish and test with that contact before anything real reaches it.

Shorten long waits for the test and write yourself a note to put them back. This is the single most common way a sequence reaches production sending five messages in a minute.

For anything sending at volume, run it to a handful of real people first and read the replies before releasing the rest.

When testing anything that takes money, use the provider's test mode, then remember to switch back — and afterwards buy something with a real card for a small amount and refund it, because test mode does not prove the live path.

Change one thing at a time. When two changes go out together and something breaks, you have two candidates and no way to choose.`,
  },
  {
    slug: "naming-conventions",
    title: "Naming things so you can find them later",
    body: `Everything you build ends up in a list that somebody scans a year later, usually under pressure.

Name for what it does and what starts it. "Form — free quote — 5 day follow up" is an index entry; "New Workflow 3" is a thing you have to open.

Put the date in anything campaign-specific, so a page or email from last spring is identifiable without opening it.

Use folders once a list passes about fifteen, grouped the way you actually think about the business.

Write a sentence in the description saying why it exists. Six months later you are reading your own work as a stranger, and the question is always "why", never "what".

Agree the scheme with whoever else builds things, even loosely. Two conventions is the same as none.

Rename the bad ones as you come across them rather than in one heroic session that never happens.`,
  },
  {
    slug: "what-to-set-up-first",
    title: "The order to set things up in",
    body: `Sequence matters, because two of these take days and everything else waits on them.

Start the slow things on day one, even if you build nothing else: verify your sending domain, and start business messaging registration. Both involve external checks that take days, and every message you plan depends on them.

While those run, do the business profile — name, address, time zone, logo. The time zone especially, because everything scheduled inherits it.

Then the data: custom fields first, then import contacts into them. Importing first and adding fields afterwards means importing twice.

Then the structures you will use daily: a pipeline, a calendar with real availability, and the forms that feed them.

Then automations, last. They are what pays off most and they are worthless firing from an unverified domain into a spam folder.

Add people at the end, once there is something for them to use, and give each the narrowest access that works.`,
  },
  {
    slug: "a-change-i-made-has-not-taken-effect",
    title: "A setting I changed does not seem to have applied",
    body: `Work through these before assuming it did not save.

Refresh the page properly, and check in a private window. A stale copy in your browser accounts for a large share of these.

Check whether the change applies to new activity only. Availability changes do not move existing bookings, a renamed label does not alter messages already sent, and a workflow edit does not affect people already partway through it — they carry on with the version they entered.

Check you changed it in the right place. Many things exist at more than one level: a setting on one calendar rather than all of them, one form rather than the template, one page rather than the site.

Check it was published rather than only saved, for anything with a draft state.

Check somebody else did not change it back. Audit Logs answers this in seconds and ends the speculation.

If it survives all of that, note what you changed, where, and when, and ask — that specificity turns several exchanges into one.`,
  },
];
