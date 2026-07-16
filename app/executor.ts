import { closeSync, openSync } from "fs";
import { spawn, type ChildProcess } from "child_process";
import { builtinOutput } from "./builtins.ts";
import { findExecutableInPath } from "./fsUtils.ts";
import { parseCommand } from "./parser.ts";
import { getRl, promptAfterJobs } from "./runtime.ts";
import { allocateJobId } from "./jobs.ts";
import { jobTable } from "./state.ts";
import type { Job, Redirect } from "./types.ts";

export type StdioSetting = "inherit" | "ignore" | "pipe" | number;

export function stdioFromRedirects(
  redirects: Redirect[],
  options: { background?: boolean; isLast?: boolean } = {},
): { stdin: StdioSetting; stdout: StdioSetting; stderr: StdioSetting } {
  const stdoutRedirect = redirects.find((redirect) => redirect.fd === 1);
  const stderrRedirect = redirects.find((redirect) => redirect.fd === 2);

  return {
    stdin: options.background ? "ignore" : "inherit",
    stdout: stdoutRedirect
      ? openSync(stdoutRedirect.file, stdoutRedirect.append ? "a" : "w")
      : options.isLast === false
        ? "pipe"
        : "inherit",
    stderr: stderrRedirect
      ? openSync(stderrRedirect.file, stderrRedirect.append ? "a" : "w")
      : "inherit",
  };
}

export function closeRedirects(stdout: StdioSetting, stderr: StdioSetting): void {
  if (typeof stdout === "number") {
    closeSync(stdout);
  }
  if (typeof stderr === "number") {
    closeSync(stderr);
  }
}

export function runExternalCommand(
  parts: string[],
  redirects: Redirect[],
  background: boolean,
): void {
  const command = parts[0];
  const executablePath = findExecutableInPath(command);

  if (!executablePath) {
    process.stderr.write(`${command}: command not found\n`);
    promptAfterJobs();
    return;
  }

  const { stdin, stdout, stderr } = stdioFromRedirects(redirects, { background });

  const child = spawn(command, parts.slice(1), {
    stdio: [stdin, stdout, stderr],
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

    child.on("exit", () => {
      job.running = false;
    });

    child.on("close", () => {
      job.running = false;
      closeRedirects(stdout, stderr);
    });

    process.stdout.write(`[${job.id}] ${job.pid}\n`);
    getRl().prompt();
    return;
  }

  child.on("close", () => {
    closeRedirects(stdout, stderr);
    promptAfterJobs();
  });
}

export function runPipeline(segments: string[]): void {
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

    const stdio = stdioFromRedirects(redirects, { isLast });
    const stdinSetting: "pipe" | "inherit" = prev !== null ? "pipe" : "inherit";

    const child: ChildProcess = spawn(command, parts.slice(1), {
      stdio: [stdinSetting, stdio.stdout, stdio.stderr],
    });
    children.push(child);

    child.on("close", () => {
      closeRedirects(stdio.stdout, stdio.stderr);
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
