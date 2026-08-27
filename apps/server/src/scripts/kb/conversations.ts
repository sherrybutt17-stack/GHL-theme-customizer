import type { SeedArticle } from "./types";

/** The inbox: every channel, and the things that stop a message going out. */
export const CONVERSATIONS: SeedArticle[] = [
  {
    slug: "replying-to-messages-in-one-place",
    title: "Replying to messages in one place",
    body: `Conversations brings every inbound message into a single list, whichever channel it arrived on, so you are not switching between apps to answer people.

Open a conversation to see the full history with that person and reply from the box at the bottom. The reply goes out on the same channel it came in on.

Unread threads sit at the top. Once a conversation is dealt with you can mark it read or move it out of the way, which keeps the list to things that still need you.

Everything said in a conversation is attached to the contact record, so anyone else on your team picking it up later has the whole story.`,
  },
  {
    slug: "sending-a-text-message",
    title: "Sending a text message",
    body: `Open the contact or the conversation, choose the text channel, type, and send. It goes from your business number, and their reply comes back into the same thread rather than to somebody's personal phone.

Three things have to be true before a text will actually deliver: a number is connected to the account, that number is registered for business messaging, and the contact is not on do-not-disturb. If any one is missing the message will look sent from your side and never arrive.

Keep the first message short and identify yourself. People block numbers they do not recognise, and a name in the first six words is the cheapest protection there is.

Attachments are supported, which is how a photo of a completed job or a copy of an invoice gets to somebody in ten seconds. Very large files are better sent as a link to a hosted file.

Texts are charged per message on top of your plan, and long messages are billed as more than one.`,
  },
  {
    slug: "sending-an-email-from-a-conversation",
    title: "Sending an email to one person",
    body: `From a conversation, switch the channel to email and write as you would anywhere else. It sends from your verified sending address, and the reply comes back into the same thread.

This is the right tool for a one-to-one reply. Sending the same thing to a list is a campaign, and it belongs in the campaign tools instead — bulk-sending from the inbox looks fine and gets you filtered as spam.

You can attach files, use a saved template as a starting point, and personalise with contact fields so the name and details fill themselves in. Preview before sending when you have used fields: an email opening "Hi ," tells the reader exactly what happened.

If sending fails or the message never arrives, that is nearly always the sending domain rather than the message. An address that has not been verified either fails outright or lands in spam.`,
  },
  {
    slug: "message-templates-and-snippets",
    title: "Saving replies you send often",
    body: `Anything you type more than twice a week should be saved rather than retyped. Saved replies are available in the compose box on both text and email, and drop in as editable text rather than something locked.

Write them with fields rather than names — the contact's first name, the appointment time, your business address — so a saved reply arrives personalised instead of generic.

Keep them short and keep the list short. Forty templates nobody can find is the same as none, and people go back to typing.

The real gain is consistency rather than speed. Everyone answering the same question the same way is what makes a small team read like a well-run one, and it makes the wrong answer fixable in one place.`,
  },
  {
    slug: "connecting-facebook-and-instagram",
    title: "Bringing Facebook and Instagram messages into the inbox",
    body: `Both connect through Integrations in Settings. You sign in with the account that manages the page, grant the permissions it asks for, and choose which page or profile to link.

Once connected, messages people send to the page arrive in Conversations alongside everything else, and replies go back out through the same channel. Comments on posts can be brought in too, which is where a lot of buying questions actually get asked.

The permission step is where this goes wrong. It has to be an account with a management role on the page — being an admin of the business but not of that specific page is enough to make the connection appear to succeed and then deliver nothing.

Connections also expire. Both platforms periodically invalidate access, usually after a password change or a permissions review, and the symptom is messages quietly stopping. If a channel goes silent for a day, reconnect it before looking anywhere else.

There is also a messaging window: these platforms limit how long after somebody's last message you may reply. A conversation left for a week may not be answerable on the same channel.`,
  },
  {
    slug: "connecting-whatsapp",
    title: "Using WhatsApp for business messages",
    body: `WhatsApp in Settings connects a business number so those conversations land in the same inbox as everything else.

The setup is stricter than other channels because the platform enforces it. The number has to be a business number that is not already registered to the ordinary consumer app, your business goes through a verification step, and message templates have to be approved before you may use them.

The rule that catches everyone: outside a twenty-four hour window from the customer's last message, you may only send a pre-approved template, not free text. Inside the window you can talk normally. So a reply written an hour after they wrote sends fine, and the same words two days later are rejected.

Get two or three templates approved early — a booking confirmation, a reminder, a "we tried to reach you" — because approval takes time and you will want them the first day you need them, not the first day you ask.`,
  },
  {
    slug: "google-business-messages",
    title: "Answering messages from your business listing",
    body: `Your business listing on the big search platform can accept messages, and those can be routed into the same inbox rather than into an app somebody checks weekly.

Connect it through Integrations in Settings, signing in with the account that owns the listing.

Response time is the thing to know. These messages are answered by people standing outside your shop or comparing you against two competitors, and the platform will show how quickly you typically respond. Slow replies here cost more than slow replies anywhere else.

Route them to whoever is actually at a screen, and consider an automatic first reply that says when a person will follow up. Something honest within a minute beats something thoughtful within a day.`,
  },
  {
    slug: "calling-from-the-platform",
    title: "Making and receiving calls",
    body: `With a number connected, you can call a contact from their record with one click, and the call is logged against them automatically with its duration and outcome.

Inbound calls to your business number ring wherever you have set them to ring: one person, several in turn, everyone at once, or straight to voicemail out of hours.

Recording can be switched on, and where it is, the recording attaches to the contact's timeline. Check the rules where you operate before turning it on — most places require you to tell the other party, and an announcement at the start of the call is the usual way to do it.

Calls that are not answered can trigger follow-up by themselves, which is the single highest-return thing most businesses switch on: a missed call that gets an immediate text asking what they needed recovers a large share of the enquiries that would otherwise just ring out.

Calls are charged per minute on top of your plan.`,
  },
  {
    slug: "voicemail-and-call-recordings",
    title: "Voicemail, recordings and what happens to them",
    body: `A voicemail left on your business number arrives in the conversation with that contact, as audio you can play in the browser, and a transcript if transcription is switched on.

The transcript matters more than it sounds. A list of voicemails is something people work through on Monday; a list of readable messages gets triaged in two minutes, and the urgent one gets found.

Recordings of answered calls behave the same way and sit on the contact's timeline. They are the reason a dispute about what was agreed is usually settled in thirty seconds.

Set the greeting deliberately. The default is functional and anonymous; a fifteen-second greeting naming the business and saying when you return calls measurably reduces how many people hang up and try a competitor.

Both recordings and transcripts are personal data. Keep only what you need, and know where it goes if somebody asks you to delete it.`,
  },
  {
    slug: "missed-call-text-back",
    title: "Texting back automatically when you miss a call",
    body: `When a call to your business number goes unanswered, an automatic text can go out immediately: an apology, and a question asking what they needed.

It is the highest-value thing most businesses switch on, because a missed call is a person who has decided to buy something and is now dialling the next result. Reaching them within seconds, in a channel they can answer while they are busy, converts a large share of what otherwise disappears.

Write it as a person would. "Sorry we missed you — this is Dan at the garage, what can we help with?" outperforms anything that reads like a system message, because the reply rate depends entirely on it not feeling automated.

Two guards are worth setting: do not send it to numbers you called first, and do not send it repeatedly to somebody who rings four times in an hour.

Then make sure the replies are actually watched. An automatic text that opens a conversation nobody answers is worse than silence.`,
  },
  {
    slug: "assigning-conversations-to-people",
    title: "Assigning conversations so nothing is dropped",
    body: `A conversation can be assigned to a person, which puts it in their view and sends them the notifications for it.

On a team of one this is noise. From about three people it is the difference between every message being answered and every message being assumed answered by somebody else — the specific failure where four people read a question, each assume a colleague will take it, and the customer waits a day.

Assignment can happen automatically: by round robin, by who owns the contact, or as a step in a workflow based on what the enquiry is about.

Filter the inbox to what is assigned to you and work that list. Leave everything unassigned and the inbox is a shared pile, which reads as busy and behaves as unmanaged.

Reassigning moves the notifications with it, so handing something over is one action rather than a conversation about a conversation.`,
  },
  {
    slug: "manual-actions",
    title: "Calls and messages a workflow queues for a person",
    body: `Some steps in a sequence should not be automatic. A workflow can queue a call or a message for a human to make, which lands in a list of things to do rather than sending itself.

This is what to use where the personal touch is the point: the follow-up after a quote, the check-in on a big account, the second attempt at somebody who has gone quiet. The system remembers the timing and who is responsible; the human writes the words.

Work the queue as a list and it goes quickly, because everything you need is on screen with the contact's history beside it.

The risk is a queue nobody works. Unlike an automated step, this one silently stops if people ignore it, and the sequence behind it stalls. If a queue is consistently untouched, either give it to somebody whose job it is, or make the step automatic and accept the loss in warmth.`,
  },
];
