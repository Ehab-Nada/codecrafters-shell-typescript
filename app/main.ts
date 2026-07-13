import { createInterface } from "readline";
import { accessSync, appendFileSync, closeSync, constants, openSync, readdirSync, statSync, writeFileSync } from "fs";
import path from "path";
import { spawn } from "child_process";


const tabCompletableCommands = ["echo", "exit"];

let lastTabPartial = "";
let tabPressCount = 0;

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
  completer: (line: string): [string[], string] => {
    const partial = line.split(" ")[0] ?? "";
    if (line.includes(" ") && partial !== "") {
      lastTabPartial = "";
      tabPressCount = 0;
      process.stdout.write("\x07");
      return [[], line];
    }

    const builtinHits = tabCompletableCommands.filter((cmd) => cmd.startsWith(partial));
    const executableHits = findExecutableCompletions(partial);
    const hits = [...new Set([...builtinHits, ...executableHits])].sort();

    if (hits.length === 1) {
      lastTabPartial = "";
      tabPressCount = 0;
      return [[`${hits[0]} `], line];
    }

    if (hits.length === 0) {
      lastTabPartial = "";
      tabPressCount = 0;
      process.stdout.write("\x07");
      return [[], line];
    }

    if (lastTabPartial !== partial) {
      lastTabPartial = partial;
      tabPressCount = 0;
    }
    tabPressCount++;

    if (tabPressCount === 1) {
      process.stdout.write("\x07");
      return [[], line];
    }

    process.stdout.write(`\n${hits.join("  ")}\n`);
    rl.prompt(true);
    lastTabPartial = "";
    tabPressCount = 0;
    return [[], line];
  },
});

const builtInCommands = ["echo", "exit", "type", "pwd", "cd"];

type Redirect = {
  fd: 1 | 2;
  file: string;
  append: boolean;
};

rl.prompt();
rl.on("line", (line) => {
  lastTabPartial = "";
  tabPressCount = 0;
  const { args: parts, redirects } = parseCommand(line);
  const command = parts[0];
  const arg = parts[1];

  if (command == "") {
    rl.prompt();
    return;
  } else if (command == "exit") {
    rl.close();
    return;
  } else if (command == "echo") {
    writeOutput(parts.slice(1).join(" ") + "\n", null, redirects);
    rl.prompt();
    return;
  } else if (command == "type") {
    if (!arg) {
      rl.prompt();
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
    rl.prompt();
  } else if (command == "pwd"){
    writeOutput(process.cwd() + "\n", null, redirects);
    rl.prompt();
    return;
  } else if (command == "cd") {
    const target = expandTilde(arg ?? process.env.HOME ?? "");

    if (!target || !isDirectory(target)) {
      writeOutput(null, `cd: ${arg}: No such file or directory\n`, redirects);
      rl.prompt();
      return;
    }

    process.chdir(target);
    rl.prompt();
    return;
  }
  else {

    const executablePath = findExecutableInPath(command);

    if(!executablePath){
      writeOutput(null, `${command}: command not found\n`, redirects);
      rl.prompt();
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
      stdio: ["inherit", stdout, stderr],
    });

    child.on("close", () => {
      if (typeof stdout === "number") {
        closeSync(stdout);
      }
      if (typeof stderr === "number") {
        closeSync(stderr);
      }
      rl.prompt();
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