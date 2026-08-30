import { describe, expect, it } from "vitest";
import { isKnown, rankHosts, type Tweet } from "./twitter.js";

const tweet = (id: string, author: string, text: string): Tweet =>
  ({ id, userScreenName: author, text });

describe("isKnown", () => {
  it("ловить сам домен і будь-який батьківський", () => {
    const known = new Set(["dou.ua", "greenhouse.io"]);
    expect(isKnown("dou.ua", known)).toBe(true);
    expect(isKnown("jobs.dou.ua", known)).toBe(true);
    expect(isKnown("boards.greenhouse.io", known)).toBe(true);
    expect(isKnown("germantechjobs.de", known)).toBe(false);
  });

  // «ua» саме по собі не домен. Без цієї межі один запис «ua» у відомих
  // приховав би геть усі українські дошки.
  it("не вважає відомим за самим лише доменом верхнього рівня", () => {
    expect(isKnown("germantechjobs.de", new Set(["de"]))).toBe(false);
  });
});

describe("rankHosts", () => {
  const expanded = new Map([
    ["https://t.co/aaa", "https://germantechjobs.de/jobs/1"],
    ["https://t.co/bbb", "https://germantechjobs.de/jobs/2"],
    ["https://t.co/ccc", "https://youtube.com/watch?v=1"],
    ["https://t.co/ddd", "https://job-listings.web.app/x"],
    ["https://t.co/eee", "https://jobs.dou.ua/vacancies/1"],
    ["https://t.co/fff", "https://someblog.com/post"],
    ["https://t.co/ggg", "https://app.careerarc.com/job_postings/7"],
  ]);

  it("рахує різних авторів, а не згадки", () => {
    // Один автор, три твіти — це його власна реклама, не популярність.
    const solo = rankHosts([
      tweet("1", "spammer", "hiring https://t.co/aaa"),
      tweet("2", "spammer", "hiring https://t.co/aaa"),
      tweet("3", "spammer", "hiring https://t.co/bbb"),
    ], expanded, new Set());
    expect(solo[0]).toMatchObject({ host: "germantechjobs.de", authors: 1, tweets: 3 });

    const many = rankHosts([
      tweet("1", "anna", "hiring https://t.co/aaa"),
      tweet("2", "borys", "hiring https://t.co/bbb"),
    ], expanded, new Set());
    expect(many[0]).toMatchObject({ authors: 2, tweets: 2 });
  });

  it("викидає соцмережі, разові хостинги й сервіси розсилки", () => {
    const rows = rankHosts([
      tweet("1", "anna", "look https://t.co/ccc"),   // youtube
      tweet("2", "anna", "jobs https://t.co/ddd"),   // *.web.app
      tweet("3", "anna", "jobs https://t.co/ggg"),   // careerarc
    ], expanded, new Set());
    expect(rows).toHaveLength(0);
  });

  it("викидає вже відомі домени разом із піддоменами", () => {
    const rows = rankHosts([tweet("1", "anna", "jobs https://t.co/eee")],
                           expanded, new Set(["dou.ua"]));
    expect(rows).toHaveLength(0);
  });

  // Домен без слова про роботу майже завжди не дошка, а стаття чи блог.
  it("не бере домен, у назві якого нічого про роботу", () => {
    const rows = rankHosts([tweet("1", "anna", "read https://t.co/fff")],
                           expanded, new Set());
    expect(rows).toHaveLength(0);
  });

  // Нерозгорнуте посилання — це відсутній домен, а не домен «t.co».
  it("мовчить, коли скорочення не розгорнулось", () => {
    const rows = rankHosts([tweet("1", "anna", "jobs https://t.co/zzz")],
                           new Map([["https://t.co/zzz", ""]]), new Set());
    expect(rows).toHaveLength(0);
  });

  it("той самий домен двічі в одному твіті рахується раз", () => {
    const rows = rankHosts([
      tweet("1", "anna", "jobs https://t.co/aaa and https://t.co/bbb"),
    ], expanded, new Set());
    expect(rows[0]).toMatchObject({ host: "germantechjobs.de", authors: 1, tweets: 1 });
  });
});
