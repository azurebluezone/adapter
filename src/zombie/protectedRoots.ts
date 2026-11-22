// The plugin is a separate module. A session whose working directory is outside
// the plugin source/install roots may read them for diagnosis, but must never
// edit them: an agent that "fixes" the rules mid-task changes the environment
// it is being judged by. This module is pure path logic so it is testable
// without an OpenCode session.

import * as os from "node:os";
import * as path from "node:path";

export type ProtectedRootOptions = {
  installRoot: string;
  sourceRoot?: string;
};

export function isInsidePath(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Expand `~`, strip a `:line` suffix and resolve against the working directory. */
export function resolveSessionPath(value: string, projectRoot: string): string | null {
  const raw = String(value ?? "").trim();
  if (!raw || /^https?:\/\//i.test(raw)) return null;
  let text = raw.replace(/:\d+(?:-\d+)?$/, "").replace(/[),.;]+$/, "");
  if (text === "~") text = os.homedir();
  else if (text.startsWith("~/")) text = path.join(os.homedir(), text.slice(2));
  return path.isAbsolute(text) ? path.resolve(text) : path.resolve(projectRoot, text);
}

/** Absolute/relative path tokens a mutating shell command may touch. */
export function shellPathTokens(command: string): string[] {
  const out: string[] = [];
  const pathLike = /(?:^|[\s"'=:])((?:~|\.{1,2})?\/[^\s"'`;|&()<>]+)/g;
  for (const match of command.matchAll(pathLike)) out.push(match[1]);
  const anchored = /\b(?:cd|pushd|git\s+-C|npm\s+--prefix|--prefix|--cwd)\s+([^\s"'`;|&()<>]+)/g;
  for (const match of command.matchAll(anchored)) out.push(match[1]);
  return out;
}

export function protectedRoots(options: ProtectedRootOptions): string[] {
  const roots = new Set<string>();
  if (options.installRoot) roots.add(path.resolve(options.installRoot));
  if (options.sourceRoot) roots.add(path.resolve(options.sourceRoot));
  // Never protect a filesystem root such as "/" or "C:\".
  return [...roots].filter((root) => root !== path.parse(root).root);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when `text` mentions `target` as a whole path. A plain substring check
 * would also match a sibling such as `/home/user/adapter-other`, blocking a
 * write that never touches the protected tree.
 */
function mentionsPath(text: string, target: string): boolean {
  if (!target) return false;
  const pattern = new RegExp(`(?:^|[\\s"'=:])${escapeRegex(target)}(?=$|[\\s"';|&)<>/])`);
  return pattern.test(text);
}

/**
 * Return a human-readable reason when a mutating write targets a protected
 * plugin root from a working directory outside it, otherwise null.
 *
 * `command` must already be known to mutate; a read-only `cat`/`git status`
 * never reaches this guard.
 */
export function protectedWriteTarget(
  targets: readonly string[],
  command: string,
  projectRoot: string,
  options: ProtectedRootOptions,
): string | null {
  const roots = protectedRoots(options);
  const outside = roots.filter((root) => !isInsidePath(projectRoot, root));
  if (outside.length === 0) return null;

  const resolved = targets
    .map((target) => resolveSessionPath(target, projectRoot))
    .filter((target): target is string => Boolean(target));
  for (const token of shellPathTokens(command)) {
    const pathTarget = resolveSessionPath(token, projectRoot);
    if (pathTarget) resolved.push(pathTarget);
  }

  for (const root of outside) {
    const home = os.homedir();
    const homeForm = root === home || root.startsWith(home + path.sep)
      ? `~${root.slice(home.length)}`
      : root;
    if (mentionsPath(command, root) || (homeForm !== root && mentionsPath(command, homeForm))) {
      return `the plugin root ${root} is read-only from working directory ${projectRoot}`;
    }
  }

  const hit = resolved.find((target) => outside.some((root) => isInsidePath(target, root)));
  return hit
    ? `the plugin root is read-only from working directory ${projectRoot}: ${hit}`
    : null;
}
