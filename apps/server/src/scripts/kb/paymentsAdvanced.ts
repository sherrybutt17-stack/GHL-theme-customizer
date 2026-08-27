import type { SeedArticle } from "./types";

/** Billing past the basics: trials, instalments, dunning, reconciliation. */
export const PAYMENTS_ADVANCED: SeedArticle[] = [
  {
    slug: "free-trials",
    title: "Offering a free trial",
    body: `A recurring price can start with a trial, during which nothing is charged and the first real charge falls at the end.

Take card details up front if you can. Trials without a card produce far more sign-ups and far fewer customers, and the people who convert are the ones who would have given a card anyway.

Say clearly when the first charge falls and how much it will be, at sign-up and again a few days before it happens. A reminder before the charge feels like it should reduce conversion and reliably reduces disputes by more than it costs — a surprise charge produces a chargeback, which costs a fee on top of the refund.

Make cancelling during the trial easy and obvious. Making it hard produces complaints and disputes, not retention.

Use the trial period actively. A trial where nothing is sent is a trial that lapses; a short sequence helping them get value is what turns it into a customer.`,
  },
  {
    slug: "payment-plans-and-instalments",
    title: "Letting somebody pay in instalments",
    body: `A larger amount can be split into a fixed number of payments over time — three monthly payments rather than one, for instance.

It differs from a subscription in that it ends. A subscription continues until cancelled; an instalment plan has a total and a final payment, and treating one as the other is a real source of confusion for both sides.

Charge the first instalment immediately. A plan where nothing is taken up front is a promise, not a sale.

Expect a card to fail somewhere in the middle of any plan longer than three payments — cards expire and get replaced. Set retries and a message asking them to update it.

Decide what happens to what they bought if payments stop, write it down, and say it at the point of sale. That conversation is far easier before the money than after it.

Charge slightly more in total than the single payment. Instalments cost you cash flow and failure risk, and pricing that in is normal and expected.`,
  },
  {
    slug: "chasing-unpaid-invoices",
    title: "Chasing invoices without doing it by hand",
    body: `Reminders should be automatic, because chasing is exactly the task that gets deferred when you are busy — and being busy is when it matters most.

A workable sequence: a reminder a few days before the due date, one on the day, one a week after, and a personal message at two weeks. The first two are the ones that collect most of it, and they are the ones people skip because they feel unnecessary.

Keep the wording neutral until it is genuinely late. Most unpaid invoices are an oversight, and an aggressive first reminder damages a relationship over nothing.

Include the amount, the due date and a way to pay in the message itself. A reminder that requires finding the original invoice loses to a reminder that can be paid from the phone.

Stop the sequence when they pay. Chasing somebody who has paid is worse than not chasing at all.

Watch the gap between invoiced and collected rather than revenue. A business billing well and collecting badly looks healthy right up until it cannot pay wages.`,
  },
  {
    slug: "recovering-a-failed-renewal",
    title: "Recovering a subscription whose card failed",
    body: `Most failed renewals are not somebody leaving. They are a card that expired, was replaced after fraud, or hit a limit — and the customer usually does not know it happened.

Retry automatically over several days. Some failures clear on their own, particularly limit-related ones, and a retry costs nothing.

Message them alongside the retries. Say plainly that the payment did not go through and give a direct way to update the card. Recovery rates on a clear, unembarrassed message are high.

Use more than one channel. An email about a failed payment looks exactly like a phishing message and gets ignored for that reason; a text from a number they recognise does not.

Decide when access stops and say so in advance. Cutting somebody off with no warning over a card they did not know had expired loses a customer who wanted to stay.

Track how many you recover. It is usually the cheapest revenue in the business, and it is invisible unless somebody counts it.`,
  },
  {
    slug: "reconciling-payments",
    title: "Making the numbers here match your bank",
    body: `Payouts do not match individual sales, which is the source of most confusion when reconciling.

Providers batch several transactions into one payout, deduct their fees from it, and pay on a delay of a day to a week. So a payout of a particular amount rarely corresponds to any single order.

Work from the transactions list rather than the bank statement. It shows every attempt with its status and fee, which is the level at which things reconcile.

Refunds and chargebacks are deducted from later payouts, which is why a payout occasionally looks smaller than the sales it covers.

Check the currency and any conversion if you sell internationally. Conversion is applied at the provider, and the amount arriving differs from the amount charged.

Connect your accounting software if this is a monthly chore. It is exactly the kind of transcription work that is both tedious and easy to get wrong.`,
  },
  {
    slug: "what-to-put-on-an-invoice",
    title: "What an invoice needs to include",
    body: `The requirements vary by country, but the recurring ones are consistent enough to work to.

Your business name and address, the customer's, a unique invoice number, the date, a clear description of what was supplied, the amount, and the tax treatment. Your tax registration number where you have one — in many places an invoice without it is not valid for the customer to reclaim against.

Payment terms and the due date, stated as a date rather than "30 days", which people calculate differently.

Itemise. A single line saying "services" invites a query; an itemised invoice gets paid.

Number them sequentially and never reuse a number. Your accountant will ask, and gaps are worse than duplicates.

Keep copies for as long as your jurisdiction requires, which is usually several years.

None of this is tax advice, and a five-minute conversation with your accountant when you set up your template will save you correcting a year of invoices.`,
  },
  {
    slug: "selling-in-more-than-one-currency",
    title: "Selling to customers in other countries",
    body: `Decide early whether you sell in one currency or several, because changing it later means reissuing prices everywhere.

One currency is simpler and usually right for a small business. Customers abroad see a foreign amount, their bank converts it, and the conversion cost falls on them. It is transparent and it does not complicate your accounts.

Several currencies convert better, because a price in the customer's own money removes friction at exactly the wrong moment. The cost is maintaining the prices and reconciling several settlement currencies.

If you charge in a currency other than your bank's, your provider converts it, takes a margin, and the amount arriving will not match the amount charged.

Tax rules for cross-border sales, particularly digital goods, are genuinely complicated and vary by where the customer is. Get that checked once by an accountant rather than assuming.

Whatever you choose, say the currency on the price. An unlabelled amount is read as the reader's own currency.`,
  },
  {
    slug: "taking-payment-in-person",
    title: "Taking a card payment face to face",
    body: `Away from a desk, the practical route is a payment link sent by text while you are standing with the customer. They pay on their phone in a couple of taps and it lands against their record immediately.

It beats taking card numbers over the phone or on paper, which puts you in possession of card details you have no business storing.

The phone app covers the same ground when you are on site.

Send it before you leave. Payment links sent later get paid far less often, and the drop-off is steep after a few hours.

Say what it is for in the message. An unexplained link asking for money looks exactly like a scam, and some people will not tap it however much they trust you.

For a deposit against future work, send it at the moment of agreement rather than after. That is when it feels natural to both of you.`,
  },
  {
    slug: "cancelling-and-pausing-subscriptions",
    title: "Cancelling or pausing a customer's subscription",
    body: `Cancelling stops future charges. Decide, and state, whether it takes effect immediately or at the end of the period already paid for — most customers expect to keep what they have paid for, and cutting access immediately produces refund requests.

Offer a pause before a cancellation where it makes sense. A customer pausing for three months is a customer you keep; the same person cancelling is one you have to win back.

Ask why, in one optional question. Four fixed reasons will tell you more about your business in a quarter than any report.

Do not make it hard. A cancellation somebody has to ask twice for becomes a chargeback and a public complaint, both of which cost more than the subscription.

Automate what happens next: end access on the right date, remove them from the paying-customer segment, and put them into a light win-back sequence a month later rather than sending nothing.

Confirm it in writing. Ambiguity about whether a cancellation went through is the source of the next dispute.`,
  },
  {
    slug: "why-a-checkout-is-not-working",
    title: "The checkout page is not taking payments",
    body: `Work through it in this order, testing yourself in a private window with a real card and a small amount.

Is a payment provider connected, and is that account fully activated at their end? An account still in review accepts the connection and declines every payment, which presents as a broken checkout.

Are you still in test mode? Real orders in test mode take no money and look successful, which is worse than an outright failure.

Does the product have a price attached, in a currency the provider supports?

Does the page load fully on a phone? A checkout that renders half way is abandoned rather than reported.

If cards are being declined specifically, look at whether it is one card or all of them. One is the customer's bank; all of them is your provider account.

If payment succeeds but nothing follows — no access, no receipt, no record — the payment is fine and the automation behind it is not. Give the customer what they bought by hand first, then fix the cause.`,
  },
];
