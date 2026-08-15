import type { SeedArticle } from "./types";

/**
 * The built-in AI features.
 *
 * Written carefully: these articles describe assistants a CLIENT can configure inside
 * their own account. They must not be mistaken for, or describe, the support bot that
 * is answering — that one never explains its own machinery.
 */
export const AI: SeedArticle[] = [
  {
    slug: "ai-agents-overview",
    title: "What the built-in AI assistants do",
    body: `AI Agents covers the assistants you can switch on inside your own account, as opposed to anything you build yourself.

They fall into a few jobs. One answers inbound messages and books appointments on your behalf. One answers voice calls. One helps write — emails, page copy, post captions — inside the editors. One drafts replies to reviews. And workflows can call a model to classify or summarise something mid-sequence.

The useful framing is that each one drafts or handles the routine, and a person keeps the exceptions. The businesses that get value from these are the ones that decided in advance which conversations must reach a human, and made that path obvious.

Every one of them needs configuring before it is any good: what it may say, what it must not, and when to hand over. Switched on at defaults, they are generic, and generic is worse than nothing in a customer conversation.

Test each against your ten most common real questions before it talks to anybody.`,
  },
  {
    slug: "the-conversation-assistant",
    title: "Letting an assistant answer messages",
    body: `A conversation assistant replies to inbound messages automatically, using instructions and information you give it, and can book appointments during the conversation.

Configure three things properly and it works. What it knows: your services, prices if you publish them, hours, location, the questions you answer twenty times a week. What it may do: answer only, or answer and book. When it stops: the conditions that must reach a person.

Be explicit and generous about handover. Anything about money owed, a complaint, a cancellation, or a request for a human should go to a human immediately. The cost of an assistant that tries to handle a complaint is a customer, not a bad reply.

Set the hours it operates. Many businesses want it after hours and want people during the day.

Then read the transcripts for the first fortnight, every one. That is where you find the confidently wrong answer, and every one you find becomes an instruction that fixes it permanently.`,
  },
  {
    slug: "voice-answering",
    title: "Letting an assistant answer the phone",
    body: `A voice assistant can answer calls, hold a short conversation, take details and book an appointment, or take a message.

The case for it is straightforward: an unanswered call is a lost customer, and this answers every one at three in the morning and during the lunchtime rush.

The case against is that people are less tolerant on the phone than in a chat. Set it up so a caller can reach a person quickly, and so it never argues.

Keep the scope narrow. Answering hours and location, taking a name and number, booking a standard appointment — these work. Quoting a complicated job does not.

Say at the start that it is an automated assistant. Discovering it halfway through annoys people far more than being told.

Listen to the first fifty calls. What people actually say on the phone is not what you imagined, and the fixes are obvious once you have heard them.`,
  },
  {
    slug: "ai-writing-help",
    title: "Getting help writing copy",
    body: `The editors for emails, pages and social posts can generate a draft from a short description, and rewrite or shorten something you have already written.

Use it for the blank page, which is where it saves real time. A draft you edit heavily is still faster than starting from nothing.

Give it more context than feels necessary — who the reader is, what you want them to do, what you sound like — because a one-line prompt produces the generic result people complain about.

Always edit. Generated copy is fluent and slightly weightless, and it names benefits nobody claimed. Specific numbers, real names and the actual details of your business are what you add.

Check every fact. It will produce plausible specifics with total confidence, and a made-up guarantee or price in a published email is your problem rather than its.

Reuse what worked. A draft you edited into something good is a better starting point next time than a fresh generation.`,
  },
  {
    slug: "ai-review-replies",
    title: "Drafting replies to reviews",
    body: `Replies to reviews can be drafted automatically, taking the rating and the text into account, for you to approve or edit.

Reply to everything, positively and negatively. The audience is not the reviewer, it is the next person reading, and an unanswered complaint is read as agreement.

Drafts are genuinely useful for the good ones, where the reply is short and warm and there are twenty of them.

For a poor review, read and rewrite it yourself. A generated apology reads as a generated apology, which makes the complaint worse. Acknowledge the specific thing, say what you are doing, and move it off the public page.

Never publish an automated reply to a negative review unreviewed. That is the one that gets screenshotted.

Vary them. Fifteen identical thank-yous in a row look worse than fifteen silences.`,
  },
];
