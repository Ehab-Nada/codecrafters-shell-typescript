# Shell — by Ehab Nada

A POSIX-style shell built in **TypeScript** with **Bun**, as a solution to the
[CodeCrafters “Build Your Own Shell”](https://app.codecrafters.io/courses/shell/overview) challenge.

Type a command. Press Tab. Pipe it. Background it. Your terminal, your rules.

**Full concept guide** (what each stage means, where the code lives, and why):
[docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md)

```text
$ echo hello | wc
$ sleep 30 &
$ jobs
$ history
```

---

## Features

| Area | What it can do |
|------|----------------|
| **Builtins** | `echo`, `exit`, `type`, `pwd`, `cd`, `complete`, `jobs`, `history`, `declare` |
| **Parsing** | Quotes, backslash escapes, `>` / `>>` / `2>` redirects |
| **Completion** | Commands, files, directories, programmable `complete -C` |
| **Jobs** | Background `&`, job listing, Done notifications, recycled IDs |
| **Pipelines** | Multi-stage `\|`, including builtins in the pipe |
| **History** | Listing, limits, arrows, `-r` / `-w` / `-a`, `HISTFILE` |
| **Variables** | `declare`, `$VAR`, `${VAR}` expansion |

---

## Quick start

**Requirements:** [Bun](https://bun.sh) 1.3+

```sh
bun install
./your_program.sh
```

Or run the entry point directly:

```sh
bun run app/main.ts
```

Submit / verify against CodeCrafters:

```sh
codecrafters test
codecrafters submit
```

---

## Project layout

```text
app/
  main.ts        # REPL entry + command dispatch
  parser.ts      # Quotes, redirects, pipes, $VAR expansion
  executor.ts    # External commands, pipelines, background jobs
  builtins.ts    # Shell builtins (history, declare, complete, …)
  completion.ts  # Tab + programmable completion
  jobs.ts        # Job table, markers, reaping
  history.ts     # In-memory + file persistence
  variables.ts   # Shell variables
  runtime.ts     # Readline + prompt helpers
  io.ts          # Output / redirects
  fsUtils.ts     # PATH lookup, paths, tilde
  state.ts       # Shared registries
  types.ts       # Shared types
```

---

## Example session

```text
$ pwd
/Users/you/project

$ echo "hello world"
hello world

$ sleep 5 &
[1] 4242

$ jobs
[1]+  Running                 sleep 5 &

$ declare NAME=Ehab
$ echo Hello, $NAME
Hello, Ehab

$ history 3
    4  jobs
    5  declare NAME=Ehab
    6  history 3
```

---

## Built with

- [TypeScript](https://www.typescriptlang.org/)
- [Bun](https://bun.sh)
- [CodeCrafters Shell Challenge](https://app.codecrafters.io/courses/shell/overview)

---

## Author

**Ehab Nada**

Built while working through CodeCrafters — focused on real shell behavior:
parsing, processes, jobs, completion, and a clean module layout.

---

## License

This project is provided as a learning / portfolio solution for the CodeCrafters challenge.
Use and adapt freely for personal learning.
