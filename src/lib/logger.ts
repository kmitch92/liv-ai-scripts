import ora, { type Ora } from "ora";
import chalk from "chalk";

let spinner: Ora | null = null;

export function startStep(name: string): void {
  spinner?.stop();
  spinner = ora(name).start();
}

export function succeedStep(message?: string): void {
  spinner?.succeed(message);
  spinner = null;
}

export function failStep(message?: string): void {
  spinner?.fail(message);
  spinner = null;
}

export function info(message: string): void {
  spinner?.stop();
  console.log(chalk.blue("\u2139"), message);
  spinner?.start();
}

export function warn(message: string): void {
  spinner?.stop();
  console.log(chalk.yellow("\u26A0"), message);
  spinner?.start();
}

export function error(message: string): void {
  console.error(chalk.red("\u2716"), message);
}

export function success(message: string): void {
  console.log(chalk.green("\u2714"), message);
}
