import { createInterface } from "readline";
import { accessSync, appendFileSync, closeSync, constants, openSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import path from "path";
import { spawn, spawnSync, type ChildProcess } from "child_process";


const tabCompletableCommands = ["echo", "exit"];
const completionSpecs = new Map<string, string>();

type Job = {
  id: number;
  pid: number;
  command: string;
  child: ChildProcess;
  running: boolean;
};

const jobTable = new Map<number, Job>();

function allocateJobId(): number {
  if (jobTable.size === 0) return 1;
  return Math.max(...jobTable.keys()) + 1;
}

function jobMarker(id: number): string {
  const ids = [...jobTable.keys()].sort((a, b) => b - a);
  if (ids[0] === id) return "+";
  if (ids[1] === id) return "-";
  return " ";
}

function formatJobLine(job: Job): string {
  const status = job.running ? "Running" : "Done";
  const suffix = job.running ? " &" : "";
  return `[${job.id}]${jobMarker(job.id)}  ${status.padEnd(24)}${job.command}${suffix}\n`;
}

function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function syncJobStatuses(): void {
  for (const job of jobTable.values()) {
    if (!job.running) continue;
    if (
      job.child.exitCode !== null ||
      job.child.signalCode !== null ||
      !isProcessAlive(job.pid)
    ) {
      job.running = false;
    }
  }
}

function reapFinishedJobs(): void {
  syncJobStatuses();
  const finished = [...jobTable.values()].filter((job) => !job.running);
  for (const job of finished) {
    process.stdout.write(formatJobLine(job));
  }
  for (const job of finished) {
    jobTable.delete(job.id);
  }
}

function promptAfterJobs(): void {
  reapFinishedJobs();
  rl.prompt();
}

function splitPipeline(line: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inSingleQuotes = false;
  let inDoubleQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "\\" && !inSingleQuotes && i + 1 < line.length) {
      current += char + line[i + 1];
      i++;
      continue;
    }
    if (char === "'" && !inDoubleQuotes) {
      inSingleQuotes = !inSingleQuotes;
      current += char;
      continue;
    }
    if (char === '"' && !inSingleQuotes) {
      inDoubleQuotes = !inDoubleQuotes;
      current += char;
      continue;
    }
    if (char === "|" && !inSingleQuotes && !inDoubleQuotes) {
      segments.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments;
}

function builtinOutput(parts: string[]): { stdout: string; stderr: string } | null {
  const command = parts[0];
  if (command === "echo") {
    return { stdout: parts.slice(1).join(" ") + "\n", stderr: "" };
  }
  if (command === "pwd") {
    return { stdout: process.cwd() + "\n", stderr: "" };
  }
  if (command === "type") {
    const target = parts[1];
    if (!target) return { stdout: "", stderr: "" };
    if (builtInCommands.includes(target)) {
      return { stdout: `${target} is a shell builtin\n`, stderr: "" };
    }
    const executablePath = findExecutableInPath(target);
    if (executablePath) {
      return { stdout: `${target} is ${executablePath}\n`, stderr: "" };
    }
    return { stdout: "", stderr: `${target}: not found\n` };
  }
  return null;
}

function runPipeline(segments: string[]): void {
  const stages = segments.map((segment) => parseCommand(segment));
  const children: ChildProcess[] = [];
  // string = buffered builtin output; stream = previous child's stdout
  let prev: string | NodeJS.ReadableStream | null = null;
  let lastChild: ChildProcess | null = null;
  let lastBuiltin: { stdout: string; stderr: string } | null = null;

  for (let i = 0; i < stages.length; i++) {
    const { args: parts, redirects } = stages[i];
    const command = parts[0];
    const isLast = i === stages.length - 1;

    if (!command) {
      prev = null;
      continue;
    }

    const builtin = builtinOutput(parts);
    if (builtin) {
      if (prev && typeof prev !== "string") {
        prev.resume?.();
      }
      if (isLast) {
        lastBuiltin = builtin;
        lastChild = null;
      } else {
        prev = builtin.stdout;
      }
      continue;
    }

    const executablePath = findExecutableInPath(command);
    if (!executablePath) {
      process.stderr.write(`${command}: command not found\n`);
      prev = null;
      if (isLast) {
        lastChild = null;
        lastBuiltin = { stdout: "", stderr: "" };
      }
      continue;
    }

    const stdoutRedirect = redirects.find((redirect) => redirect.fd === 1);
    const stderrRedirect = redirects.find((redirect) => redirect.fd === 2);

    const stdoutSetting = stdoutRedirect
      ? openSync(stdoutRedirect.file, stdoutRedirect.append ? "a" : "w")
      : isLast
        ? "inherit"
        : "pipe";
    const stderrSetting = stderrRedirect
      ? openSync(stderrRedirect.file, stderrRedirect.append ? "a" : "w")
      : "inherit";
    const stdinSetting: "pipe" | "inherit" = prev !== null ? "pipe" : "inherit";

    const child: ChildProcess = spawn(command, parts.slice(1), {
      stdio: [stdinSetting, stdoutSetting, stderrSetting],
    });
    children.push(child);

    child.on("close", () => {
      if (typeof stdoutSetting === "number") closeSync(stdoutSetting);
      if (typeof stderrSetting === "number") closeSync(stderrSetting);
    });

    if (child.stdin) {
      child.stdin.on("error", () => {});
      if (typeof prev === "string") {
        child.stdin.write(prev);
        child.stdin.end();
      } else if (prev) {
        prev.pipe(child.stdin);
      }
    }

    prev = child.stdout ?? null;
    if (isLast) {
      lastChild = child;
      lastBuiltin = null;
    }
  }

  const finish = () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
    }
    promptAfterJobs();
  };

  if (lastChild) {
    lastChild.on("close", finish);
  } else {
    if (lastBuiltin) {
      if (lastBuiltin.stdout) process.stdout.write(lastBuiltin.stdout);
      if (lastBuiltin.stderr) process.stderr.write(lastBuiltin.stderr);
    }
    if (children.length > 0) {
      let remaining = children.length;
      for (const child of children) {
        child.on("close", () => {
          remaining--;
          if (remaining === 0) finish();
        });
      }
    } else {
      promptAfterJobs();
    }
  }
}

