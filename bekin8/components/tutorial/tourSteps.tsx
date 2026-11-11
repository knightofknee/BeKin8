// components/tutorial/tourSteps.tsx
// Step content for the Post screen's coach-mark tour. (The onboarding / beacon flow lives in
// setupTour.tsx.) Targets reference keys registered via useTourTarget() on the Post screen and
// Settings. Steps marked `interactive` let the user toggle the highlighted control mid-tour.
import type { TourStep } from "./SpotlightTour";

export type PostTourCtx = {
  goSettings: () => void;
  goPost: () => void;
};

export function buildPostTour(ctx: PostTourCtx): TourStep[] {
  return [
    {
      target: "post-limit",
      title: "Your posting pace",
      // Describes exactly what's highlighted (the pace note); the 1000-word cap is mentioned
      // without claiming the counter is inside the ring (it lives further down the form).
      body: "You can make 1 post every other day, up to 1000 words each.",
      onEnter: ctx.goPost,
    },
    {
      target: "post-bonus",
      title: "Bonus posts",
      body: "Take days off and you bank up to 3 bonus posts. Spend one to post even when you're rate-limited.",
      onEnter: ctx.goPost,
    },
    {
      target: "settings-comments",
      title: "Comments are your call",
      body: "Decide whether friends can comment on your posts.",
      interactive: true,
      onEnter: ctx.goSettings,
    },
    {
      target: "settings-comment-notify",
      title: "Comment notifications",
      body: "Choose whether to be notified about comments.",
      interactive: true,
      onEnter: ctx.goSettings,
    },
    {
      title: "You're set! ✍️",
      body: "That's the feed in a nutshell. Head back and share your first post whenever you're ready.",
      cta: "Done",
      onEnter: ctx.goPost,
    },
  ];
}
