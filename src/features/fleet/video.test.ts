import { describe, expect, it } from "vitest";
import { videoEmbed, videoLink, videoRef, youtubeEmbed, youtubeId } from "./video";

describe("youtubeId", () => {
  it("reads the common link shapes", () => {
    expect(youtubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtube.com/shorts/dQw4w9WgXcQ?feature=share")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("rejects everything else", () => {
    expect(youtubeId("")).toBeNull();
    expect(youtubeId("https://vimeo.com/123456789")).toBeNull();
    expect(youtubeId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(youtubeId("https://evil.example/youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(youtubeId("https://www.youtube.com/channel/UCabcdefghijk")).toBeNull();
    expect(youtubeId("javascript:alert(1)")).toBeNull();
  });

  it("builds a privacy-enhanced embed url", () => {
    expect(youtubeEmbed("dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1");
  });
});

describe("videoRef", () => {
  it("keeps reading youtube links", () => {
    expect(videoRef("https://youtu.be/dQw4w9WgXcQ")).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
    expect(videoLink({ provider: "youtube", id: "dQw4w9WgXcQ" })).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(videoEmbed({ provider: "youtube", id: "dQw4w9WgXcQ" })).toBe(youtubeEmbed("dQw4w9WgXcQ"));
  });

  it("reads vimeo links with and without the privacy hash", () => {
    expect(videoRef("https://vimeo.com/123456789")).toEqual({ provider: "vimeo", id: "123456789", hash: null });
    expect(videoRef("https://vimeo.com/123456789/abcdef0123")).toEqual({ provider: "vimeo", id: "123456789", hash: "abcdef0123" });
    expect(videoRef("https://vimeo.com/123456789?h=abcdef0123&share=copy")).toEqual({ provider: "vimeo", id: "123456789", hash: "abcdef0123" });
    expect(videoRef("https://player.vimeo.com/video/123456789?h=abcdef0123&badge=0")).toEqual({ provider: "vimeo", id: "123456789", hash: "abcdef0123" });
    expect(videoRef("https://player.vimeo.com/video/123456789")).toEqual({ provider: "vimeo", id: "123456789", hash: null });
    expect(videoRef("https://vimeo.com/manage/videos/123456789")).toEqual({ provider: "vimeo", id: "123456789", hash: null });
    expect(videoRef("www.vimeo.com/channels/staffpicks/123456789")).toEqual({ provider: "vimeo", id: "123456789", hash: null });
  });

  it("stores and embeds a vimeo video with its hash", () => {
    expect(videoLink({ provider: "vimeo", id: "123456789", hash: "abcdef0123" })).toBe("https://vimeo.com/123456789/abcdef0123");
    expect(videoLink({ provider: "vimeo", id: "123456789", hash: null })).toBe("https://vimeo.com/123456789");
    expect(videoEmbed({ provider: "vimeo", id: "123456789", hash: "abcdef0123" })).toBe("https://player.vimeo.com/video/123456789?h=abcdef0123&dnt=1&title=0&byline=0&portrait=0&playsinline=1");
    expect(videoEmbed({ provider: "vimeo", id: "123456789", hash: null })).toBe("https://player.vimeo.com/video/123456789?dnt=1&title=0&byline=0&portrait=0&playsinline=1");
    expect(videoRef(videoLink({ provider: "vimeo", id: "123456789", hash: "abcdef0123" }))).toEqual({ provider: "vimeo", id: "123456789", hash: "abcdef0123" });
  });

  it("rejects other hosts and malformed links", () => {
    expect(videoRef("")).toBeNull();
    expect(videoRef("https://vimeo.com/about")).toBeNull();
    expect(videoRef("https://vimeo.com/12345")).toBeNull();
    expect(videoRef("https://evil.example/vimeo.com/123456789")).toBeNull();
    expect(videoRef("https://player.vimeo.com/123456789")).toBeNull();
    expect(videoRef("https://vimeo.com/123456789/a b")).toEqual({ provider: "vimeo", id: "123456789", hash: null });
    expect(videoRef("https://vimeo.com/123456789?h=%22%3E%3Cscript%3E")).toEqual({ provider: "vimeo", id: "123456789", hash: null });
    expect(videoRef("javascript:alert(1)")).toBeNull();
  });
});
