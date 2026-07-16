import { describe, expect, it } from "vitest";

import { parseAdminCommunicationsFilters } from "@/server/admin/communications/filters";
import { parseAdminContentFilters } from "@/server/admin/content/filters";
import { parseAdminSeoFilters } from "@/server/admin/seo/filters";

describe("admin communications, content, and SEO pagination filters", () => {
  it("strictly normalizes independent communication list filters", () => {
    expect(
      parseAdminCommunicationsFilters({
        inquiryQ: "  order-42\n customer@example.com ",
        inquiryStatus: "WAITING_CUSTOMER",
        inquiryPage: "3",
        intentQ: " checkout   quote ",
        intentStatus: "OPENED",
        intentPage: "2",
      }),
    ).toEqual({
      filters: {
        inquiryQuery: "order-42 customer@example.com",
        inquiryStatus: "WAITING_CUSTOMER",
        inquiryPage: 3,
        intentQuery: "checkout quote",
        intentStatus: "OPENED",
        intentPage: 2,
      },
      validationError: false,
    });

    expect(
      parseAdminCommunicationsFilters({
        inquiryQ: ["first", "second"],
        inquiryStatus: "NOT_A_STATUS",
        inquiryPage: "02",
        intentStatus: ["RECORDED", "OPENED"],
        intentPage: "10001",
      }),
    ).toEqual({
      filters: {
        inquiryQuery: "",
        inquiryStatus: "",
        inquiryPage: 1,
        intentQuery: "",
        intentStatus: "",
        intentPage: 1,
      },
      validationError: true,
    });
  });

  it("normalizes each content collection without coupling its page", () => {
    expect(
      parseAdminContentFilters({
        blogQ: "  spring\n launch ",
        blogPage: "4",
        pageQ: " privacy ",
        pagePage: "2",
        faqQ: " shipping ",
        faqPage: "7",
      }),
    ).toEqual({
      filters: {
        blogQuery: "spring launch",
        blogPage: 4,
        pageQuery: "privacy",
        pagePage: 2,
        faqQuery: "shipping",
        faqPage: 7,
      },
      validationError: false,
    });

    expect(
      parseAdminContentFilters({
        blogQ: ["one", "two"],
        blogPage: "0",
        pagePage: "-1",
        faqPage: "1.5",
      }).validationError,
    ).toBe(true);
  });

  it("accepts only a known SEO entity and canonical positive page", () => {
    expect(
      parseAdminSeoFilters({ entity: "redirect", q: " /old\n/path ", page: "9" }),
    ).toEqual({
      filters: { entityType: "redirect", query: "/old /path", page: 9 },
      validationError: false,
    });

    expect(
      parseAdminSeoFilters({ entity: ["product", "page"], q: ["x"], page: "01" }),
    ).toEqual({
      filters: { entityType: "product", query: "", page: 1 },
      validationError: true,
    });
  });
});
