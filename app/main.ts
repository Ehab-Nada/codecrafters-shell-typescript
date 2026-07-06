import { createInterface } from "readline";
import { accessSync, closeSync, constants, openSync, statSync, writeFileSync } from "fs";
import path from "path";
import { spawn } from "child_process";


const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
});

const builtInCommands = ["echo", "exit", "type", "pwd", "cd"];

rl.prompt();
rl.on("line", (line) => {
  const { args: parts, redirectOut } = parseCommand(line);
  const command = parts[0];
  const arg = parts[1];

  if (command == "") {
    rl.prompt();
    return;
  } else if (command == "exit") {
    rl.close();
    return;
  } else if (command == "echo") {
    writeStdout(parts.slice(1).join(" ") + "\n", redirectOut);
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

    writeStdout(output, redirectOut);
    rl.prompt();
  } else if (command == "pwd"){
    writeStdout(process.cwd() + "\n", redirectOut);
    rl.prompt();
    return;
  } else if (command == "cd") {
    const target = expandTilde(arg ?? process.env.HOME ?? "");

    if (!target || !isDirectory(target)) {
      console.error(`cd: ${arg}: No such file or directory`);
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
      console.error(`${command}: command not found`);
      rl.prompt();
      return;
    }


    const stdout = redirectOut ? openSync(redirectOut, "w") : "inherit";

    const child = spawn(command, parts.slice(1), {
      stdio: ["inherit", stdout, "inherit"],
    });

    child.on("close", () => {
      if (typeof stdout === "number") {
        closeSync(stdout);
      }
      rl.prompt();
    });



  }
});



function parseCommand(line: string): { args: string[]; redirectOut: string | null } {
  const args: string[] = [];
  let current = "";
  let redirectOut: string | null = null;
  let inSingleQuotes = false;
  let inDoubleQuotes = false;
  let collectingRedirect = false;
  let skipRedirectWhitespace = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (!collectingRedirect && !inSingleQuotes && !inDoubleQuotes) {
      const redirectMatch = line.slice(i).match(/^(\d+)?>/);
      if (redirectMatch) {
        const fd = redirectMatch[1] ? parseInt(redirectMatch[1], 10) : 1;
        if (fd === 1) {
          if (current.length > 0) {
            args.push(current);
            current = "";
          }
          collectingRedirect = true;
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
      if (current.length > 0) {
        redirectOut = current;
        break;
      }
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
    if (current.length > 0) {
      redirectOut = current;
    }
  } else if (current.length > 0) {
    args.push(current);
  }

  return { args, redirectOut };
}

function writeStdout(output: string, redirectOut: string | null) {
  if (redirectOut) {
    writeFileSync(redirectOut, output);
  } else {
    process.stdout.write(output);
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