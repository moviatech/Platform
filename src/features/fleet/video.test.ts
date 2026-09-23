import { describe, expect, it } from "vitest";
import { youtubeEmbed, youtubeId } from "./video";

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
