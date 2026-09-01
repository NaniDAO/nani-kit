import { z } from "zod";
import { outputError } from "./output.js";

/**
 * Parse CLI flags into an object, using the tool's Zod schema for
 * type coercion and array detection.
 */
export function parseFlags(argv: string[], schema: z.ZodObject<any>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const shape = schema.shape;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (!arg.startsWith("--")) {
      i++;
      continue;
    }

    // Support both --key value and --key=value
    let key: string;
    let inlineValue: string | undefined;
    const eqIdx = arg.indexOf("=", 2);
    if (eqIdx !== -1) {
      key = arg.slice(2, eqIdx);
      inlineValue = arg.slice(eqIdx + 1);
    } else {
      key = arg.slice(2);
    }

    // --json escape hatch: merge raw JSON into result
    if (key === "json") {
      const jsonStr = inlineValue ?? argv[++i];
      if (jsonStr === undefined) outputError("--json requires a value");
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          outputError("--json value must be a JSON object");
        }
        for (const parsedKey of Object.keys(parsed)) {
          if (
            parsedKey === "__proto__" ||
            parsedKey === "constructor" ||
            parsedKey === "prototype"
          ) {
            continue;
          }
          result[parsedKey] = parsed[parsedKey];
        }
      } catch (error) {
        if (error instanceof SyntaxError) {
          outputError(`Invalid JSON for --json: ${jsonStr}`);
        }
        throw error;
      }
      i++;
      continue;
    }

    const fieldSchema = shape[key];

    // Determine the value: inline (=) takes priority, then next arg
    let rawValue: string | undefined = inlineValue;
    if (rawValue === undefined) {
      const next = argv[i + 1];
      // Next arg is a value if it exists and is not a flag (or schema says number, allowing negatives)
      if (next !== undefined && (!next.startsWith("--") || (fieldSchema && isNumericSchema(fieldSchema) && /^--?\d/.test(next)))) {
        rawValue = next;
        i++; // consume the value arg
      }
    }

    if (rawValue === undefined) {
      // Boolean flag (no value)
      result[key] = true;
      i++;
      continue;
    }

    const coerced = coerceValue(rawValue, fieldSchema);

    // If the schema expects an array, accumulate values
    if (fieldSchema && isArraySchema(fieldSchema)) {
      const existing = result[key];
      if (Array.isArray(existing)) {
        existing.push(coerced);
      } else {
        result[key] = [coerced];
      }
    } else {
      result[key] = coerced;
    }

    i++;
  }

  return result;
}

/** Check if a Zod schema (possibly wrapped) expects a number. */
export function isNumericSchema(schema: z.ZodTypeAny): boolean {
  const inner = unwrapSchema(schema);
  return inner instanceof z.ZodNumber;
}

/** Check if a Zod schema (possibly wrapped in optional/default) is an array type. */
export function isArraySchema(schema: z.ZodTypeAny): boolean {
  if (schema instanceof z.ZodArray) return true;
  if (schema instanceof z.ZodOptional) return isArraySchema(schema.unwrap());
  if (schema instanceof z.ZodDefault) return isArraySchema(schema.removeDefault());
  return false;
}

/** Unwrap optional/default to get the inner schema. */
export function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodOptional) return unwrapSchema(schema.unwrap());
  if (schema instanceof z.ZodDefault) return unwrapSchema(schema.removeDefault());
  return schema;
}

/** Coerce a raw string value based on the Zod schema type. */
export function coerceValue(raw: string, schema?: z.ZodTypeAny): unknown {
  if (!schema) return raw;

  let inner = unwrapSchema(schema);

  // For arrays, coerce against the element type
  if (inner instanceof z.ZodArray) {
    inner = inner.element;
  }

  if (inner instanceof z.ZodNumber) {
    const n = Number(raw);
    if (!Number.isNaN(n)) return n;
    return raw;
  }

  if (inner instanceof z.ZodBoolean) {
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
    return raw;
  }

  // ZodEnum, ZodString, etc. — return as-is
  return raw;
}
