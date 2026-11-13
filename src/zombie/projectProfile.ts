// Bounded technology inventory. Only conventional root manifests/configuration
// files are read; dependency directories and generated output never enter it.

import * as fs from "node:fs";
import * as path from "node:path";

export type TechnologyProfile = {
  id: string;
  label: string;
  version: string;
  evidence: string;
  templates: string[];
  checks: string[];
  documentation: string[];
  compiler: string[];
};

function text(root: string, name: string): string | undefined {
  try { return fs.readFileSync(path.join(root, name), "utf8"); } catch { return undefined; }
}

function json(root: string, name: string): any | undefined {
  const raw = text(root, name);
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

function versionFrom(raw: string | undefined, pattern: RegExp): string {
  return raw?.match(pattern)?.[1]?.trim() || "declared but not parsed";
}

export function discoverTechnologyProfiles(root: string): TechnologyProfile[] {
  const profiles: TechnologyProfile[] = [];
  const pkg = json(root, "package.json");
  if (pkg) {
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } as Record<string, string>;
    profiles.push({
      id: "node",
      label: "Node.js / JavaScript",
      version: typeof pkg.engines?.node === "string" ? pkg.engines.node : "not declared",
      evidence: "package.json",
      templates: ["package.json", "src/", "test/ or tests/"],
      checks: Object.keys(pkg.scripts ?? {}).filter((name) => /^(typecheck|lint|test|build|check)$/.test(name)).map((name) => `npm run ${name}`),
      documentation: ["https://nodejs.org/docs/latest/api/", "https://www.typescriptlang.org/docs/"],
      compiler: ["node --version", "npx tsc --version (when TypeScript is installed)"],
    });
    if (deps.next) profiles.push({
      id: "next",
      label: "Next.js",
      version: String(deps.next),
      evidence: "package.json dependency next",
      templates: ["app/ or pages/", "next.config.*", "public/"],
      checks: ["npm run build", "npm run lint"].filter((command) => command !== "npm run lint" || Boolean(pkg.scripts?.lint)),
      documentation: ["https://nextjs.org/docs"],
      compiler: ["npm run build"],
    });
  }
  const pyproject = text(root, "pyproject.toml");
  const requirements = text(root, "requirements.txt");
  if (pyproject || requirements) profiles.push({
    id: "python", label: "Python", version: versionFrom(pyproject, /requires-python\s*=\s*["']([^"']+)/i),
    evidence: pyproject ? "pyproject.toml" : "requirements.txt", templates: ["pyproject.toml or requirements.txt", "src/ or package/", "tests/"],
    checks: pyproject ? ["python -m pytest", "python -m compileall -q ."] : ["python -m compileall -q ."],
    documentation: ["https://docs.python.org/3/"], compiler: ["python3 --version", "python3 -m compileall -q <changed files>"],
  });
  const composer = json(root, "composer.json");
  if (composer) profiles.push({ id: "php", label: "PHP", version: String(composer.require?.php ?? "not declared"), evidence: "composer.json", templates: ["composer.json", "app/ or src/", "tests/"], checks: ["php -l <target>"], documentation: ["https://www.php.net/docs.php"], compiler: ["php --version", "php -l <changed file>"] });
  const go = text(root, "go.mod");
  if (go) profiles.push({ id: "go", label: "Go", version: versionFrom(go, /^go\s+([^\s]+)/m), evidence: "go.mod", templates: ["go.mod", "cmd/ or internal/", "*_test.go"], checks: ["go test ./..."], documentation: ["https://go.dev/doc/"], compiler: ["go version", "go test ./..."] });
  const cargo = text(root, "Cargo.toml");
  if (cargo) profiles.push({ id: "rust", label: "Rust", version: versionFrom(cargo, /^rust-version\s*=\s*["']([^"']+)/m), evidence: "Cargo.toml", templates: ["Cargo.toml", "src/", "tests/"], checks: ["cargo test"], documentation: ["https://doc.rust-lang.org/"], compiler: ["rustc --version", "cargo test"] });
  const pom = text(root, "pom.xml");
  const gradle = text(root, "build.gradle") ?? text(root, "build.gradle.kts");
  if (pom || gradle) profiles.push({ id: "jvm", label: pom ? "Java (Maven)" : "JVM (Gradle)", version: "not declared", evidence: pom ? "pom.xml" : "build.gradle", templates: ["src/main/", "src/test/"], checks: [pom ? "mvn test" : "./gradlew test"], documentation: ["https://dev.java/learn/"], compiler: ["java -version", "javac -version", pom ? "mvn test" : "./gradlew test"] });
  return profiles;
}
