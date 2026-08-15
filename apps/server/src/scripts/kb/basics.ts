import type { SeedArticle } from "./types";

/** Orientation, access, and the questions asked in the first week. */
export const BASICS: SeedArticle[] = [
  {
    slug: "finding-your-way-around",
    title: "Finding your way around",
    body: `Dashboard is the first screen after login, and it summarises rather than stores. Everything on it lives somewhere else.

The sidebar down the left is how you move: conversations, calendars, contacts, deals, automations, pages. Settings sits at the bottom and holds the setup that applies to the whole account rather than to one record.

Search is usually the fastest way to a contact. Typing part of a name or number beats clicking through a list.

If a menu item you were expecting is not there, it is not hidden behind a button — it is not part of your setup, and someone from the team can tell you what is included.`,
  },
  {
    slug: "logging-in-and-password-reset",
    title: "Logging in, and what to do if you cannot",
    body: `You log in with the email address your account was created against, and a password you set yourself from the invitation you were sent.

If the password is not working, use the forgot password link on the login screen rather than trying variations. It sends a reset link to that same address, and the link expires after a short while, so use it when it arrives rather than later in the day.

If the reset email does not appear, check the spam folder first, then check you are using the exact address the account was set up with. An account created against a work address will not recognise a personal one, and there is no way to guess which was used.

Two other things account for most of the remaining cases. A login can be disabled by whoever administers the account, in which case a reset will never help and you need them to switch it back on. And if you have access to more than one account, you may be logging in successfully but landing in a different one than you expect — check the account name at the top before assuming your data is missing.`,
  },
  {
    slug: "your-profile-and-notifications",
    title: "Your own profile, signature and notification settings",
    body: `Your profile holds the things that are yours rather than the business's: your name as it appears to colleagues, your own email signature, your phone number, and how you want to be notified.

The signature is worth setting properly on day one. It is appended to messages you send from your own user, and an empty one is the most common reason a perfectly good reply looks like it came from nobody.

Notification settings control what reaches you and how — a new inbound message, a booked appointment, a form submission. Turn off what you do not act on. A notification everybody has learned to ignore is worse than no notification, because it also hides the ones that matter.

If you are getting alerts for another person's conversations, that is usually assignment rather than settings: the record is assigned to you, so its activity is yours. Reassigning it moves the notifications with it.`,
  },
  {
    slug: "using-the-mobile-app",
    title: "Using the mobile app",
    body: `There is a phone app that mirrors the parts of the account you need when you are not at a desk: your messages, your customer records, your diary, and taking a card payment in person.

Sign in with the same email and password you use in the browser. Everything is the same account and the same data — a reply sent from the phone appears in the conversation on the desktop immediately, and the other way round.

Turn on push notifications when it asks. The app's main value is that an inbound message reaches you in the ten minutes it matters rather than the next time you open a laptop, and it cannot do that if notifications are off.

What the app deliberately does not do is the building. Automations, pages, forms and settings are desktop work. If you cannot find something on the phone, that is usually why rather than a fault.`,
  },
  {
    slug: "searching-and-finding-records",
    title: "Searching for a contact or record",
    body: `The search box at the top finds people by name, email address or phone number, and partial matches work — typing three or four characters is usually enough.

Phone numbers are the most reliable thing to search on, because people spell names inconsistently and businesses get entered three different ways. If a search by name comes up empty, try the number before concluding the record does not exist.

Search covers records, not message content. Looking for the conversation where somebody mentioned a particular thing is a different job: open the contact and read their timeline, which holds every message, note, appointment and payment in one place.

If a contact genuinely is not there, the two usual explanations are that it was created in a different account, or that it exists under a second email address and you are searching the one you know.`,
  },
  {
    slug: "why-the-branding-looks-wrong",
    title: "Why the branding looks wrong or has not updated",
    body: `Branding is delivered as a stylesheet that loads when the page loads, so a change made in the control panel shows up on the next full refresh rather than instantly.

If a change has not appeared, hard refresh the page first. That skips the cached copy your browser is holding, and it resolves most reports of this kind on its own.

If it is still wrong after a hard refresh, check that the branding is switched on for that specific sub-account. Settings are per sub-account, so one can be fully branded while another sitting next to it is untouched.

If the whole page appears unstyled rather than merely out of date, the stylesheet has not loaded at all. That is worth telling us about rather than retrying, and it is something we can see from our side.`,
  },
  {
    slug: "what-the-launchpad-is-for",
    title: "The setup checklist when an account is new",
    body: `A new account opens on a short setup list rather than an empty screen, and working straight down it is genuinely the fastest route to something usable.

The order matters more than it looks. Connect the things messages depend on first — your sending address and your phone number — because both need verification that takes hours or days, and everything else you build will sit waiting on them. Start those on day one even if you build nothing else until they clear.

After that, the business details: your name, address and logo, which appear on invoices, emails and booking pages. Then a calendar if people book time with you, and a pipeline if you track deals.

Automations come last on purpose. They are the part that pays off most, and also the part that is worthless if it fires an email from an unverified domain into somebody's spam folder.

You can dismiss the checklist and come back to it. Nothing on it expires.`,
  },
  {
    slug: "sub-accounts-and-switching-between-them",
    title: "Working across more than one account",
    body: `If you look after several businesses, each one is a separate account with its own contacts, calendars, automations and settings. Nothing crosses between them, which is the point — one client's data can never appear in another's.

Switch using the account name at the top of the screen. Everything below it changes at once, and it is worth glancing at that name before you send anything, because the screens look identical.

Settings are per account too. Switching a feature on in one does not switch it on anywhere else, and a template built in one is not automatically available in another. Copying a whole configuration from one account into another is what snapshots are for.

If a colleague can see an account and you cannot, that is a permissions matter rather than a fault — access is granted per account.`,
  },
  {
    slug: "what-the-platform-does",
    title: "What this software is for",
    body: `It is one place for everything that happens between a stranger showing interest and a customer paying you, so those things stop living in five separate tools that do not talk to each other.

Concretely: the messages people send you on any channel land in one inbox; the people themselves are records with a full history; the deals you are working on sit on a board so you can see what is actually in play; appointments book themselves against your real availability; the follow-up that used to depend on somebody remembering runs automatically; and the pages, forms and invoices that collect the money are built in the same place.

The reason to have all of it together rather than a best-of-breed tool for each part is that the history stays joined up. When somebody calls, whoever picks up can see the form they filled in, the email they were sent, the appointment they missed and the invoice they have not paid, without asking them any of it.

You do not have to use all of it. Most accounts start with the inbox and a calendar and grow from there.`,
  },
  {
    slug: "getting-help-and-what-to-include",
    title: "Getting help with something that is not working",
    body: `When something is not behaving, a few specifics turn a long back-and-forth into one reply.

Say what you did, what you expected, and what happened instead. "The confirmation email did not arrive" is a different problem from "the confirmation email arrived twice", and they look identical in a message that only says it is not working.

Name the record. The contact's email address or phone number lets anyone helping you open the exact timeline and see the event, rather than reproducing it on a test record that behaves perfectly.

Say when. Timestamps narrow a search enormously, and "yesterday afternoon" is usually precise enough.

A screenshot of the screen you are on, including the whole window rather than a crop of the error, answers the questions nobody thought to ask.`,
  },
];
