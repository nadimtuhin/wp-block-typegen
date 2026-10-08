export interface ValidationError {
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface BlockAttributeSchema {
  type?: string | string[];
  default?: unknown;
  enum?: (string | number | boolean)[];
  items?: BlockAttributeSchema;
  properties?: Record<string, BlockAttributeSchema>;
  source?: string;
  selector?: string;
  attribute?: string;
  query?: Record<string, BlockAttributeSchema>;
  [key: string]: unknown;
}

/** Item schema of an array attribute: explicit `items`, or the shape of a `source: "query"` row. */
export function itemsOf(s: BlockAttributeSchema): BlockAttributeSchema | undefined {
  if (s.items) return s.items;
  if (s.query) return { type: "object", properties: s.query };
  return undefined;
}

export interface BlockJson {
  $schema?: string;
  apiVersion?: number;
  name: string;
  title?: string;
  category?: string;
  icon?: string | Record<string, unknown>;
  description?: string;
  attributes?: Record<string, BlockAttributeSchema>;
  supports?: Record<string, unknown>;
  usesContext?: string[];
  providesContext?: Record<string, string>;
  [key: string]: unknown;
}

const VALID_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "array",
  "object",
  "null",
  "rich-text", // Gutenberg-specific: stored as an HTML string
]);

export function validateBlockJson(data: unknown): {
  valid: boolean;
  block?: BlockJson;
  issues: ValidationError[];
} {
  const issues: ValidationError[] = [];

  if (!data || typeof data !== "object") {
    return {
      valid: false,
      issues: [{ field: "root", message: "block.json must be a valid JSON object", severity: "error" }],
    };
  }

  const raw = data as Record<string, unknown>;

  if (typeof raw.name !== "string" || !raw.name.trim()) {
    issues.push({
      field: "name",
      message: 'Missing or empty "name" property',
      severity: "error",
    });
  } else if (!raw.name.includes("/")) {
    issues.push({
      field: "name",
      message: `Block name "${raw.name}" must include a namespace prefix (e.g. "namespace/block-name")`,
      severity: "error",
    });
  }

  if (typeof raw.apiVersion !== "number") {
    issues.push({
      field: "apiVersion",
      message: 'Missing "apiVersion". Modern WordPress blocks should declare apiVersion: 3',
      severity: "warning",
    });
  } else if (raw.apiVersion < 2) {
    issues.push({
      field: "apiVersion",
      message: `apiVersion ${raw.apiVersion} is legacy. Consider upgrading to apiVersion: 3`,
      severity: "warning",
    });
  }

  if (raw.attributes && typeof raw.attributes === "object") {
    const attrs = raw.attributes as Record<string, unknown>;
    for (const [attrName, attrValue] of Object.entries(attrs)) {
      if (!attrValue || typeof attrValue !== "object") {
        issues.push({
          field: `attributes.${attrName}`,
          message: `Attribute "${attrName}" must be an object definition`,
          severity: "error",
        });
        continue;
      }

      const attr = attrValue as BlockAttributeSchema;
      if (attr.type) {
        const typesToCheck = Array.isArray(attr.type) ? attr.type : [attr.type];
        for (const t of typesToCheck) {
          if (!VALID_TYPES.has(t)) {
            issues.push({
              field: `attributes.${attrName}.type`,
              message: `Invalid attribute type "${t}". Must be one of: ${Array.from(VALID_TYPES).join(", ")}`,
              severity: "error",
            });
          }
        }
      }

      // Check for image/media attributes without alt text accessibility field
      if (
        (attrName.toLowerCase().includes("image") || attrName.toLowerCase().includes("media")) &&
        attr.type === "object" &&
        attr.properties &&
        !("alt" in attr.properties)
      ) {
        issues.push({
          field: `attributes.${attrName}.properties`,
          message: `Accessibility (WCAG 2.1): Media object "${attrName}" is missing an "alt" text property`,
          severity: "warning",
        });
      }
    }
  }

  const hasErrors = issues.some((i) => i.severity === "error");

  return {
    valid: !hasErrors,
    block: raw as unknown as BlockJson,
    issues,
  };
}
