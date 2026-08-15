import type { SeedArticle } from "./types";

/**
 * Courses, communities and gated content.
 *
 * Everything here is tagged `memberships` by the feature detector, which means it is
 * correctly INVISIBLE to any client whose agency hid that menu item. That is the
 * intended behaviour, and it is also why membership language should not be sprinkled
 * through unrelated articles — one passing mention hides that article too.
 */
export const MEMBERSHIPS: SeedArticle[] = [
  {
    slug: "building-a-course",
    title: "Building a course",
    body: `Memberships is where a course, a membership site, or any online training you sell access to lives. A course is a set of categories, each holding lessons, which students work through after logging in.

Build the outline before recording anything. Categories are the sections, lessons are the individual pieces, and getting that structure right first saves rebuilding it around finished videos later.

Each lesson can hold video, text, images and downloadable files. Keep lessons short — under ten minutes of video is finished far more often than half an hour, and completion is what produces testimonials and renewals.

Host the video wherever you normally do and embed it, rather than uploading very large files directly.

Publish lessons as they are ready. A course held back until every lesson is perfect usually never launches, and students who are partway through are your best source of corrections.`,
  },
  {
    slug: "giving-people-access-to-a-course",
    title: "Giving and removing access",
    body: `Access is granted to a specific person for a specific offer, and can be given by hand or automatically when somebody buys.

Selling online training to your customers is the common case: a purchase grants access to the paid content and sends the login details. Test that path with a real purchase before opening it — the failure where somebody pays and receives nothing is the worst one available in this whole product.

Granting by hand covers everything else: a client included as part of a service, a team member, someone who paid another way.

Removing access matters just as much and is usually forgotten. Decide what happens when a subscription lapses or a refund is issued, and make it automatic rather than a thing somebody remembers.

People will lose their login. The reset flow is the same as any other, and pointing at it in your welcome email prevents most of the messages.`,
  },
  {
    slug: "drip-and-student-progress",
    title: "Releasing content over time and tracking progress",
    body: `Content can be released on a schedule rather than all at once — a section a week from the day somebody joins, or on fixed dates for a cohort.

Releasing over time raises completion, because a course that arrives all at once is a course people intend to start. It also reduces refunds, since access unfolds rather than being consumed in a weekend.

Do not overdo it. Adults resent being drip-fed something they paid for, and a course rationed over six months feels like a hostage situation. Weekly is usually right.

Progress is tracked per student, so you can see who has started, who has stalled and who has finished.

Act on it. A short message to somebody who has not opened anything in two weeks recovers a meaningful share of them, and the people who finish are exactly who to ask for a review or an upsell.`,
  },
  {
    slug: "communities-and-discussion",
    title: "Running a community alongside your content",
    body: `A community space gives members somewhere to talk to each other and to you, alongside whatever content they have access to.

It works when there is a reason to come back and somebody present to answer. It fails when it is opened as a feature and left unattended — an empty forum actively signals that a product is dead, so it is worse than not having one.

Seed it before opening. Post a few discussions yourself, ask early members direct questions, and answer everything for the first month.

Set out what it is for in a pinned post, and moderate against self-promotion early, because that is what empties these spaces.

If you cannot commit to being present for the first few months, do not open one. A well-run email list serves the same members better than an abandoned forum.`,
  },
  {
    slug: "certificates",
    title: "Issuing certificates on completion",
    body: `A certificate can be issued automatically when somebody finishes a course, carrying their name, the course, and the date.

They matter more than they look, especially anywhere training is a professional requirement. People share them, which markets the course, and they give a reason to finish rather than drift.

Set the completion rule deliberately: every lesson opened, a final assessment passed, or a percentage. Too loose and it means nothing; too strict and support requests appear from people who watched everything and missed one page.

Put your branding on it and check how it looks printed as well as on screen.

If it represents an accredited qualification, the awarding body's rules govern what may appear on it, and those override anything convenient.`,
  },
];
