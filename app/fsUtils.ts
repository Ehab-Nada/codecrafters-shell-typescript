import { accessSync, constants, readdirSync, statSync } from "fs";
import path from "path";
import type { PathHit } from "./types.ts";

export function expandTilde(target: string): string {
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

export function isDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

export function parsePartialPath(partial: string): {
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

export function findPathHits(partial: string, directoriesOnly: boolean): PathHit[] {
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

export function findExecutableCompletions(partial: string): string[] {
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

export function findExecutableInPath(command: string): string | null {
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
