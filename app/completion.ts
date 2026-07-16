import path from "path";
import { spawnSync } from "child_process";
import { completionSpecs, tabCompletableCommands } from "./state.ts";
import { findExecutableCompletions, findPathHits, isDirectory } from "./fsUtils.ts";
import { getRl, ringBell } from "./runtime.ts";

let lastTabPartial = "";
let tabPressCount = 0;

export function resetTabState(): void {
  lastTabPartial = "";
  tabPressCount = 0;
}

function completeWithMatches(
  line: string,
  typedPartial: string,
  linePrefix: string,
  hits: string[],
  listHits: string[],
  formatSingle: (fullCompletion: string, hit: string) => string,
): [string[], string] {
  if (hits.length === 1) {
    resetTabState();
    return [[formatSingle(linePrefix + hits[0], hits[0])], line];
  }

  if (hits.length === 0) {
    resetTabState();
    ringBell();
    return [[], line];
  }

  const commonPrefix = longestCommonPrefix(hits);
  if (commonPrefix.length > typedPartial.length) {
    resetTabState();
    return [[linePrefix + commonPrefix], line];
  }

  if (lastTabPartial !== line) {
    lastTabPartial = line;
    tabPressCount = 0;
  }
  tabPressCount++;

  if (tabPressCount === 1) {
    ringBell();
    return [[], line];
  }

  process.stdout.write(`\n${listHits.join("  ")}\n`);
  getRl().prompt(true);
  resetTabState();
  return [[], line];
}

export function completeCommand(line: string): [string[], string] {
  const partial = line;
  const builtinHits = tabCompletableCommands.filter((cmd) => cmd.startsWith(partial));
  const executableHits = findExecutableCompletions(partial);
  const hits = [...new Set([...builtinHits, ...executableHits])].sort();

  return completeWithMatches(
    line,
    partial,
    "",
    hits,
    hits,
    (_full, hit) => `${hit} `,
  );
}

export function completeArgument(line: string): [string[], string] {
  const lastSpace = line.lastIndexOf(" ");
  const linePrefix = line.slice(0, lastSpace + 1);
  const partial = line.slice(lastSpace + 1);
  const command = line.slice(0, lastSpace).split(/\s+/)[0] ?? "";

  if (command && completionSpecs.has(command)) {
    return completeProgrammable(command, line, linePrefix, partial);
  }

  const directoriesOnly = command === "cd";

  const pathHits = findPathHits(partial, directoriesOnly);
  const hits = pathHits.map((hit) => hit.suffix);
  const listHits = pathHits.map((hit) => {
    const entryPath = path.join(hit.parentDir, hit.entryName);
    if (isDirectory(entryPath)) {
      return `${hit.suffix}/`;
    }
    return hit.suffix;
  });

  return completeWithMatches(
    line,
    partial,
    linePrefix,
    hits,
    listHits,
    (full, hit) => {
      const pathHit = pathHits.find((candidate) => candidate.suffix === hit)!;
      const entryPath = path.join(pathHit.parentDir, pathHit.entryName);
      if (directoriesOnly || isDirectory(entryPath)) {
        return `${full}/`;
      }
      return `${full} `;
    },
  );
}

function completeProgrammable(
  command: string,
  line: string,
  linePrefix: string,
  partial: string,
): [string[], string] {
  const completerPath = completionSpecs.get(command)!;
  const beforePartial = line.slice(0, line.lastIndexOf(" ")).trim();
  const words = beforePartial ? beforePartial.split(/\s+/) : [];
  const prev = words.length > 0 ? words[words.length - 1]! : "";

  const result = spawnSync(completerPath, [command, partial, prev], {
    env: {
      ...process.env,
      COMP_LINE: line,
      COMP_POINT: String(line.length),
    },
    encoding: "utf-8",
  });

  const exitCode = result.status ?? 1;
  const stdoutLines = (result.stdout ?? "")
    .split("\n")
    .filter((candidate) => candidate.length > 0);
  const stderrLines = (result.stderr ?? "")
    .split("\n")
    .filter((candidate) => candidate.length > 0);

  if (exitCode !== 0) {
    resetTabState();
    ringBell();
    return [[], line];
  }

  let candidates: string[];
  let stderrTail: string[] = [];
  const useStdout = stdoutLines.length > 0;

  if (useStdout) {
    candidates = stdoutLines.filter((candidate) => candidate.startsWith(partial));
  } else if (stderrLines.length > 0) {
    const first = stderrLines[0]!;
    if (!first.startsWith(partial)) {
      resetTabState();
      ringBell();
      return [[], line];
    }
    candidates = [first];
    stderrTail = stderrLines.slice(1);
  } else {
    resetTabState();
    ringBell();
    return [[], line];
  }

  const writeStderrTail = () => {
    for (const errLine of stderrTail) {
      process.stderr.write(`${errLine}\n`);
    }
  };

  return completeWithMatches(
    line,
    partial,
    linePrefix,
    candidates,
    candidates,
    (full) => {
      writeStderrTail();
      return useStdout ? `${full} ` : full;
    },
  );
}

function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return "";
  if (strings.length === 1) return strings[0];

  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    while (!strings[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (prefix === "") return "";
    }
  }
  return prefix;
}
