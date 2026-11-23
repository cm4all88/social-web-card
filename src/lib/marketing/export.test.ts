import { describe, expect, it } from "vitest";
import { crc32, imageName, postsCsv, reviewHtml, zipFiles, type ExportPost } from "./export";

const row = (over: Partial<ExportPost> = {}): ExportPost => ({
  platform: "instagram",
  format: "post",
  status: "draft",
  title: "Day 3: Black Friday, nobody buys it twice",
  caption: 'Tap "I\'ll buy it", then\nsee <it> taken.',
  hashtags: ["yooits", "blackfriday"],
  link: "https://yooits.me/?utm_source=instagram&utm_content=ab12",
  script: null,
  scheduled_at: "2026-11-27T19:00:00.000Z",
  image: "03-2026-11-27-instagram-black-friday-nobody-buys-it-twice.png",
  ...over,
});

describe("export for review", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("writes a ZIP whose directory lists every file", () => {
    const enc = new TextEncoder();
    const zip = zipFiles([
      { name: "review.html", data: enc.encode("<p>hi</p>") },
      { name: "images/01.png", data: new Uint8Array([1, 2, 3]) },
    ]);
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    let at = v.getUint32(end + 16, true);
    const names: string[] = [];
    for (let i = 0; i < 2; i++) {
      expect(v.getUint32(at, true)).toBe(0x02014b50);
      const len = v.getUint16(at + 28, true);
      names.push(new TextDecoder().decode(zip.slice(at + 46, at + 46 + len)));
      at += 46 + len;
    }
    expect(names).toEqual(["review.html", "images/01.png"]);
  });

  it("names images by order, day, platform and title", () => {
    expect(imageName(2, row())).toBe(
      "03-2026-11-27-instagram-black-friday-nobody-buys-it-twice.png",
    );
    expect(imageName(0, row({ scheduled_at: null, title: "!!" }))).toBe(
      "01-unscheduled-instagram.png",
    );
  });

  it("quotes CSV cells that hold commas, quotes or line breaks", () => {
    const csv = postsCsv([row()], "America/Los_Angeles");
    const [, line] = csv.slice(1).split("\r\n");
    expect(line).toContain('"Tap ""I\'ll buy it"", then\nsee <it> taken."');
    expect(line).toContain("#yooits #blackfriday");
    expect(line).toMatch(/Fri, Nov 27, 11:00\s?AM PST/);
    expect(line).toContain("Draft");
  });

  it("escapes post text on the review page and says nothing was posted", () => {
    const html = reviewHtml([row()], { title: "Review", timeZone: "America/Los_Angeles" });
    expect(html).toContain("see &lt;it&gt; taken.");
    expect(html).not.toContain("<it>");
    expect(html).toContain('src="images/03-2026-11-27-instagram');
    expect(html).toContain("Nothing here has been posted.");
    expect(html).toContain("1 post (1 draft)");
  });
});
