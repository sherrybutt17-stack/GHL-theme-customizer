import type { SeedArticle } from "./types";

/** Booking past the basics: resources, groups, forms, no-shows, edge cases. */
export const CALENDARS_ADVANCED: SeedArticle[] = [
  {
    slug: "booking-rooms-and-equipment",
    title: "Booking a room, a chair or a piece of equipment",
    body: `Where a booking needs a thing as well as a person — a treatment room, a bay, a van, a piece of kit — that resource has to be part of what is checked, or you will double-book it while both staff members are genuinely free.

Set up a calendar per resource and require both the person and the resource to be available. Slots are then only offered where both are.

Expect fewer available slots, and that is correct rather than a fault. Two staff and one room is a one-room business.

Where a service can use any of several identical resources, let it pick any free one rather than a specific one, or you will show as fully booked with two empty rooms.

Build the simplest version that reflects reality. Modelling every piece of equipment produces a calendar that offers almost nothing and that nobody trusts.`,
  },
  {
    slug: "grouping-calendars",
    title: "Showing several calendars on one booking page",
    body: `A calendar group puts several bookable things on one page, so a visitor chooses what they want and then a time.

Use it where you offer genuinely different appointments — a consultation, a full service, a quick review — rather than sending people three separate links and hoping they pick right.

Order them with the one you most want booked first. Most people take the first reasonable option.

Name them in the customer's language, with a duration and a price where there is one. "45 minutes — initial consultation — free" is chosen; "Discovery Call Type A" is not.

Keep the list to a handful. A page offering nine options converts worse than one offering three, because choosing becomes work.

Test the whole page as a stranger in a private window. A group where one calendar has no availability shows an option that leads nowhere.`,
  },
  {
    slug: "questions-on-the-booking-form",
    title: "Asking questions when somebody books",
    body: `The booking form can collect more than a name and an email — what the appointment is about, an address, a reference number, anything that makes the appointment useful before it starts.

Every extra question costs bookings, so ask only what changes how you prepare or whether you can serve them at all.

One well-chosen open question — "what would you like to cover?" — is usually worth more than five structured ones, and it lets you walk in already knowing the problem.

Map answers to real fields rather than leaving them as loose text, or you have collected something you cannot filter, report on or use in a message.

Pre-fill what you already know when the link comes from your own email, so an existing customer is not retyping their own details.

Put anything that decides whether you can help at all first, so somebody unsuitable finds out before spending five minutes.`,
  },
  {
    slug: "reducing-no-shows",
    title: "Reducing no-shows",
    body: `In rough order of effect.

Take a deposit. Nothing else comes close — even a small amount changes the psychology of the booking entirely.

Send reminders, and send the last one by text an hour or two before. Nobody checks email an hour before an appointment.

Make rescheduling easy and put the link in every reminder. The alternative to an easy reschedule is not attendance, it is a no-show, which costs you the slot as well.

Confirm immediately at the time of booking, with the date, time, address or joining link, and what to bring.

Offer nearer slots. Bookings made three weeks out are missed far more often than bookings made for Thursday.

Then mark the outcome honestly, so you can see whether any of it worked. If everything stays marked confirmed, every number about your diary is wrong in the same optimistic direction.

Follow up no-shows the same day with an offer to rebook. A good share of them come back if asked once.`,
  },
  {
    slug: "double-bookings",
    title: "Two people were booked into the same slot",
    body: `Almost always the personal calendar connection rather than the booking system.

Reconnect it. Access expires quietly after password changes and security reviews, and the symptom is exactly this — conflicts stop blocking availability while everything looks normal.

Check the direction of sync. Reading your own calendar is what prevents double-booking; writing to it only puts appointments where you can see them. Both need to be on.

Check which calendars are included in the conflict check. An event on a calendar that is not checked blocks nothing.

Check that the blocking events are marked busy rather than free. A free event is deliberately ignored.

On a round robin, check every team member individually. One person without a connected calendar takes bookings on top of their real commitments while everyone else behaves.

Once fixed, look at whether buffers would help. Back-to-back bookings that overrun produce the same experience as a double booking.`,
  },
  {
    slug: "appointment-follow-up",
    title: "What should happen after an appointment",
    body: `The period straight after an appointment is the most valuable and most neglected automation in most businesses.

Trigger on the appointment being marked as attended and do three things.

Ask for a review, the same day, while it is fresh. Same-day requests outperform later ones dramatically.

Send whatever was promised — a quote, a summary, a document. Doing it automatically means it happens on the busy days too, which are the days it otherwise does not.

Prompt the next booking where your business is repeat by nature. "Book your next visit" sent immediately converts far better than a reminder in six months.

Handle the other outcomes too. A no-show should get a rebooking offer; a cancellation should get one as well rather than silence.

None of this works if statuses are never updated, so make marking the outcome part of closing out the appointment.`,
  },
  {
    slug: "changing-availability-without-breaking-bookings",
    title: "Changing your hours when appointments are already booked",
    body: `Changing availability affects future bookings only. Appointments already made stay exactly where they are, even if they now sit outside your new hours.

That is usually what you want, and it is also the thing that surprises people: reducing your Friday hours does not clear the Fridays already booked.

Look at what is already in the diary before changing anything, then move those appointments deliberately, contacting each customer yourself. An appointment silently moved is worse than one you asked about.

For a holiday, block the time out rather than changing your general availability. Blocking is temporary and reversible; editing your working hours is a change you will forget to undo.

Give as much notice as you can when moving somebody, and offer a specific alternative rather than asking them to rebook. "Can we move you to Tuesday at 10?" gets a yes; "please rebook using this link" gets silence.`,
  },
  {
    slug: "several-people-on-one-appointment",
    title: "Booking an appointment that needs more than one person",
    body: `Where an appointment genuinely requires two or three specific people, a collective calendar only offers slots where all of them are free.

Expect availability to collapse. Three diaries intersected leaves very little, and the more people you add the closer to nothing it gets.

So be honest about who is truly required. A colleague who would find it useful to attend is not required, and adding them can halve your bookable time.

Everyone involved needs their own calendar connected, or their real commitments are invisible and they will be booked over.

For anything with many attendees where the time is fixed rather than negotiated — a workshop, a webinar, a class — use a group calendar with a capacity instead. That takes many bookings into one slot, which is a completely different shape.

Where availability is genuinely too tight, offer a shorter meeting. Thirty minutes intersects far better than ninety.`,
  },
  {
    slug: "timezones-and-booking",
    title: "Appointments landing at the wrong time",
    body: `Nearly always a time zone that was inferred rather than set.

Set the calendar's time zone explicitly. If it was left to be guessed, real appointments are booked at wrong times and nobody notices until somebody misses one.

Check the account's time zone as well. Scheduled sends, reminders and workflow windows all run on it, so a mismatch between the two produces reminders at odd hours even when the appointment is right.

The booking page should show slots in the visitor's own time zone, with the zone named on screen. Somebody booking from another country needs to see which time they are agreeing to.

State the time zone in confirmations and reminders too. "2pm" is ambiguous the moment either party travels.

If everything is out by exactly an hour at certain times of year, that is daylight saving on one side and not the other — set both zones properly rather than adjusting the hours to compensate, which breaks again in six months.`,
  },
];
