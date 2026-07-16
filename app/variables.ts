export const shellVariables = new Map<string, string>();

export function lookupVariable(name: string): string {
  return shellVariables.get(name) ?? process.env[name] ?? "";
}
