import type { Localized } from "./content";

export type Guide = {
  slug: string;
  kind: "guide" | "video" | "article";
  title: Localized;
  summary: Localized;
  image: string;
  body: Localized;
};

export const guides: Guide[] = [
  {
    slug: "fsd-quick-start",
    kind: "video",
    title: { zh: "Full Self-Driving (Supervised) 快速上手", en: "Full Self-Driving (Supervised) Quick Start" },
    summary: { zh: "几分钟了解如何开启、监督和接管。", en: "How to engage, supervise and take over in minutes." },
    image: "/portal/banners/banner-3-md.webp",
    body: {
      zh: "视频和图文说明整理中。Full Self-Driving (Supervised) 是驾驶辅助功能，使用时驾驶员必须持续注视路况、随时准备接管。取车时我们会现场讲解。",
      en: "Video and written guide coming soon. Full Self-Driving (Supervised) is a driver-assistance feature: keep your eyes on the road and be ready to take over at all times. We walk you through it at pickup.",
    },
  },
  {
    slug: "charging",
    kind: "guide",
    title: { zh: "充电指南", en: "Charging Basics" },
    summary: { zh: "超充、目的地充电和还车电量要求。", en: "Superchargers, destination charging and the return charge level." },
    image: "/portal/banners/banner-2-md.webp",
    body: { zh: "内容整理中。", en: "Content coming soon." },
  },
  {
    slug: "pickup",
    kind: "guide",
    title: { zh: "取车流程", en: "Pickup Walkthrough" },
    summary: { zh: "取车当天会发生什么、需要带什么。", en: "What happens on pickup day and what to bring." },
    image: "/portal/banners/banner-1-md.webp",
    body: { zh: "内容整理中。", en: "Content coming soon." },
  },
  {
    slug: "return",
    kind: "guide",
    title: { zh: "还车清单", en: "Return Checklist" },
    summary: { zh: "电量、清洁、时间地点和还车后费用。", en: "Charge level, cleanliness, time and place, post-rental charges." },
    image: "/portal/banners/banner-2-md.webp",
    body: { zh: "内容整理中。", en: "Content coming soon." },
  },
  {
    slug: "scenic-routes",
    kind: "article",
    title: { zh: "加州海岸线自驾路线", en: "Scenic Routes Near You" },
    summary: { zh: "适合电动车的经典路线与充电点。", en: "Classic drives with charging stops along the way." },
    image: "/portal/banners/banner-1-md.webp",
    body: { zh: "旅行文章整理中。", en: "Travel article coming soon." },
  },
];

export { faq } from "./faq-data";
