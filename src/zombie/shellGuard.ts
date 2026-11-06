// Shell write guard.
//
// The pre-work gate and the ledger guard both need to know whether a shell
// command changes the project. A substring regex cannot answer that: `2>/dev/null`
// and `node -e "console.log(1)"` are read-only, while `echo x > file` is a write
// with no tool filePath at all. So parse the command shape: quotes are data,
// /dev/null is a sink, `2>&1` is a descriptor copy, and only real destinations
// count as targets.

export type ShellWrite = {
  /** The command can change the project. */
  mutates: boolean;
  /** Paths this command writes (relative or absolute, as typed). */
  targets: string[];
  reason: string;
};

const WRITE_VERBS = new Set([
  "tee",
  "cp",
  "mv",
  "install",
  "ln",
  "rsync",
  "truncate",
  "touch",
  "dd",
  "rm",
  "rmdir",
  "mkdir",
  "chmod",
  "chown",
  "chgrp",
  "shred",
]);

const WRAPPERS = new Set(["sudo", "doas", "env", "command", "builtin", "nohup", "time", "exec"]);

// redirect target: `> file`, `>> file`. A `>&2` / `2>&1` descriptor copy and a
// <input redirect are not writes.
const REDIRECT = /(?:^|[^<>&])>{1,2}\s*([^\s;&|()<>]+)/g;
const DEV_NULL = /(?:^|[\s\d&])>{1,2}\s*\/dev\/null\b/g;

// Write APIs inside `node -e` / `python3 -c` payloads. Quotes are stripped from
// the command shape, so this check runs against the raw text.
const WRITE_API =
  /\b(?:writeFileSync|writeFile|appendFileSync|appendFile|unlinkSync|unlink|rmSync|rmdirSync|renameSync|rename|cpSync|copyFileSync|copyFile|createWriteStream|mkdirSync|chmodSync)\s*\(|\bopen\s*\(\s*[^)]*['"](?:w|a|wb|ab)['"]/;

const GIT_WRITE =
  /^git\s+(?:commit|push|checkout|reset|clean|rm|mv|apply|merge|rebase|stash|tag|add|restore|switch|init|clone|pull|submodule)\b/;
const PKG_WRITE =
  /^(?:npm|pnpm|yarn|bun)\s+(?:install|i|ci|add|remove|uninstall|update|upgrade|publish|link|dedupe|prune)\b/;
const FETCH_WRITE = /^(?:curl|wget)\b[^\n]*\s(?:-o|--output|-O|--remote-name)\b/;
const SHELL_C = /(?:^|[;&|]\s*)(?:sh|bash|zsh|dash)\s+-c\s+([\s\S]+)$/;

const LEDGER_SUFFIX = /(?:^|\/)\.zombiecoder\/(?:syllabus\.md|SSOT\.md)$/i;

function stripQuoted(value: string): string {
  let out = "";
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
        out += " ";
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      out += " ";
      continue;
    }
    out += char;
  }
  return out;
}

function stripSinks(value: string): string {
  return value.replace(DEV_NULL, " ").replace(/\d*>&\d+/g, " ");
}