let lastTabPartial = "";
let tabPressCount = 0;
let rl: ReturnType<typeof createInterface>;

type PathHit = {
  suffix: string;
  entryName: string;
  parentDir: string;
};

function ringBell(): void {
  process.stdout.write("\x07");
}

function resetTabState(): void {
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
  rl.prompt(true);
  resetTabState();
  return [[], line];
}

function completeCommand(line: string): [string[], string] {
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

function completeArgument(line: string): [string[], string] {
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
    if (isDirectoryPath(entryPath)) {
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
      if (directoriesOnly || isDirectoryPath(entryPath)) {
        return `${full}/`;
      }
      return `${full} `;
    },
  );
}

rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
  completer: (line: string): [string[], string] => {
    if (!line.includes(" ")) {
      return completeCommand(line);
    }
    return completeArgument(line);
  },
});

const builtInCommands = ["echo", "exit", "type", "pwd", "cd", "complete", "jobs", "history", "declare"];

const commandHistory: string[] = [];
let lastAppendedIndex = 0;

const shellVariables = new Map<string, string>();

function loadHistoryFile(file: string): void {
  try {
    const content = readFileSync(file, "utf-8");
    for (const entry of content.split("\n")) {
      if (entry.length > 0) {
        commandHistory.push(entry);
      }
    }
  } catch {
  }
}

function writeHistoryFile(file: string): void {
  const content = commandHistory.length > 0 ? commandHistory.join("\n") + "\n" : "";
  writeFileSync(file, content);
  lastAppendedIndex = commandHistory.length;
}

function appendHistoryFile(file: string): void {
  const newEntries = commandHistory.slice(lastAppendedIndex);
  if (newEntries.length > 0) {
    appendFileSync(file, newEntries.join("\n") + "\n");
  }
  lastAppendedIndex = commandHistory.length;
}

function handleHistoryBuiltin(args: string[], redirects: Redirect[]): void {
  const flag = args[0];

  if (flag === "-r" && args[1]) {
    loadHistoryFile(args[1]);
    return;
  }
  if (flag === "-w" && args[1]) {
    writeHistoryFile(args[1]);
    return;
  }
  if (flag === "-a" && args[1]) {
    appendHistoryFile(args[1]);
    return;
  }

  let start = 0;
  if (flag) {
    const limit = parseInt(flag, 10);
    if (!Number.isNaN(limit)) {
      start = Math.max(commandHistory.length - limit, 0);
    }
  }

  let output = "";
  for (let i = start; i < commandHistory.length; i++) {
    output += `${String(i + 1).padStart(5)}  ${commandHistory[i]}\n`;
  }
  writeOutput(output.length > 0 ? output : null, null, redirects);
}

