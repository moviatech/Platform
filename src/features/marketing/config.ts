import "server-only";

export const blogSiteEnabled = () => process.env.MARKETING_BLOG_SITE === "1";