/** Split into command segments so `git status && cp a b` is judged per command. */
function segments(command: string): string[] {
  return command
    .split(/;|&&|\|\||\||\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function tokens(segment: string): string[] {
  return segment.split(/\s+/).filter(Boolean);
}

function withoutWrapper(list: string[]): string[] {
  let index = 0;
  while (index < list.length && (WRAPPERS.has(list[index]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(list[index]))) {
    index += 1;
  }
  return list.slice(index);
}

function isOption(token: string): boolean {
  return token.startsWith("-");
}

function pathArgs(list: string[]): string[] {
  return list.filter((token) => !isOption(token) && !/^\d*[<>]/.test(token));
}

function baseName(token: string): string {
  return token.replace(/^.*\//, "");
}

function verbTargets(list: string[]): { verb: string; targets: string[] } | null {
  const args = withoutWrapper(list);
  if (args.length === 0) return null;
  const verb = baseName(args[0]).toLowerCase();
  const rest = args.slice(1);
  if (verb === "dd") {
    const of = rest.filter((token) => token.startsWith("of=")).map((token) => token.slice(3));
    return { verb, targets: of };
  }
  if (verb === "sed" || verb === "perl") {
    const inPlace = rest.some((token) => /^--in-place(?:=|$)/.test(token) || /^-[a-zA-Z]*i/.test(token));
    if (!inPlace) return null;
    // The script itself is quoted and already stripped; keep tokens that look
    // like file paths. `sed -i s/a/b/ file` leaves the script as a token.
    return { verb, targets: rest.filter((token) => /[\\/.]/.test(token) && !isOption(token)) };
  }
  if (!WRITE_VERBS.has(verb)) return null;
  const paths = pathArgs(rest);
  if (paths.length === 0) return { verb, targets: [] };
  if (["cp", "mv", "install", "ln", "rsync"].includes(verb)) {
    return { verb, targets: [paths[paths.length - 1]] };
  }
  return { verb, targets: paths };
}

function redirectTargets(stripped: string): string[] {
  const out: string[] = [];
  for (const match of stripped.matchAll(REDIRECT)) {
    const target = String(match[1] ?? "").trim();
    if (!target || target.startsWith("&")) continue;
    out.push(target);
  }
  return out;
}

function analyzeOnce(command: string): ShellWrite {
  const raw = String(command ?? "").trim();
  if (!raw) return { mutates: false, targets: [], reason: "empty command" };
  const stripped = stripSinks(stripQuoted(raw));
  const targets: string[] = [];
  let reason = "";

  if (WRITE_API.test(raw)) {
    reason = "inline write API";
  }
  if (!reason) {
    for (const segment of segments(stripped)) {
      const list = tokens(segment);
      const redirected = redirectTargets(segment);
      if (redirected.length > 0) {
        targets.push(...redirected);
        reason ||= "output redirect";
      }
      const verb = verbTargets(list);
      if (verb) {
        targets.push(...verb.targets);
        reason ||= `write verb: ${verb.verb}`;
      }
      const head = withoutWrapper(list)[0] ?? "";
      if (GIT_WRITE.test(segment)) reason ||= "git write command";
      else if (PKG_WRITE.test(segment)) reason ||= "package manager write";
      else if (FETCH_WRITE.test(segment)) reason ||= "download to disk";
      else if (/^(?:python3?|node)\b/.test(head) && WRITE_API.test(raw)) reason ||= "inline write API";
    }
  }

  // A shell wrapper hides a real command inside quotes. Recurse once so
  // `bash -c "echo x > f"` does not become a bypass.
  const wrapped = SHELL_C.exec(raw);
  if (wrapped) {
    const body = wrapped[1].trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
    const inner = analyzeOnce(body);
    if (inner.mutates) {
      return {
        mutates: true,
        targets: [...new Set([...targets, ...inner.targets])],
        reason: inner.reason ? `shell -c: ${inner.reason}` : "shell -c",
      };
    }
  }

  return {
    mutates: Boolean(reason),
    targets: [...new Set(targets)],
    reason: reason || "read-only command",
  };
}

/** Full verdict for a shell command. */
export function analyzeShell(command: string): ShellWrite {
  const verdict = analyzeOnce(command);
  return { ...verdict, targets: verdict.targets.map((target) => target.replace(/^['"]|['"]$/g, "")) };
}

/** Convenience for the pre-work gate. */
export function likelyMutatesShell(command: string): boolean {
  return analyzeShell(command).mutates;
}

/** The ledger file this command writes, if any. Backups to elsewhere are fine. */
export function ledgerTarget(command: string): string | null {
  const verdict = analyzeShell(command);
  if (!verdict.mutates) return null;
  for (const target of verdict.targets) {
    const normalized = target.replace(/\\/g, "/").replace(/^\.\//, "");
    if (LEDGER_SUFFIX.test(normalized)) return target;
  }
  return null;
}