function handleDeclareBuiltin(args: string[], redirects: Redirect[]): void {
  if (args[0] === "-p") {
    const name = args[1];
    if (!name) {
      let output = "";
      for (const [key, value] of [...shellVariables.entries()].sort()) {
        output += `declare -- ${key}="${value}"\n`;
      }
      writeOutput(output.length > 0 ? output : null, null, redirects);
      return;
    }
    const value = shellVariables.get(name);
    if (value !== undefined) {
      writeOutput(`declare -- ${name}="${value}"\n`, null, redirects);
    } else {
      writeOutput(null, `declare: ${name}: not found\n`, redirects);
    }
    return;
  }

  for (const assignment of args) {
    const eqIndex = assignment.indexOf("=");
    const name = eqIndex === -1 ? assignment : assignment.slice(0, eqIndex);
    const value = eqIndex === -1 ? "" : assignment.slice(eqIndex + 1);

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      writeOutput(null, `declare: \`${assignment}': not a valid identifier\n`, redirects);
      continue;
    }
    shellVariables.set(name, value);
  }
}

type Redirect = {
  fd: 1 | 2;
  file: string;
  append: boolean;
};

if (process.env.HISTFILE) {
  loadHistoryFile(process.env.HISTFILE);
  lastAppendedIndex = commandHistory.length;
}

rl.prompt();
rl.on("line", (line) => {
  lastTabPartial = "";
  tabPressCount = 0;

  if (line.trim().length > 0) {
    commandHistory.push(line);
  }

  const pipelineSegments = splitPipeline(line);
  if (pipelineSegments.length > 1) {
    runPipeline(pipelineSegments);
    return;
  }

  const { args: parts, redirects } = parseCommand(line);

  let background = false;
  if (parts.length > 0 && parts[parts.length - 1] === "&") {
    background = true;
    parts.pop();
  }

  const command = parts[0];
  const arg = parts[1];

  if (command == "") {
    promptAfterJobs();
    return;
  } else if (command == "exit") {
    if (process.env.HISTFILE) {
      writeHistoryFile(process.env.HISTFILE);
    }
    rl.close();
    return;
  } else if (command == "echo") {
    writeOutput(parts.slice(1).join(" ") + "\n", null, redirects);
    promptAfterJobs();
    return;
  } else if (command == "type") {
    if (!arg) {
      promptAfterJobs();
      return;
    }

    const found = builtInCommands.includes(arg);
    let output: string;
    if (found) {
      output = `${arg} is a shell builtin\n`;
    } else {
      const executablePath = findExecutableInPath(arg);

      if (executablePath) {
        output = `${arg} is ${executablePath}\n`;
      } else {
        output = `${arg}: not found\n`;
      }
    }

    writeOutput(output, null, redirects);
    promptAfterJobs();
  } else if (command == "pwd"){
    writeOutput(process.cwd() + "\n", null, redirects);
    promptAfterJobs();
    return;
  } else if (command == "cd") {
    const target = expandTilde(arg ?? process.env.HOME ?? "");

    if (!target || !isDirectory(target)) {
      writeOutput(null, `cd: ${arg}: No such file or directory\n`, redirects);
      promptAfterJobs();
      return;
    }

    process.chdir(target);
    promptAfterJobs();
    return;
  } else if (command == "complete") {
    handleCompleteBuiltin(parts.slice(1), redirects);
    promptAfterJobs();
    return;
  } else if (command == "history") {
    handleHistoryBuiltin(parts.slice(1), redirects);
    promptAfterJobs();
    return;
  } else if (command == "declare") {
    handleDeclareBuiltin(parts.slice(1), redirects);
    promptAfterJobs();
    return;
  } else if (command == "jobs") {
    syncJobStatuses();
    const jobs = [...jobTable.values()].sort((a, b) => a.id - b.id);
    for (const job of jobs) {
      process.stdout.write(formatJobLine(job));
    }
    for (const job of jobs) {
      if (!job.running) {
        jobTable.delete(job.id);
      }
    }
    rl.prompt();
    return;
  }
  else {

    const executablePath = findExecutableInPath(command);

    if(!executablePath){
      writeOutput(null, `${command}: command not found\n`, redirects);
      promptAfterJobs();
      return;
    }

    const stdoutRedirect = redirects.find((redirect) => redirect.fd === 1);
    const stderrRedirect = redirects.find((redirect) => redirect.fd === 2);

    const stdout = stdoutRedirect
      ? openSync(stdoutRedirect.file, stdoutRedirect.append ? "a" : "w")
      : "inherit";
    const stderr = stderrRedirect
      ? openSync(stderrRedirect.file, stderrRedirect.append ? "a" : "w")
      : "inherit";

    const child = spawn(command, parts.slice(1), {
      stdio: [background ? "ignore" : "inherit", stdout, stderr],
    });

    if (background) {
      const job: Job = {
        id: allocateJobId(),
        pid: child.pid ?? 0,
        command: parts.join(" "),
        child,
        running: true,
      };
      jobTable.set(job.id, job);
      child.unref();

      child.on("close", () => {
        job.running = false;
        if (typeof stdout === "number") {
          closeSync(stdout);
        }
        if (typeof stderr === "number") {
          closeSync(stderr);
        }
      });

      process.stdout.write(`[${job.id}] ${job.pid}\n`);
      rl.prompt();
      return;
    }

    child.on("close", () => {
      if (typeof stdout === "number") {
        closeSync(stdout);
      }
      if (typeof stderr === "number") {
        closeSync(stderr);
      }
      promptAfterJobs();
    });



  }
});



