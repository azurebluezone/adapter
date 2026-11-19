// Tool output has two jobs: the model needs a bounded preview, and the audit
// trail needs the full body. Keeping both in the prompt burns context; throwing
// the body away loses evidence. This module writes large results to
// .zombiecoder/tool-results/ with a content hash, and hands the caller a short
// preview plus the artifact path.

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { ensureDir, redact } from "./io.ts";

export const ARCHIVE_THRESHOLD = 8 * 1024;
export const PREVIEW_CHARS = 800;

/** A tool result reaches the after-hook as `{ output }` (v1) or as
 *  `{ content, output }` (v2). Picking the readable text first keeps the
 *  archive useful to a human; falling back to the structured output keeps the
 *  data when no text exists. */
export function extractToolOutput(event: unknown): unknown {
  const record = event && typeof event === "object" ? (event as Record<string, unknown>) : null;
  if (!record) return event;
  if (record.output !== undefined && record.output !== null) return record.output;
  const result = record.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const inner = result as Record<string, unknown>;
  const content = inner.content;
  if (typeof content === "string" && content.trim()) return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
          return String((part as Record<string, unknown>).text);
        }
        return "";
      })
      .join("\n")
      .trim();
    if (text) return text;
  }
  if (inner.output !== undefined && inner.output !== null) return inner.output;
  return result;
}

export type ToolArchiveResult = {
  archived: boolean;
  bytes: number;
  sha256: string;
  preview: string;
  truncated: boolean;
  /** Relative to the project root, e.g. .zombiecoder/tool-results/... */
  file?: string;
};

function bodyOf(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2) ?? String(output);
  } catch {
    return String(output);
  }
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "tool";
}

/** Secret masking is deliberate: the archive is on disk and survives the
 *  session, so a bearer token in a verbose response must not be persisted. */
export function archiveToolResult(input: {
  root: string;
  tool: string;
  output: unknown;
  sessionID?: string;
  threshold?: number;
  now?: Date;
}): ToolArchiveResult {
  const body = redact(bodyOf(input.output));
  const bytes = Buffer.byteLength(body, "utf8");
  const sha256 = createHash("sha256").update(body, "utf8").digest("hex");
  const preview = body.slice(0, PREVIEW_CHARS);
  const threshold = Math.max(0, Number(input.threshold ?? ARCHIVE_THRESHOLD));
  if (bytes <= threshold) {
    return { archived: false, bytes, sha256, preview, truncated: false };
  }
  const dir = path.join(input.root, ".zombiecoder", "tool-results");
  ensureDir(dir);
  const stamp = (input.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const name = `${stamp}-${safeName(input.tool)}-${sha256.slice(0, 8)}.txt`;
  const absolute = path.join(dir, name);
  fs.writeFileSync(absolute, body, { encoding: "utf8", mode: 0o600 });
  return {
    archived: true,
    bytes,
    sha256,
    preview,
    truncated: true,
    file: path.relative(input.root, absolute).replace(/\\/g, "/"),
  };
}

/** Read an archived result by its project-relative path. A path that escapes
 *  the archive directory is refused. */
export function readArchivedResult(root: string, file: string): string | null {
  const dir = path.resolve(root, ".zombiecoder", "tool-results");
  const target = path.resolve(root, String(file ?? ""));
  if (!target.startsWith(dir + path.sep)) return null;
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return null;
    return fs.readFileSync(target, "utf8");
  } catch {
    return null;
  }
}
