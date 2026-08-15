import type { SeedArticle } from "./types";

/** Availability, booking, and the sync problems that account for most reports. */
export const CALENDARS: SeedArticle[] = [
  {
    slug: "booking-and-managing-appointments",
    title: "Booking and managing appointments",
    body: `Calendars in the left sidebar holds both your availability and the appointments already booked.

Create a calendar for each thing people can book with you, set the days and hours you are available, and choose how long each slot runs. The booking link that calendar produces can go in an email, on your website, or in a text message.

When somebody books, the appointment appears on the calendar and on that contact's record, so the history stays in one place.

To block time out, add an appointment yourself or adjust the availability on the calendar. Availability changes only affect future bookings; anything already booked stays put.`,
  },
  {
    slug: "choosing-a-calendar-type",
    title: "Which kind of calendar to create",
    body: `There are several calendar types and picking the wrong one is the most common setup mistake, because they all look the same until several people are involved.

A simple calendar books time with one person. If you are a solo business, this is the one, and the rest of this is noise.

A round robin distributes bookings across a team, one person per appointment, taking turns. Use it when any of several people could take the job — sales calls, consultations, service visits.

A collective calendar books everybody at once and only offers slots where all of them are free. Use it for a meeting that genuinely needs three specific people, and expect fewer available slots as a result.

A class or group calendar takes many bookings into the same slot up to a limit. Use it for a workshop, a class, or a webinar.

A service calendar is for booking a service with a duration and a price attached rather than a meeting.

You can change type later, but existing bookings do not always move cleanly, so it is worth thinking for a minute now.`,
  },
  {
    slug: "setting-availability-and-buffers",
    title: "Setting your hours, slot length and buffers",
    body: `Availability is set per calendar, not per account, which is what lets you offer consultations on Tuesday mornings and site visits all week.

Set the days and the hours, the length of a slot, and how many slots may be booked in a day. That last one is worth using: an open calendar that lets somebody book nine meetings on a Thursday is technically working correctly.

Buffers are the setting that makes a calendar liveable. A gap after each appointment gives you time to write notes and travel; a gap before stops back-to-back surprises. Without them a fully booked day is genuinely unsurvivable.

Two more that prevent most complaints. Minimum notice stops somebody booking you in ten minutes' time. A booking window limits how far ahead people can book, so a client cannot claim a slot next March.

Set the calendar's timezone explicitly rather than leaving it to be inferred. A calendar in the wrong timezone books real appointments at wrong times, and nobody notices until somebody misses one.`,
  },
  {
    slug: "connecting-your-own-calendar",
    title: "Syncing with your existing calendar",
    body: `Connect your own work calendar through Integrations in Settings, and two things become true: your existing commitments block out availability, and appointments booked here appear in the calendar you already look at.

Get the direction right, because they are separate settings. Reading your calendar is what stops double-booking. Writing to it is what puts the appointment where you will see it. Most people want both.

Choose which of your calendars is checked for conflicts. If you have a personal calendar on the same account, decide deliberately whether its events should block work bookings — usually yes, without the details being visible.

Reconnect after any password change. The commonest failure is a sync that silently stops working weeks ago, and the symptom is double bookings rather than an error message, so nothing tells you.

If a specific event is not blocking availability, check that it is on a calendar included in the conflict check and that it is marked busy rather than free.`,
  },
  {
    slug: "appointment-reminders",
    title: "Reducing no-shows with reminders",
    body: `Reminders are the highest-return setting on a calendar. A booking made three weeks ago is forgotten; a text the day before is the difference between a full diary and a wasted afternoon.

A workable pattern is a confirmation immediately, a reminder the day before, and a short one an hour or two before. More than that reads as nagging.

Send the short-notice one by text rather than email. Nobody checks email an hour before a meeting.

Include what people actually need: the time, the address or the joining link, and how to reschedule. A reminder that provokes a phone call asking where to go has cost you more than it saved.

Make rescheduling easy in the same message. Somebody who cannot make it and can move themselves gives you the slot back; somebody who cannot simply does not turn up.`,
  },
  {
    slug: "appointment-statuses",
    title: "Confirmed, showed, no-show and cancelled",
    body: `Every appointment carries a status, and keeping it current is what makes any figures about your diary worth reading.

New bookings are confirmed. Afterwards, mark whether the person showed. Cancelled and no-show look similar on the day and are completely different facts: one told you, one did not.

The reason to bother is that these statuses drive follow-up. A no-show can trigger a workflow that tries to rebook them the same afternoon, which recovers a good proportion of them. A showed appointment can trigger a review request while the visit is fresh. Neither can happen if everything stays marked confirmed forever.

Marking them by hand every time does not last. Either make it part of closing out the appointment, or let a workflow set the status where you can infer it, and only correct the exceptions.`,
  },
  {
    slug: "sharing-a-booking-link",
    title: "Sharing a booking link or embedding a calendar",
    body: `Every calendar produces a link that shows your real availability and books straight into it. Put it in your email signature, in text messages, on your website, and in the automatic replies you send.

Embedding it on a page removes a click and usually books more people than a link does, because the visitor never leaves. Both work; the embed converts better.

You can pre-fill the form from what you already know, so a client following a link from your email is not asked to type their own name and address again. Every field removed increases the number who finish.

Test the link in a private browser window before you publish it, as somebody with no account and no cookies. That is the only way to see what a stranger sees, and it catches the calendar that offers no slots because its availability was never set.`,
  },
  {
    slug: "team-calendars-and-round-robin",
    title: "Sharing bookings across a team",
    body: `A round robin calendar spreads bookings across several people, offering a slot if any one of them is free and rotating who gets the next one.

Each person needs their own calendar connected, or their real commitments will not block anything and they will be double-booked by lunchtime.

You can weight the distribution so a new starter gets fewer, or prioritise a specific person so they are offered first and the others take overflow. Both are more useful than an even split in practice.

Decide what happens when nobody is free. Offering nothing is honest but loses the enquiry; a waiting list or a callback request keeps it.

The failure to watch for is one person quietly taking everything because the others' calendars are not connected. Check the split after the first fortnight rather than assuming the rotation is working.`,
  },
  {
    slug: "rescheduling-and-cancelling",
    title: "Rescheduling and cancelling appointments",
    body: `Confirmations and reminders can carry links that let the person reschedule or cancel themselves, and turning those on is nearly always right.

The instinct is to withhold them so people do not cancel. It is backwards: the alternative to an easy cancellation is not attendance, it is a no-show, and the no-show costs you the slot as well as the customer.

A rescheduled booking keeps its history on the contact record, so you can see it moved rather than seeing two unrelated appointments.

Set a cutoff so somebody cannot cancel in the last thirty minutes, and consider what your reminders say once past it — "call us if you cannot make it" is better than a dead link.

If you take deposits, be explicit about what happens to them on a late cancellation, in the booking confirmation rather than only in your terms.`,
  },
  {
    slug: "taking-payment-at-booking",
    title: "Charging a deposit when someone books",
    body: `A calendar can require payment before it confirms the slot, either the full price or a deposit. It needs a payment provider connected first.

This is the strongest no-show cure there is, far more effective than any number of reminders. Even a small deposit changes the psychology of the booking.

Be clear on the booking page about what the amount is and whether it comes off the final bill. Ambiguity here produces refund requests, which cost more than the deposits collect.

Decide your refund rule before you switch it on, write it in one sentence, and put it on the booking page and in the confirmation. "Refundable up to twenty-four hours before" is a policy; silence is an argument waiting to happen.

Test it end to end with a real card and a small amount. Confirm the booking appears, the payment shows against the contact, and the confirmation says what you expect.`,
  },
  {
    slug: "recurring-appointments",
    title: "Repeating appointments",
    body: `An appointment can repeat on a schedule — weekly, fortnightly, monthly — which suits standing meetings, ongoing treatment, and any service somebody has committed to for a period.

Set the interval and how many times it repeats, or an end date. An open-ended recurring booking will fill a calendar indefinitely, which sounds convenient until you try to change your availability.

Changing one occurrence and changing the series are different actions, and the screen asks which you mean. Read that prompt: moving the whole series when you meant this Thursday is unpleasant to undo.

Reminders behave as normal and fire for each occurrence, so check the wording still makes sense when read for the eighth time.

For anything where the interval genuinely varies, book them individually and use a workflow to prompt the next booking. A recurring series that gets edited every week is more work than no series.`,
  },
  {
    slug: "calendar-shows-no-available-times",
    title: "The booking page shows no available slots",
    body: `Almost always one of six things, in the order worth checking.

Availability was never set on that calendar, or was set for days that have passed. Open it and look at the actual hours.

The date range is exhausted: a booking window of thirty days with a minimum notice of forty-eight hours on a nearly full diary leaves very little, and both are easy to set without noticing.

Your connected calendar is blocking everything. A single all-day event marked busy — a holiday, a birthday imported from somewhere — removes the whole day. Check what the conflict calendar actually contains.

Timezone mismatch, which shows as slots at strange hours or none at all when the calendar's timezone and yours disagree.

On a round robin, nobody on the team has a connected calendar or availability set, so there is no one to offer.

And the daily booking limit is already reached for the days being shown.

Check as a stranger in a private window, not while logged in — the two can genuinely differ.`,
  },
];
