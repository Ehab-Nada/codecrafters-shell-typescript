import { createInterface } from "readline";
import { completeArgument, completeCommand, resetTabState } from "./completion.ts";
import { handleCompleteBuiltin, handleDeclareBuiltin, handleHistoryBuiltin } from "./builtins.ts";
import { expandTilde, findExecutableInPath, isDirectory } from "./fsUtils.ts";
import { initializeHistoryFromEnv, recordHistory, writeHistoryFile } from "./history.ts";
import { formatJobLine, syncJobStatuses } from "./jobs.ts";
import { parseCommand, splitPipeline } from "./parser.ts";
import { getRl, promptAfterJobs, setRl } from "./runtime.ts";
import { builtInCommands, jobTable } from "./state.ts";
import { runExternalCommand, runPipeline } from "./executor.ts";
import { writeOutput } from "./io.ts";

const rl = createInterface({
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
setRl(rl);

initializeHistoryFromEnv();

rl.prompt();
rl.on("line", (line) => {
  resetTabState();
  recordHistory(line);

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

  if (command === "") {
    promptAfterJobs();
    return;
  } else if (command === "exit") {
    if (process.env.HISTFILE) {
      writeHistoryFile(process.env.HISTFILE);
    }
    rl.close();
    return;
  } else if (command === "echo") {
    writeOutput(parts.slice(1).join(" ") + "\n", null, redirects);
    promptAfterJobs();
    return;
  } else if (command === "type") {
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
    return;
  } else if (command === "pwd"){
    writeOutput(process.cwd() + "\n", null, redirects);
    promptAfterJobs();
    return;
  } else if (command === "cd") {
    const target = expandTilde(arg ?? process.env.HOME ?? "");

    if (!target || !isDirectory(target)) {
      writeOutput(null, `cd: ${arg}: No such file or directory\n`, redirects);
      promptAfterJobs();
      return;
    }

    process.chdir(target);
    promptAfterJobs();
    return;
  } else if (command === "complete") {
    handleCompleteBuiltin(parts.slice(1), redirects);
    promptAfterJobs();
    return;
  } else if (command === "history") {
    handleHistoryBuiltin(parts.slice(1), redirects);
    promptAfterJobs();
    return;
  } else if (command === "declare") {
    handleDeclareBuiltin(parts.slice(1), redirects);
    promptAfterJobs();
    return;
  } else if (command === "jobs") {
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
    getRl().prompt();
    return;
  }

  runExternalCommand(parts, redirects, background);
});
