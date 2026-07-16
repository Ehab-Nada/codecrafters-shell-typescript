import type { Redirect } from "./types.ts";
import { lookupVariable } from "./variables.ts";

export function splitPipeline(line: string): string[] {
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

export function parseCommand(line: string): { args: string[]; redirects: Redirect[] } {
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
