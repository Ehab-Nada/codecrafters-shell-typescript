import { completionSpecs, builtInCommands } from "./state.ts";
import { writeOutput } from "./io.ts";
import { appendHistoryFile, commandHistory, loadHistoryFile, writeHistoryFile } from "./history.ts";
import { findExecutableInPath } from "./fsUtils.ts";
import { shellVariables } from "./variables.ts";
import type { Redirect } from "./types.ts";

export function builtinOutput(parts: string[]): { stdout: string; stderr: string } | null {
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

export function handleCompleteBuiltin(args: string[], redirects: Redirect[]): void {
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

export function handleHistoryBuiltin(args: string[], redirects: Redirect[]): void {
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

export function handleDeclareBuiltin(args: string[], redirects: Redirect[]): void {
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
