import type { SeedArticle } from "./types";

/**
 * Security, privacy and compliance.
 *
 * Written to be useful without pretending to be legal advice — the rules genuinely
 * differ by country, and an article that states one jurisdiction's rule as universal is
 * worse than one that says "check yours".
 */
export const SECURITY: SeedArticle[] = [
  {
    slug: "keeping-your-account-secure",
    title: "Keeping your account secure",
    body: `Most account compromises are not sophisticated. They are a reused password, a login that should have been removed months ago, or somebody clicking a convincing email.

Four things cover nearly all of it.

Use a unique password here, stored in a password manager. Reused passwords are the single commonest route in, because a breach anywhere else becomes a breach here.

Turn on a second factor wherever it is offered. It defeats a stolen password entirely, which no amount of password complexity does.

Give people the narrowest access that lets them work, and review the list every few months. Old logins nobody has thought about are how an account is accessed by somebody who should no longer have it.

Remove access the day somebody leaves, including any connections they made with their own accounts.

Then check Audit Logs occasionally. Knowing what normal looks like is what lets you notice when something is not.`,
  },
  {
    slug: "two-factor-authentication",
    title: "Adding a second step to your login",
    body: `A second factor means a stolen password is not enough on its own — a code from your phone is also needed.

It is the single highest-value security setting available, and the objection to it is always the same: it is mildly annoying. It is, for about four seconds a session, and it defeats the entire category of attack that actually happens.

An authenticator app is better than codes by text, because a text can be intercepted by somebody persuading a phone company to move your number. Either is enormously better than nothing.

Save the recovery codes somewhere that is not the phone. Losing the phone without them is a genuine problem, and it is the reason people are nervous about turning it on.

Require it for anybody with settings or export access at minimum. Those are the accounts where a compromise is expensive.

If you lose access entirely, recovery goes through whoever administers the account rather than being self-service — that is deliberate, since self-service recovery is a way around the protection.`,
  },
  {
    slug: "phishing-and-suspicious-messages",
    title: "Recognising a message that is trying to steal your login",
    body: `The convincing ones are not badly spelled any more. They look exactly like a real notification and they create a reason to hurry: a payment failed, an account will be suspended, a document is waiting.

The reliable defence is not judging the message but refusing to follow its link. Open the site yourself, the way you normally do, and check. If it is real, it will be there.

Be most suspicious of anything asking you to log in, and of anything about money that arrives unexpectedly.

Check the sender's actual address rather than the display name, which anybody can set to anything.

If you entered a password somewhere you now doubt, change it immediately here and anywhere it was reused, and tell whoever administers the account. Speed matters more than embarrassment.

Tell your team what a real notification looks like. People who know what to expect spot the fake one.`,
  },
  {
    slug: "who-can-see-what",
    title: "Controlling what each person can see",
    body: `Access is set per person, and two separate things are being decided: which sections they can open, and what they may do there.

Deleting and exporting deserve the most thought. Someone who can export can take your entire customer list with them, which is a different order of risk from being able to answer messages.

Restricting somebody to their own records suits salespeople and contractors. Full visibility suits a small team where everybody covers for everybody.

Settings access should be rare. Most people never need it, and accidental changes made there are the ones that take longest to diagnose.

Widen access when asked rather than granting it in advance. It is far easier than working out what went wrong after everything was open to everyone.

Review the whole list when somebody leaves and again periodically. Access granted for a project three years ago is still access.`,
  },
  {
    slug: "handling-a-data-request",
    title: "When somebody asks what data you hold on them",
    body: `In many jurisdictions a person can ask what you hold about them, ask for a copy, ask for corrections, and ask you to delete it — usually with a deadline of a few weeks.

Verify who is asking before sending anything. Handing somebody's data to a stranger who claimed to be them is itself a breach, and it is the mistake made under time pressure.

Then gather what you actually hold: the contact record and its fields, the conversation history, appointments, invoices, notes and any files. Remember exports sitting on somebody's laptop, and anything synced to another system.

Send it in a readable form rather than a raw dump.

For deletion, delete what you can and keep only what you are legally required to keep — transaction records usually must be retained. Be able to say what you kept and why.

Keep the request and your response. What you did and when is exactly what you will be asked to demonstrate.

If you receive these regularly, write the process down once rather than improvising each time.`,
  },
  {
    slug: "consent-and-marketing-permission",
    title: "Proving somebody agreed to hear from you",
    body: `Consent is not a checkbox you remember ticking, it is a record you can produce.

A form submission does this for you: it records who, when, and what they were agreeing to at the time. That is why collecting through a form beats typing somebody in after a conversation.

Say what they are signing up for in plain words next to the button. Burying marketing consent in terms and conditions is not consent in most jurisdictions.

Do not pre-tick the box, and do not make agreeing to marketing a condition of getting a quote. Both invalidate it in several places.

Keep the record for as long as you keep the contact. Consent given four years ago and never acted on is worth re-confirming rather than relying on.

An existing customer is usually treated differently from a cold prospect, and transactional messages differently from marketing — but the line is narrower than people assume, and adding an offer to a receipt moves it.

Where you operate across borders, the strictest rule applies. Design for that and stop thinking about it.`,
  },
  {
    slug: "what-to-do-if-something-is-breached",
    title: "If you think data has been exposed",
    body: `Act in this order, and act quickly, because most jurisdictions have a short notification deadline measured in days.

Stop the bleeding. Change passwords, revoke the key or connection involved, and remove access for any account you suspect.

Establish what was actually exposed, whose, and for how long. Audit Logs and your provider's own logs are where this comes from. Resist the urge to guess — the scope determines everything that follows.

Write down what you know and when you knew it, as you go. You will be asked to reconstruct the timeline and memory is not good enough.

Then take advice on your notification obligations. Many places require you to tell a regulator within a set number of days, and to tell affected people where there is real risk to them.

Tell people plainly if you must tell them: what happened, what it means for them, what to do. Attempting to minimise it is what turns an incident into a story.

Afterwards, fix the cause rather than the symptom. Almost every one of these traces back to access that was broader than it needed to be, or a login that should have been removed.`,
  },
  {
    slug: "sensitive-information-in-messages",
    title: "What not to put in a message",
    body: `Messages are stored, forwarded, read on unlocked phones and occasionally disclosed. Some things should not go into one.

Never card numbers. If somebody sends theirs, delete it and send a payment link instead — holding card details in a message thread puts you in possession of data you have no business storing.

Passwords, and anything that grants access. If you must share credentials, use a proper mechanism and change them afterwards.

Identifying documents beyond what you genuinely need, and only where you can say why you hold them and for how long.

Health, financial and similar details are subject to stricter rules in most places. Ask whether it needs to be written down at all.

Also worth avoiding: opinions about people. Notes and messages can be disclosed to the person they describe, and a careless line is a genuinely awkward thing to hand over.

The test is simple. Would you be comfortable if this appeared in front of the person it is about, or in a screenshot? If not, pick up the phone.`,
  },
  {
    slug: "leaving-and-taking-your-data",
    title: "Getting your data out",
    body: `Your data is yours, and it is worth knowing how to get it out before you ever need to.

Contacts export as a CSV, with custom fields as their own columns. Filter first and export what you need rather than everything at once.

Invoices and transactions export from the billing screens, which is what your accountant will want.

Conversations are the awkward one. Message history does not always export cleanly, and if it matters to you, find out how it comes out before you depend on it.

What you build — pages, workflows, calendars, templates — is configuration rather than data. A snapshot captures it for reuse here; it will not transfer to another product.

Take an export periodically anyway, not only when leaving. A recent CSV is the difference between a mistaken bulk deletion being an inconvenience and being unrecoverable.

Treat any export as sensitive the moment it exists. It is other people's details sitting outside the system, and the rules about where it is stored and who sees it still apply.`,
  },
];