function parseCommand(line: string): { args: string[]; redirects: Redirect[] } {
  const args: string[] = [];
  const redirects: Redirect[] = [];
  let current = "";
  let inSingleQuotes = false;
  let inDoubleQuotes = false;
  let collectingRedirect: { fd: 1 | 2; append: boolean } | null = null;
  let skipRedirectWhitespace = false;

  const finishRedirect = () => {
    if (collectingRedirect && current.length > 0) {
      redirects.push({ ...collectingRedirect, file: current });
      current = "";
      collectingRedirect = null;
      skipRedirectWhitespace = true;
    }
  };

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (!collectingRedirect && !inSingleQuotes && !inDoubleQuotes) {
      const appendMatch = line.slice(i).match(/^(\d+)?>>/);
      if (appendMatch) {
        const fd = appendMatch[1] ? parseInt(appendMatch[1], 10) : 1;
        if (fd === 1 || fd === 2) {
          if (current.length > 0) {
            args.push(current);
            current = "";
          }
          collectingRedirect = { fd: fd as 1 | 2, append: true };
          skipRedirectWhitespace = true;
          i += appendMatch[0].length - 1;
          continue;
        }
      }

      const redirectMatch = line.slice(i).match(/^(\d+)?>/);
      if (redirectMatch) {
        const fd = redirectMatch[1] ? parseInt(redirectMatch[1], 10) : 1;
        if (fd === 1 || fd === 2) {
          if (current.length > 0) {
            args.push(current);
            current = "";
          }
          collectingRedirect = { fd: fd as 1 | 2, append: false };
          skipRedirectWhitespace = true;
          i += redirectMatch[0].length - 1;
          continue;
        }
      }
    }

    if (collectingRedirect && skipRedirectWhitespace && /\s/.test(char)) {
      continue;
    }
    skipRedirectWhitespace = false;

    if (collectingRedirect && !inSingleQuotes && !inDoubleQuotes && /\s/.test(char)) {
      finishRedirect();
      continue;
    }

    if (!inSingleQuotes && !inDoubleQuotes && char === "\\") {
      if (i + 1 < line.length) {
        current += line[i + 1];
        i++;
      } else {
        current += char;
      }
      continue;
    }

    if (inDoubleQuotes && char === "\\") {
      if (i + 1 < line.length) {
        const next = line[i + 1];
        if (next === '"' || next === "\\" || next === "$" || next === "`") {
          current += next;
          i++;
        } else if (next === "\n") {
          i++;
        } else {
          current += char;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" && !inDoubleQuotes) {
      inSingleQuotes = !inSingleQuotes;
      continue;
    }

    if (char === '"' && !inSingleQuotes) {
      inDoubleQuotes = !inDoubleQuotes;
      continue;
    }

    if (char === "$" && !inSingleQuotes) {
      const expanded = expandVariable(line, i);
      if (expanded) {
        current += expanded.value;
        i = expanded.endIndex;
        continue;
      }
    }

    if (!collectingRedirect && !inSingleQuotes && !inDoubleQuotes && /\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (collectingRedirect) {
    finishRedirect();
  } else if (current.length > 0) {
    args.push(current);
  }

  return { args, redirects };
}

function expandVariable(
  line: string,
  dollarIndex: number,
): { value: string; endIndex: number } | null {
  const rest = line.slice(dollarIndex + 1);

  if (rest.startsWith("{")) {
    const closeIndex = rest.indexOf("}");
    if (closeIndex === -1) return null;
    const name = rest.slice(1, closeIndex);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
    return {
      value: lookupVariable(name),
      endIndex: dollarIndex + 1 + closeIndex + 1 - 1,
    };
  }

  const nameMatch = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
  if (!nameMatch) return null;
  return {
    value: lookupVariable(nameMatch[0]),
    endIndex: dollarIndex + nameMatch[0].length,
  };
}

function lookupVariable(name: string): string {
  return shellVariables.get(name) ?? process.env[name] ?? "";
}

function writeOutput(
  stdout: string | null,
  stderr: string | null,
  redirects: Redirect[],
) {
  const stdoutRedirect = redirects.find((redirect) => redirect.fd === 1);
  const stderrRedirect = redirects.find((redirect) => redirect.fd === 2);

  if (stdoutRedirect) {
    writeToRedirect(stdoutRedirect.file, stdout ?? "", stdoutRedirect.append);
  } else if (stdout !== null) {
    process.stdout.write(stdout);
  }

  if (stderrRedirect) {
    writeToRedirect(stderrRedirect.file, stderr ?? "", stderrRedirect.append);
  } else if (stderr !== null) {
    process.stderr.write(stderr);
  }
}

function writeToRedirect(file: string, content: string, append: boolean) {
  if (append) {
    appendFileSync(file, content);
  } else {
    writeFileSync(file, content);
  }
}

function expandTilde(target: string): string {
  const home = process.env.HOME;
  if (!home) return target;

  if (target === "~") {
    return home;
  }
  if (target.startsWith("~/")) {
    return path.join(home, target.slice(2));
  }
  return target;
}

function isDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function parsePartialPath(partial: string): {
  dir: string;
  basePrefix: string;
  partialDir: string;
} {
  const slashIndex = partial.lastIndexOf("/");
  if (slashIndex === -1) {
    return { dir: process.cwd(), basePrefix: partial, partialDir: "" };
  }

  const dirPart = partial.slice(0, slashIndex);
  return {
    dir: path.resolve(process.cwd(), dirPart),
    basePrefix: partial.slice(slashIndex + 1),
    partialDir: `${dirPart}/`,
  };
}

function isDirectoryPath(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function findPathHits(partial: string, directoriesOnly: boolean): PathHit[] {
  const { dir, basePrefix, partialDir } = parsePartialPath(partial);

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const hits: PathHit[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(basePrefix)) {
      continue;
    }

    const entryPath = path.join(dir, entry);
    try {
      const entryStat = statSync(entryPath);
      if (directoriesOnly && !entryStat.isDirectory()) {
        continue;
      }
      hits.push({
        suffix: `${partialDir}${entry}`,
        entryName: entry,
        parentDir: dir,
      });
    } catch {
    }
  }

  return hits.sort((a, b) => a.suffix.localeCompare(b.suffix));
}

function handleCompleteBuiltin(args: string[], redirects: Redirect[]): void {
  if (args.length === 0) {
    const lines = [...completionSpecs.keys()]
      .sort()
      .map((cmd) => `complete -C '${completionSpecs.get(cmd)}' ${cmd}`)
      .join("\n");
    writeOutput(lines.length > 0 ? lines + "\n" : null, null, redirects);
    return;
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-C" && i + 2 < args.length) {
      completionSpecs.set(args[i + 2], args[i + 1]);
      return;
    }
    if (args[i] === "-r" && i + 1 < args.length) {
      completionSpecs.delete(args[i + 1]);
      return;
    }
    if (args[i] === "-p" && i + 1 < args.length) {
      const cmd = args[i + 1];
      const completerPath = completionSpecs.get(cmd);
      if (completerPath) {
        writeOutput(`complete -C '${completerPath}' ${cmd}\n`, null, redirects);
      } else {
        writeOutput(
          null,
          `complete: ${cmd}: no completion specification\n`,
          redirects,
        );
      }
      return;
    }
  }
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

function findExecutableCompletions(partial: string): string[] {
  const pathEnv = process.env.PATH;
  if (!pathEnv) return [];

  const matches = new Set<string>();
  for (const dir of pathEnv.split(path.delimiter)) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.startsWith(partial)) continue;

      const fullPath = path.join(dir, entry);
      try {
        accessSync(fullPath, constants.X_OK);
        matches.add(entry);
      } catch {
      }
    }
  }

  return [...matches];
}

function findExecutableInPath(command: string): string | null {
  const pathEnv = process.env.PATH;
  if (!pathEnv) return null;
  const directories = pathEnv.split(path.delimiter);
  for (const dir of directories) {
    const fullPath = path.join(dir, command);
    try {
      accessSync(fullPath, constants.X_OK);
      return fullPath;
    } catch {
    }
  }
  return null;
}