import { describe, expect, it } from "bun:test";
import { generateBlockTypes, getBlockTypeName } from "../src/generator.js";
import { generateCursorRules } from "../src/cursor-rules.js";
import type { BlockJson } from "../src/validator.js";

describe("generateBlockTypes", () => {
  it("converts block name to PascalCase", () => {
    expect(getBlockTypeName("core/paragraph")).toBe("Paragraph");
    expect(getBlockTypeName("tenup/featured-media-card")).toBe("FeaturedMediaCard");
    expect(getBlockTypeName("tenup/featured-media-card", true)).toBe("TenupFeaturedMediaCard");
  });

  it("generates correct primitive and enum types", () => {
    const block: BlockJson = {
      name: "example/callout",
      attributes: {
        title: { type: "string", default: "Notice" },
        variant: { type: "string", enum: ["info", "warning", "error"] },
        isActive: { type: "boolean", default: true },
        count: { type: "number", default: 0 },
      },
    };

    const output = generateBlockTypes(block);

    expect(output).toContain("export interface CalloutAttributes {");
    expect(output).toContain('variant?: "info" | "warning" | "error";');
    expect(output).toContain("title: string;");
    expect(output).toContain("isActive: boolean;");
    expect(output).toContain("count: number;");
    expect(output).toContain("export type CalloutSetAttributes = (attributes: Partial<CalloutAttributes>) => void;");
    expect(output).toContain("export interface CalloutEditProps {");
    expect(output).toContain("export interface CalloutSaveProps {");
  });

  it("handles complex nested objects and array types", () => {
    const block: BlockJson = {
      name: "agency/hero",
      attributes: {
        media: {
          type: "object",
          default: {},
          properties: {
            id: { type: "number" },
            url: { type: "string" },
            alt: { type: "string" },
          },
        },
        tags: {
          type: "array",
          items: { type: "string" },
          default: [],
        },
      },
      usesContext: ["postId", "queryId"],
    };

    const output = generateBlockTypes(block);

    expect(output).toContain("export interface HeroAttributes {");
    expect(output).toContain("media: {");
    expect(output).toContain("id?: number;");
    expect(output).toContain("url?: string;");
    expect(output).toContain("alt?: string;");
    expect(output).toContain("tags: string[];");
    expect(output).toContain("postId?: unknown;");
    expect(output).toContain("queryId?: unknown;");
  });

  it("generates actionable Cursor AI rules", () => {
    const blocks: BlockJson[] = [
      {
        name: "custom/testimonial",
        title: "Testimonial Block",
        apiVersion: 3,
        attributes: {
          quote: { type: "string", default: "" },
          author: { type: "string", default: "" },
        },
      },
    ];

    const rules = generateCursorRules(blocks);

    expect(rules).toContain("### Block: `custom/testimonial`");
    expect(rules).toContain("`quote`: `string`");
    expect(rules).toContain("Coding Standards for Gutenberg Blocks");
    expect(rules).toContain("useBlockProps");
  });
});
