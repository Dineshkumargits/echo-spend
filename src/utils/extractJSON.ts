/**
 * Robust JSON extraction from LLM responses.
 *
 * LLM models frequently wrap their JSON output in markdown fences,
 * add preamble text like "Here is the data:", or append trailing commentary.
 * This utility strips all of that to extract clean JSON.
 */

/**
 * Extract a JSON object `{...}` from a raw LLM response string.
 * Handles markdown code fences, preamble, and trailing text.
 */
export function extractJSONObject<T = Record<string, unknown>>(raw: string): T | null {
  const cleaned = stripMarkdownFences(raw);

  // Try direct parse first (best case)
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as T;
    }
  } catch {}

  // Find the first balanced `{...}` block
  const match = findBalancedBraces(cleaned);
  if (match) {
    try {
      return JSON.parse(match) as T;
    } catch {}
  }

  // Last resort: aggressive regex
  const regexMatch = cleaned.match(/\{[\s\S]*\}/);
  if (regexMatch) {
    try {
      return JSON.parse(regexMatch[0]) as T;
    } catch {}
  }

  return null;
}

/**
 * Extract a JSON array `[...]` from a raw LLM response string.
 */
export function extractJSONArray<T = unknown[]>(raw: string): T | null {
  const cleaned = stripMarkdownFences(raw);

  // Try direct parse first
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed as T;
    }
  } catch {}

  // Find the first `[...]` block
  const match = findBalancedBrackets(cleaned);
  if (match) {
    try {
      return JSON.parse(match) as T;
    } catch {}
  }

  // Last resort: aggressive regex
  const regexMatch = cleaned.match(/\[[\s\S]*\]/);
  if (regexMatch) {
    try {
      return JSON.parse(regexMatch[0]) as T;
    } catch {}
  }

  return null;
}

/**
 * Strip markdown code fences (```json ... ```, ```...```) from a string.
 * Also strips common LLM preamble like "Here is the JSON:" etc.
 */
function stripMarkdownFences(raw: string): string {
  let text = raw.trim();

  // Remove ```json ... ``` or ``` ... ``` blocks, keeping inner content
  // This regex handles optional language identifier after opening fence
  const fenceRegex = /```(?:json|JSON|javascript|JS)?\s*\n?([\s\S]*?)```/g;
  const fenceMatch = fenceRegex.exec(text);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Remove common LLM preamble lines before JSON
  text = text.replace(
    /^(?:Here\s+(?:is|are)\s+.*?:|Based\s+on\s+.*?:|The\s+(?:extracted|parsed)\s+.*?:)\s*/i,
    ''
  ).trim();

  return text;
}

/**
 * Find the first balanced `{...}` in a string via character scanning.
 */
function findBalancedBraces(text: string): string | null {
  let start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * Find the first balanced `[...]` in a string via character scanning.
 */
function findBalancedBrackets(text: string): string | null {
  let start = text.indexOf('[');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}
