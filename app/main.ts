import { createInterface } from "readline";
import { accessSync, constants } from "fs";
import path from "path";
import { spawn } from "child_process";


const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
});

const builtInCommands = ["echo", "exit", "type", "pwd"];

rl.prompt();
rl.on("line", (line) => {
  const parts = line.trim().split(/\s+/);
  const command = parts[0];
  const arg = parts[1];

  if (command == "") {
    rl.prompt();
    return;
  } else if (command == "exit") {
    rl.close();
    return;
  } else if (command == "echo") {
    console.log(parts.slice(1).join(" "));
    rl.prompt();
    return;
  } else if (command == "type") {
    if (!arg) {
      rl.prompt();
      return;
    }

    const found = builtInCommands.includes(arg);
    if (found) {
      console.log(`${arg} is a shell builtin`);
    } else {

      const executablePath = findExecutableInPath(arg);

      if(executablePath){
        console.log(`${arg} is ${executablePath}`);

      } else {
        console.log(`${arg}: not found`);
      }

    }
    rl.prompt();
  } else if (command == "pwd"){
    console.log(process.cwd());
    rl.prompt();
    return;
  } else {

    const executablePath = findExecutableInPath(command);

    if(!executablePath){
      console.error(`${command}: command not found`);
      rl.prompt();
      return;
    }


    const child = spawn(command, parts.slice(1),{
      stdio: "inherit",
    });

    child.on("close", () => {
      rl.prompt();
    });



  }
});



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