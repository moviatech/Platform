import { renderEmail } from "@/lib/email/template";
import { googleReviewUrl, rootDomain } from "@/lib/env";

const copy = {
  zh: {
    subject: (number: string) => `这趟旅程怎么样？· ${number}`,
    title: "这趟旅程怎么样？",
    intro: (vehicle: string) => `${vehicle} 已归还，感谢选择 Movia。`,
    review: "如果方便，欢迎在 Google 上给我们留个评价，让更多人了解 Movia。",
    reviewCta: "去 Google 评价",
    survey: "也欢迎花一分钟给每个环节打个分，帮我们把下一次做得更好。",
    cta: "给本次行程打分",
  },
  en: {
    subject: (number: string) => `How was your trip? · ${number}`,
    title: "How was your trip?",
    intro: (vehicle: string) => `Your ${vehicle} is back. Thank you for choosing Movia.`,
    review: "If you have a moment, a Google review helps other travelers find us.",
    reviewCta: "Review us on Google",
    survey: "You can also take a minute to rate each step of this trip so we can make the next one even better.",
    cta: "Rate your trip",
  },
};

export function tripSurveyEmail(input: { locale: "zh" | "en"; vehicle: string; number: string; token: string }) {
  const text = copy[input.locale];
  const rendered = renderEmail({
    preheader: input.number,
    title: text.title,
    blocks: [
      { type: "paragraph", text: text.intro(input.vehicle) },
      { type: "paragraph", text: text.review },
      { type: "button", label: text.reviewCta, href: googleReviewUrl },
      { type: "paragraph", text: text.survey },
      { type: "button", label: text.cta, href: `https://account.${rootDomain}/survey/${input.token}`, outline: true },
    ],
  });
  return { subject: text.subject(input.number), text: rendered.text, html: rendered.html };
}
