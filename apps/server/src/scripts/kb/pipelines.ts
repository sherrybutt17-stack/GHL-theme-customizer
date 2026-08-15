import type { SeedArticle } from "./types";

/** Deals on a board: stages, values, and keeping the board honest. */
export const PIPELINES: SeedArticle[] = [
  {
    slug: "creating-a-pipeline-and-its-stages",
    title: "Creating a pipeline and its stages",
    body: `Pipelines live under Opportunities in the left sidebar. Open it and switch to the pipelines tab to see the ones you already have.

Create a pipeline, give it a name that matches how you actually sell, then add stages in the order a deal moves through them. Something like New Enquiry, Contacted, Quoted, Won is plenty to start with. You can rename or reorder stages later by dragging them, and existing deals move with the stage they are in.

A common mistake is building fifteen stages up front. Start with four or five. Stages you never move anything into just make the board harder to read.

Each opportunity you create sits in one stage of one pipeline and carries a value, so the totals along the top of the board tell you what is actually in play.`,
  },
  {
    slug: "adding-and-moving-an-opportunity",
    title: "Adding a deal and moving it along",
    body: `Create an opportunity from the board, or from a contact record so it is attached to the right person from the start. Give it a name you will recognise in a list, pick the pipeline and the stage it belongs in, and put a value on it.

Move it by dragging the card to the next stage. That single action is what makes the board useful, and it is also the discipline that everything else depends on — a board that reflects last month is worse than no board, because people believe it.

One person can have several opportunities. A customer who bought last year and is now considering something else is two deals, not one edited deal, and keeping them separate is what makes your history readable.

The value should be what you would actually invoice, not what you hope. Optimistic values make the totals meaningless within a quarter.`,
  },
  {
    slug: "opportunity-status-and-value",
    title: "Won, lost, and why the board fills up",
    body: `Besides its stage, every opportunity has a status: open, won, lost, or abandoned. Setting it is what takes a deal off the working board.

Closing lost deals is the part everybody skips, and it is the reason a pipeline becomes unusable after six months. A board with two hundred cards on it, most of them dead, cannot be read at a glance, and reading it at a glance is its entire job.

Record why it was lost. Even four fixed reasons — price, timing, went elsewhere, no response — will tell you more about your business in a quarter than any report, and it costs a click.

Won deals should be marked won rather than dragged to a final stage and left, because that is what makes the totals real and what lets the follow-up sequence fire.

Make it a rule that anything untouched for a set period gets a decision. Deals do not go stale gracefully; they just quietly stop being true.`,
  },
  {
    slug: "automating-from-a-stage-change",
    title: "Making things happen when a deal moves",
    body: `A stage change is one of the most useful triggers available, because it is a moment where somebody has decided something.

Moving to a quoting stage can send the quote and set a reminder to chase in three days. Moving to won can send the welcome sequence, raise the invoice and ask for a review. Moving to lost can drop them into a slow nurture rather than nowhere.

Build these one at a time and let each one run for a fortnight before adding the next. Wiring up five at once means that when something sends twice you have five candidates.

Be careful about anything that sends to the customer on a backwards move. People correct the board as well as advance it, and an apology email fired because somebody fixed a mis-click is a bad day.

Internal notifications are the safest place to start: telling an owner a deal has reached quoting is useful and cannot embarrass you.`,
  },
  {
    slug: "several-pipelines",
    title: "When to use more than one pipeline",
    body: `Use a separate pipeline when the steps genuinely differ, not when the customers do.

Selling to homeowners and to landlords through the same process is one pipeline with a field or a tag distinguishing them. Selling installations and selling maintenance contracts, where the stages are actually different, is two pipelines.

The test is whether you would have to invent stages that half the deals skip. If you would, split it. If the stage list is the same and only the names of the people change, keep it as one, because you will want a single number for what is in play.

Two or three pipelines is normal. Nine is a sign someone has modelled every product line as its own process, and the result is a board nobody looks at because no single view shows the business.

Reporting can span pipelines, so splitting does not cost you the overall picture.`,
  },
  {
    slug: "pipeline-reporting",
    title: "Reading the numbers on your board",
    body: `The totals at the top of each stage tell you what is sitting there and what it is worth. Read across them and the shape of the business is visible: a bulge at quoting means you are producing quotes and not chasing them; a thin first stage means a lead problem that will show up in revenue in a month or two.

Conversion between stages is the number worth watching over time. It tells you where deals actually die, which is rarely where people assume.

Time in stage is the other one. A deal sitting in the same place for six weeks is a decision nobody has made, and it is either work to do or a loss to record.

All of it depends on the board being current. Reports built on a pipeline people update once a month are confident and wrong, which is worse than having none — so fix the habit before you trust the chart.`,
  },
  {
    slug: "bulk-updating-opportunities",
    title: "Updating a lot of deals at once",
    body: `Select several cards on the board, or filter the list view and select from there, and you can move them, change status, reassign the owner or add a tag in one action.

The usual reason is a clean-up: everything untouched since a date gets marked lost, or a departing colleague's deals get reassigned in one go rather than card by card.

Filter first, then look at the count before you act. Bulk actions do not ask twice and there is no undo, so a filter that was nearly right is expensive.

Tag the batch as you change it. If it turns out to have been the wrong set, the tag is how you find exactly those records afterwards — without it you are guessing from timestamps.

For a reassignment, tell the person before you do it rather than after. Forty deals appearing in somebody's list overnight with no context is a bad Monday.`,
  },
];
