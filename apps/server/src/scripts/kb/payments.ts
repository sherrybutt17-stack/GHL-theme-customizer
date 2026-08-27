import type { SeedArticle } from "./types";

/** Getting paid: providers, invoices, subscriptions, documents and what fails. */
export const PAYMENTS: SeedArticle[] = [
  {
    slug: "taking-payments-and-sending-invoices",
    title: "Taking payments and sending invoices",
    body: `Payments in the sidebar covers invoices, one-off charges and recurring subscriptions.

To bill someone, create an invoice, pick the contact, add line items with a description and amount, then send it. They get a link that opens the invoice and lets them pay it, and the status updates on your side as soon as it clears.

Recurring billing works the same way but repeats on the schedule you choose, so you set it up once rather than remembering to invoice every month.

Before any of this works you need a payment provider connected. That happens once in settings, and until it is done invoices can be created but not paid.`,
  },
  {
    slug: "connecting-a-payment-provider",
    title: "Connecting a payment provider",
    body: `Nothing can be paid until a provider is connected. It is done once, in settings, by signing into the provider account you already use or creating one.

Several providers are supported and the choice matters less than finishing the setup. Whichever you pick, the account has to be fully activated on their side — a provider account in review accepts the connection here and then declines every payment, which presents as "payments are broken".

Most providers have a test mode. Use it to check the flow end to end, then remember to switch to live. Taking real orders in test mode is a genuinely common and very annoying mistake, because the money never existed.

Check the currency is right before your first sale, and check the payout schedule and the fee so the amount arriving in your bank is not a surprise.

Once live, buy something from yourself with a real card for a small amount and refund it. That single test proves the whole chain: checkout, receipt, contact record and payout.`,
  },
  {
    slug: "products-and-prices",
    title: "Setting up products and prices",
    body: `A product is the thing you sell, with a name, a description, an image and one or more prices.

One product can have several prices, which is how you offer monthly and annual, or a standard and a discounted rate, without duplicating the product itself. Duplicating instead is how you end up editing the description in four places.

Decide one-off or recurring at the price, not the product. A recurring price carries an interval and, optionally, a trial.

Write the description as the buyer will read it at the moment of paying, because that is where it appears. This is the last thing they see before deciding, and vagueness here costs sales.

Archive rather than delete anything that has been sold. Deleting a product that appears on past invoices makes your own history harder to read.`,
  },
  {
    slug: "subscriptions-and-recurring-billing",
    title: "Subscriptions and recurring billing",
    body: `A recurring price bills automatically on its interval until it is cancelled, and the customer's card is charged without anyone acting.

Set the interval, and a trial if you offer one. Be exact about when the first real charge falls, and say it plainly at checkout — surprise on the first bill is the main source of chargebacks, which cost more than the refund.

Failed renewals are the thing to plan for, because they are routine rather than exceptional. Cards expire, get replaced after fraud, and hit limits. Retries plus a message asking them to update the card recover a large share; silence loses customers who fully intended to stay.

Decide what a lapse does to their access, and automate it. Manual removal is forgotten in both directions — people keep access they stopped paying for, and occasionally lose access they did pay for.

Cancelling should be easy to find. Making it hard produces chargebacks and public complaints rather than retention.`,
  },
  {
    slug: "text-to-pay-and-payment-links",
    title: "Sending someone a link to pay",
    body: `You can send a payment link by text or email — a message with an amount and a way to pay it in a couple of taps.

For anyone taking payment in person or over the phone, this is the fastest route to money there is. It beats an invoice for small amounts because there is nothing to open, and it beats card details over the phone because you never handle the number.

Send it while you are with them or still on the call. Payment links sent later get paid far less often, and the drop-off is steep after a few hours.

Say what it is for in the message. An unexplained link asking for money looks exactly like a scam, and some people will not click it however much they trust you.

The payment lands against the contact when it clears, so the record shows what they paid and when without any reconciliation.`,
  },
  {
    slug: "estimates-and-quotes",
    title: "Estimates and quotes",
    body: `An estimate is a priced proposal the customer can accept, and it converts into an invoice once they do rather than being retyped.

That conversion is the point. Retyping is where numbers change by accident, and an accepted estimate that becomes the invoice is a record of exactly what was agreed.

Put an expiry on it. It creates a reason to decide, and it protects you when somebody accepts a price from eight months ago.

Break the work into line items rather than a single total. Itemised quotes get accepted more often, because the customer can see what they are paying for and can remove something instead of declining the lot.

Follow up automatically. An unaccepted estimate should trigger a reminder after a few days — the single highest-return automation in this whole area, because these are people who asked for a price.`,
  },
  {
    slug: "documents-and-contracts",
    title: "Documents and contracts with a signature",
    body: `You can send a document for electronic signature — a contract, a proposal, a consent form — and have it come back signed, dated and stored against the contact.

Build reusable templates with fields that fill from the contact record, so producing one for a new client is a minute rather than an afternoon of find-and-replace on last time's file.

You can require payment alongside signature, which is how a deposit and a contract become one step instead of two chased separately.

The signed copy is stored on the record, so it is findable months later without hunting through email.

The legal weight of an electronic signature varies by country and by document type. It is accepted for ordinary commercial agreements nearly everywhere; some specific documents still require something else, and that is worth checking once for your line of work rather than per contract.

Send a test to yourself first and sign it. The signing experience is what your client judges you on.`,
  },
  {
    slug: "coupons-and-discounts",
    title: "Coupons and discount codes",
    body: `A coupon or discount code reduces the price at checkout — ten percent off, say, or a fixed amount — and can be limited by date, by number of uses, or to specific products.

Set the limits when you create it, not later. A code with no expiry and no usage cap will be found, shared and still working in two years, and you will discover it from your accounts rather than from anybody telling you.

For a recurring price, be explicit about whether the discount applies to the first payment or to every one. Getting this wrong is expensive quietly and for a long time.

Use distinct codes per channel — one for the newsletter, one for a partner, one for an event. Same discount, different codes, and you learn which channel actually produced sales.

Standing discounts stop being discounts. If a code is always available your prices are simply lower, and it is more honest and better for margin to say so.`,
  },
  {
    slug: "refunds-and-failed-payments",
    title: "Refunds, failures and chargebacks",
    body: `A refund is issued against the original payment, in full or in part, and the record updates on both sides. It reaches the customer's account in a few working days, which is a bank timescale rather than anything under your control — telling them that up front prevents a second message.

A card declined on renewal is different and far more common. The usual causes are an expired or replaced card, insufficient funds, or a bank blocking an unfamiliar merchant. The customer often does not know it happened.

Handle failures automatically: retry, and message them asking to update the card. Recovery rates on a polite prompt are high, and doing nothing loses customers who never intended to leave.

A chargeback is the customer disputing with their bank instead of asking you. It costs a fee on top of the amount and is worth avoiding rather than winning. The prevention is boring: a recognisable name on their statement, clear renewal terms, easy cancellation, and answering messages quickly.

Refund a disputed charge before it becomes a chargeback whenever the amount is small. It is almost always cheaper.`,
  },
  {
    slug: "tax-settings",
    title: "Charging tax",
    body: `Tax is configured in the payment settings: whether you charge it, at what rate, and whether prices are shown including or excluding it.

Get the inclusive-or-exclusive decision right before you sell anything. Consumer businesses in most of the world show prices including tax and customers expect it; showing a price that grows at checkout is a serious source of abandonment. Business-to-business commonly shows it excluding.

Rates vary by where the customer is, not only where you are, and for digital goods sold across borders the rules are genuinely complicated. If you sell internationally, get this checked once by an accountant — it is cheaper than the correction.

Your tax registration number belongs on invoices where you have one; in many places an invoice without it is not valid for the customer to claim.

Nothing here is tax advice, and the amounts are reported by you rather than filed for you.`,
  },
  {
    slug: "seeing-what-has-been-paid",
    title: "Seeing what has been paid and what has not",
    body: `The transactions list shows every payment attempt, successful or not, with the customer, the amount, the method and the status. Subscriptions have their own view showing what is active, what is overdue and what has been cancelled.

Work the unpaid list weekly rather than at month end. An invoice chased at seven days is usually an oversight; the same invoice at sixty days is a conversation about whether you will be paid at all.

Automate the chasing. A reminder a few days after an invoice is due, and again a week later, collects more than any amount of resolve to do it manually.

The number worth watching is not revenue but the gap between invoiced and collected. A business that is billing well and collecting badly looks healthy in every report right up until it cannot pay wages.

Individual payments also appear on the contact's own timeline, which is where to look when a customer asks what they were charged.`,
  },
  {
    slug: "customer-paid-but-nothing-happened",
    title: "Someone paid and did not get what they bought",
    body: `Deal with it in this order, because the customer is waiting.

Give them what they paid for by hand, first, before investigating anything. Access granted manually takes a minute and stops the situation getting worse.

Then find the payment in the transactions list and confirm it actually succeeded. Occasionally it did not, and the customer saw a pending authorisation their bank showed as a charge.

If it succeeded, look at the contact's timeline for the automation that should have followed. Usually one of three things: the workflow was never published, the trigger was on a different product or price than the one they bought, or a step failed because of sending rather than logic.

Check whether it affected only this person or everybody who bought since a change was made. That question decides whether this is an apology or an incident.

Then fix the cause and test it by buying it yourself.`,
  },
];
