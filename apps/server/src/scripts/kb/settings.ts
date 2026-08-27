import type { SeedArticle } from "./types";

/** Account setup: the things that must be right before anything else works. */
export const SETTINGS: SeedArticle[] = [
  {
    slug: "connecting-your-own-domain",
    title: "Connecting your own domain",
    body: `Domains & URL Redirects in Settings is where a page or funnel stops living on a system address and starts living on your own web address.

Add the domain you want to use, then add the DNS record it shows you at whoever manages your domain name — usually the company you bought it from. A CNAME pointing at the value on screen is the normal case; a root domain like example.com without the www sometimes needs an A record instead, and the screen tells you which.

DNS changes are not instant. Fifteen minutes is common, a few hours is possible, and there is nothing to fix in the meantime — it simply shows as unverified until the record propagates.

Once it verifies, set which page loads at the root of that domain, so visitors typing the bare address land somewhere sensible rather than on an error.

If it will not verify, the usual culprits are a record added to the wrong domain, a duplicate record fighting the new one, or a proxy sitting in front of the DNS and hiding it.`,
  },
  {
    slug: "sending-email-from-your-own-address",
    title: "Sending email from your own address",
    body: `Email Services in Settings is where you connect the address your messages go out from.

Until you verify a sending domain, messages either do not send or land in spam, because mailbox providers have no way to tell you are allowed to send as that address. Verification means adding a few DNS records — SPF, DKIM and usually DMARC — at whoever manages your domain, exactly as shown on screen.

Use a real domain you control. Free mailbox addresses from the big providers are rejected as sending identities, which is the most common reason a first campaign silently fails.

After it verifies, send yourself a test before anything goes to a list. Check it arrives in the inbox rather than the promotions tab, and that the from-name reads the way you want.

Warm up gradually. A brand new domain that sends two thousand emails on day one gets throttled; a few dozen a day building up over a fortnight does not.`,
  },
  {
    slug: "setting-up-calls-and-texts",
    title: "Setting up calls and text messages",
    body: `Phone System in Settings holds the numbers you call and text from.

Buy a number there, or connect one you already own. Once a number is attached, calls and texts flow into Conversations alongside everything else, so a call and an email from the same person sit on one timeline.

Before you can text US numbers you have to register for A2P — an industry requirement, not a platform one. You submit your business details, they are checked, and approval usually takes a few days. Texts sent before approval get filtered by the carriers rather than delivered, and there is no way around that step.

Set what happens to inbound calls: ring one person, ring several in turn, or go to voicemail. Recordings and voicemail transcripts, if you turn them on, attach to the contact record automatically.

Calls and texts are charged per use on top of your plan, so if sending stops working, check the account balance before assuming something is broken.`,
  },
  {
    slug: "a2p-registration",
    title: "Registering to send business texts",
    body: `Sending texts to American or Canadian numbers requires registering your business with the carriers first. It is their requirement, applies to every platform equally, and cannot be skipped or expedited.

You submit your legal business name, address, tax or company registration number, a website, and a description of what you will send with sample messages. It is then reviewed, which typically takes a few days.

Rejections are common and nearly always for the same handful of reasons: the business details do not match public records exactly, the website is missing or has no privacy policy, the sample messages do not show how people opted in, or there is no visible opt-out wording.

The single best thing you can do before submitting is put a privacy policy on your website that says you send texts and how people stop, and make your sample messages include a name and an opt-out.

Start it on day one. Everything else you build that sends a text is waiting on this, and it is the longest lead time in the whole setup.

Until it is approved, texts appear to send and are filtered by the carrier rather than delivered — there is no error to see.`,
  },
  {
    slug: "adding-a-team-member",
    title: "Adding a team member and controlling what they see",
    body: `Team members are added in settings, under the team or staff section.

Add somebody with their name and email address, and they get an invitation to set their own password. Choose their permission level at the same time, which controls what they can open and change once they are in.

Give people the narrowest access that lets them do their job. It is far easier to widen someone's access when they ask than to work out what went wrong after everything was open to everyone.

If somebody leaves, disable their account rather than deleting it. Their history stays attached to the conversations and records they touched, which you will want later.`,
  },
  {
    slug: "permissions-in-detail",
    title: "Deciding what each person can do",
    body: `My Staff in Settings lists everyone with access and what they may do. Permissions are per person and per account, so somebody can be an administrator in one place and see nothing in another.

Two things are being set and they are worth separating in your head. What sections they can open — the inbox, the customer records, the billing screens, the settings — and what they can do there, which includes deleting, exporting and changing configuration.

Exporting is the permission to think hardest about. Someone who can export can take your entire customer list with them, and that is a different order of risk from being able to reply to messages.

A staff member who can only see their own people and their own messages is the right setup for salespeople and contractors. Full visibility suits a small team where everyone covers for everyone.

Settings access should be rare. Most people never need it, and the accidental changes made there are the ones that take longest to diagnose.

Review the list when somebody leaves, and again every few months. Old logins nobody has thought about are the most common way an account is accessed by someone who should no longer have it.`,
  },
  {
    slug: "reusing-the-same-details-everywhere",
    title: "Reusing the same details everywhere",
    body: `Custom Values in Settings are the details that appear in dozens of places and change all at once — your business address, your booking link, your support number, an offer price.

Set the value once, then drop the placeholder into emails, texts, pages and automations instead of typing the detail out. When it changes, you edit it in one place and everything that references it updates.

The difference from a custom field is worth getting straight: a custom field holds something different for each contact, like their birthday. A custom value holds one thing for the whole account, like your office address.

Where they earn their keep is a rebrand or a move. Changing an address that was typed by hand into forty emails is a bad afternoon; changing it once is a minute.`,
  },
  {
    slug: "business-profile",
    title: "Your business details and where they appear",
    body: `The business profile holds your trading name, address, phone number, logo and the time zone the account runs on. These are not cosmetic — they appear on invoices, in email footers, on booking pages, and in the registration submitted to carriers.

Two of them cause real problems when wrong.

The time zone drives every scheduled thing in the account: when a campaign sends, when a reminder goes out, when a workflow's sending window opens. Set it to where the business operates, and set it before you build anything that runs on a schedule.

The address and legal name must match your public registration if you intend to send texts, because the carrier check compares them against public records and a trading name that differs from the registered one is rejected.

The logo appears in more places than expected. Upload a version with a transparent background at a reasonable size, and check it against both a light and a dark backdrop.`,
  },
  {
    slug: "copying-a-setup-into-another-account",
    title: "Copying a whole setup into another account",
    body: `A snapshot is a saved copy of how an account is put together — its pipelines, automations, calendars, forms and pages — that you can load into another account.

It is how you stop rebuilding the same thing. Set one account up properly, save it as a snapshot, then start every similar account from that instead of an empty screen.

What travels is the structure, not the data. Automations, pipelines and templates come across. Contacts, conversations and history stay where they were, which is what you want — nobody wants last year's leads appearing in a new account.

Loading a snapshot into an account that already has things set up merges rather than replaces, so a second load can leave you with two pipelines that look almost the same. Check before loading into anything live.`,
  },
  {
    slug: "integrations",
    title: "Connecting other tools",
    body: `Integrations in Settings is where you connect the accounts this works alongside: your calendar, your email, your social pages, your accounting, your advertising.

Connect with an account that has the right role on the thing you are connecting, not merely access to it. Being an administrator of a business but not of a specific page is the single commonest reason a connection appears to succeed and then does nothing.

Connect only what you use. Every connection is a standing permission to read or write data somewhere else, and the list should be short enough that you can explain every entry.

Connections expire, usually after a password change or a security review at the other end, and the symptom is almost always silent — posts stop publishing, appointments stop syncing, messages stop arriving. If a channel goes quiet for a day, reconnect before investigating anything else.

Check the list when someone leaves. A connection made with a departing employee's personal account dies with their access.`,
  },
  {
    slug: "api-keys-and-private-integrations",
    title: "Connecting something custom",
    body: `Private Integrations in Settings issues a key that lets your own software, or a developer working for you, read and write data in this account.

Grant only the permissions the integration needs. A key that can read customer records is a very different thing from one that can delete them or charge a card, and the narrower one is rarely much harder to work with.

Treat the key as a password. Anyone holding it has whatever access it was granted, without logging in as anybody. Do not email it, do not paste it into a chat that other people can read, and do not put it in a spreadsheet.

Create a separate key per integration and label it. When you need to revoke one you will want to do it without breaking the other three.

Revoke immediately when a developer's engagement ends or a tool is retired. An old key with broad permissions is the classic way an account is still accessible long after everyone assumed it was not.`,
  },
  {
    slug: "audit-logs",
    title: "Seeing who changed what",
    body: `Audit Logs in Settings records the significant changes made in the account and who made them: settings altered, records deleted, permissions changed, exports taken.

It answers the two questions that are otherwise unanswerable. Why did this stop working — usually a setting somebody changed for a good reason without telling anyone. And what did that person have access to before they left.

Check it before rebuilding something that broke overnight. A configuration change is far more likely than a fault, and the log turns an afternoon of guessing into a minute of reading.

Exports are worth glancing at periodically. Somebody downloading the whole contact list is either routine or serious, and you want to know which.

It is a record, not an undo. Knowing what changed does not put it back, so read it before you start changing things yourself.`,
  },
  {
    slug: "labs-and-beta-features",
    title: "Trying features before they are finished",
    body: `Labs in Settings holds features that are built but not finalised, which you can switch on for your account.

Useful for getting at something early, and genuinely risky in a live account. Beta features change without notice, occasionally behave differently from the documented version, and can be withdrawn.

Turn one on when you have a specific reason, not to see what happens. And turn it on in an account where a surprise is survivable rather than in the one running your busiest client.

Note what you enabled somewhere findable. Six months later, when something behaves oddly, an enabled beta is the first thing to check and the last thing anybody remembers.

If a beta feature breaks something, switching it back off is the first step, before reporting it.`,
  },
  {
    slug: "brand-boards",
    title: "Keeping colours, fonts and logos consistent",
    body: `A brand board stores a set of colours, fonts and logos so that pages, emails and documents can pull from one definition instead of each being styled by hand.

The value shows up on the second thing you build, and grows from there. Without it, a business ends up with four slightly different blues and three fonts, none of which anyone can now identify.

Define the small set you actually use: one or two brand colours, an accent, a text colour, a heading font and a body font. Longer lists get ignored.

When the brand changes, the definition changes and everything referencing it follows, rather than somebody hunting through pages.

If you work across several client accounts, doing this per account first is what stops one client's blue quietly appearing in another's email.`,
  },
];
