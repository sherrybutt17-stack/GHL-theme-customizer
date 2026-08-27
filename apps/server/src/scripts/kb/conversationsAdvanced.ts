import type { SeedArticle } from "./types";

/** Working the inbox: triage, scheduling, internal notes, deliverability of replies. */
export const CONVERSATIONS_ADVANCED: SeedArticle[] = [
  {
    slug: "organising-the-inbox",
    title: "Working the inbox when it gets busy",
    body: `An inbox is only useful if there is a defined "done". Without one it becomes a pile everybody scrolls and nobody clears.

Filter to what is assigned to you and unread, and work that. Everything else is somebody's job, not everybody's.

Deal with each thread once: answer it, assign it, or close it. Reading something and leaving it for later is how a message gets read four times by four people and answered by none.

Use the unread state as a real signal rather than decoration. If half the list is permanently unread, it means nothing.

Close threads that are finished. An inbox showing only live conversations tells you the truth about your workload; one showing everything ever sent does not.

Agree a target for first response and look at it weekly. Speed of first reply predicts conversion better than almost anything else and is entirely within your control.`,
  },
  {
    slug: "scheduling-a-message-for-later",
    title: "Writing a message now and sending it later",
    body: `A message can be written now and scheduled to go at a chosen time.

The obvious use is civility — writing at eleven at night without texting somebody at eleven at night. It costs nothing and it is the difference between looking organised and looking chaotic.

It is also useful for timing something to land when it will be acted on: a reminder the morning of, a follow-up first thing on Monday rather than late on Friday.

Check the time zone it will send in, particularly for customers elsewhere.

Look at what is scheduled before you leave for a holiday. A message that arrives promising a quick reply while the office is shut is worse than none.

If the customer replies in the meantime, cancel the scheduled message. Sending a prepared follow-up to somebody who already answered reads as automated, because it is.`,
  },
  {
    slug: "internal-notes-on-a-conversation",
    title: "Leaving a note for a colleague on a conversation",
    body: `A note on a conversation is internal. The customer never sees it, and it sits in the thread so whoever picks it up next has the context.

This is what stops the handover conversation happening in a separate chat tool where it is lost. Two lines — what they want, what you promised, what to watch for — is enough.

Write them as though they could be read by the customer one day. Notes are disclosable in several jurisdictions if somebody requests their data, and a sarcastic note is a genuinely awkward thing to hand over.

Make the distinction between a note and a reply unmistakable in your own habits. Sending an internal comment to the customer is the single most embarrassing mistake available in a shared inbox, and it happens when people are moving fast.

Note the decision, not the narrative. "Agreed to waive the callout fee" is useful in six months; a transcript of your reasoning is not.`,
  },
  {
    slug: "replying-from-the-right-channel",
    title: "Which channel to reply on",
    body: `Reply on the channel they used, unless there is a reason not to. Somebody who texted wants a text back, and moving them to email usually means losing them.

Reasons to switch: the answer needs an attachment or real length, or the conversation involves anything sensitive that should not sit in a text thread.

When you switch, say so in the original channel. "I've emailed you the details" takes five seconds and prevents them waiting on a reply that went somewhere they were not looking.

Some channels have a reply window enforced by the platform — after a period from the customer's last message you may not be able to send freely, or at all. A conversation left for a week may not be answerable where it started.

Phone is under-used for anything that has gone back and forth more than twice. Two minutes on a call resolves what four messages will not, and the record of it still belongs on the contact.`,
  },
  {
    slug: "when-to-hand-a-conversation-over",
    title: "Handing a conversation to somebody else",
    body: `Reassign it rather than answering on their behalf or telling them about it in passing. Reassigning moves the notifications with it, so it becomes theirs rather than something they were told about.

Leave a note first saying where it has got to and what is expected. A conversation arriving with no context takes longer to pick up than one that was never touched.

Tell the customer a person's name. "I'm passing this to Sarah, who looks after installations — she'll come back to you today" is reassuring; being silently handed to a stranger is not.

Then follow the promise. The commonest failure is a handover where nobody told the customer, and the second commonest is one where the promised timescale passed.

Do not hand over twice. A conversation that has been through three people needs somebody to own it to the end, and the customer has already explained themselves three times.`,
  },
  {
    slug: "message-not-showing-in-the-inbox",
    title: "A customer says they messaged and I cannot see it",
    body: `Check which channel they used first, and whether that channel is actually connected. A page connected months ago that has since expired stops delivering silently, with no error to see.

Reconnect anything that has gone quiet before investigating further — that is the answer most of the time.

Then search for the contact by phone number rather than name. The message may be on a second record created because the details did not match an existing one.

Check the filters on the inbox. A saved view, an assignment filter or an unread filter will hide it while everything looks normal.

Check whether it went to a colleague. If it is assigned to somebody else, it is in their list, not yours.

If they replied to an email from an address that does not accept replies, it went nowhere and there is nothing to find. Check the reply-to address on whatever you sent them.

Ask them what it said and roughly when. That is usually enough to locate it or to establish that it never arrived.`,
  },
  {
    slug: "signatures-and-how-replies-look",
    title: "Making replies look like they came from a person",
    body: `Set your signature properly on day one. An empty one is the commonest reason a perfectly good reply looks like it came from nobody.

Name, role, business, and one contact method. Anything longer is scrolled past, and a signature with four social icons and a legal disclaimer looks like a marketing email rather than a person answering.

Send from a person rather than the business where you can. Replies from a named individual are opened and answered more than replies from an anonymous inbox.

Check what your messages look like on a phone before deciding they are fine. Most of them are read there.

Keep formatting minimal. Coloured text, several fonts and a large image in a signature all push a plain reply towards a spam folder and none of them help.`,
  },
  {
    slug: "answering-out-of-hours",
    title: "Handling messages outside working hours",
    body: `The wrong answer is silence, and the second wrong answer is pretending to be available.

Set an automatic first reply that says when a person will respond, and then meet it. "Thanks — we're closed now and will come back to you before 10am tomorrow" is better received than a reply at midnight, because it sets an expectation you can keep.

Capture what you need in the meantime. If the automatic reply asks what they need, the person picking it up in the morning starts with the answer rather than with an introduction.

Decide what counts as urgent and give it a real route. A business where a genuine emergency waits until Monday should say so plainly rather than leaving people guessing.

Do not promise a response time you only meet on quiet days. An honest four hours beats an optimistic one hour, because the customer plans around what you said.

Then look at the volume. Consistent out-of-hours enquiries are a staffing question, not a messaging one.`,
  },
  {
    slug: "bulk-replying",
    title: "Answering many similar messages at once",
    body: `When several people ask the same thing — a delay, an outage, a change — answer them together rather than one at a time.

Filter or select the conversations, and send one message to all of them. Use fields so each arrives with the person's own name and details rather than reading as a circular.

Say the same thing to everybody. Slightly different accounts of a problem, given to people who talk to each other, is how a small issue becomes a credibility one.

Say what happened, what you are doing, and when they will hear next. Then meet that date even if the news is that there is no news.

Get ahead of it where you can. A message before people ask is received completely differently from the same message sent after they complained.

Save it as a template if it is the kind of thing that recurs, so the next time it takes two minutes.`,
  },
  {
    slug: "recording-calls-and-consent",
    title: "Recording calls, and what you have to tell people",
    body: `Recording can be switched on, and where it is, the recording attaches to the contact's timeline.

The rules vary by jurisdiction and they are not optional. Most places require at least that the other party is told; some require their explicit agreement; a few require agreement from everybody on the call. Getting this wrong is a legal problem rather than a settings one.

The practical answer nearly everywhere is an announcement at the start of the call saying it may be recorded, and a note in your privacy policy explaining why and for how long you keep them.

Keep them only as long as you need them. Recordings are personal data, they accumulate, and somebody may ask you to delete theirs.

Decide who can listen to them. Access to every customer call is broader than most roles need.

The upside is real: a dispute about what was agreed is settled in thirty seconds, and new staff learn faster from real calls than from any amount of training material.`,
  },
];
