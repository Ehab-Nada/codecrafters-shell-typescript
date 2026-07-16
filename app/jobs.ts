import { readFileSync } from "fs";
import { spawnSync } from "child_process";
import { jobTable } from "./state.ts";
import type { Job } from "./types.ts";

export function allocateJobId(): number {
  if (jobTable.size === 0) return 1;
  return Math.max(...jobTable.keys()) + 1;
}

export function jobMarker(id: number): string {
  const ids = [...jobTable.keys()].sort((a, b) => b - a);
  if (ids[0] === id) return "+";
  if (ids[1] === id) return "-";
  return " ";
}

export function formatJobLine(job: Job): string {
  const status = job.running ? "Running" : "Done";
  const suffix = job.running ? " &" : "";
  return `[${job.id}]${jobMarker(job.id)}  ${status.padEnd(24)}${job.command}${suffix}\n`;
}

function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;

  // Linux: zombies still accept kill(0); treat state Z as not alive.
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
    const closeParen = stat.indexOf(")");
    if (closeParen !== -1) {
      const state = stat[closeParen + 2];
      if (state === "Z") return false;
      return true;
    }
  } catch {
    // /proc unavailable (e.g. macOS) - fall through
  }

  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }

  // macOS / fallback: detect zombies via ps
  const result = spawnSync("ps", ["-o", "state=", "-p", String(pid)], {
    encoding: "utf-8",
  });
  const state = (result.stdout ?? "").trim();
  if (result.status === 0 && state.startsWith("Z")) return false;
  return true;
}

export function syncJobStatuses(): void {
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

export function reapFinishedJobs(): void {
  syncJobStatuses();
  const finished = [...jobTable.values()].filter((job) => !job.running);
  for (const job of finished) {
    process.stdout.write(formatJobLine(job));
  }
  for (const job of finished) {
    jobTable.delete(job.id);
  }
}
