import { describe, expect, it } from "bun:test";
import { validateBlockJson } from "../src/validator.js";

describe("validateBlockJson", () => {
  it("validates a standard block.json successfully", () => {
    const raw = {
      apiVersion: 3,
      name: "custom/sample-card",
      title: "Sample Card",
      attributes: {
        title: { type: "string", default: "Hello" },
        count: { type: "number", default: 1 },
      },
    };

    const res = validateBlockJson(raw);
    expect(res.valid).toBe(true);
    expect(res.issues.length).toBe(0);
    expect(res.block?.name).toBe("custom/sample-card");
  });

  it("fails if block name lacks namespace", () => {
    const raw = {
      apiVersion: 3,
      name: "sample-card-no-prefix",
      attributes: {},
    };

    const res = validateBlockJson(raw);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.field === "name")).toBe(true);
  });

  it("flags accessibility warning on media objects missing alt", () => {
    const raw = {
      apiVersion: 3,
      name: "custom/media-banner",
      attributes: {
        bannerImage: {
          type: "object",
          properties: {
            id: { type: "number" },
            url: { type: "string" },
          },
        },
      },
    };

    const res = validateBlockJson(raw);
    expect(res.valid).toBe(true); // Warnings don't block validity
    const a11yIssue = res.issues.find((i) => i.message.includes("WCAG"));
    expect(a11yIssue).toBeDefined();
    expect(a11yIssue?.severity).toBe("warning");
  });

  it("fails on invalid attribute types", () => {
    const raw = {
      apiVersion: 3,
      name: "custom/broken-attr",
      attributes: {
        badField: { type: "non_existent_type" },
      },
    };

    const res = validateBlockJson(raw);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.field.includes("badField"))).toBe(true);
  });
});
