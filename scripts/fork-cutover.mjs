import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function replacementDropIn({ dropIn, oldDirectory, target, release }) {
  const starts = dropIn
    .split("\n")
    .filter((line) => /^ExecStart=.+/.test(line));
  if (
    starts.length !== 1 ||
    !dropIn.includes(`WorkingDirectory=${oldDirectory}\n`)
  )
    throw new Error(
      "Expected one ExecStart and the actual WorkingDirectory in the selected drop-in",
    );
  const command = starts[0];
  const installed = command.startsWith(`ExecStart=${oldDirectory}/bin/bb-app `);
  if (installed !== release)
    throw new Error("Source and installed-release targets must not be mixed");
  if (!command.includes(oldDirectory))
    throw new Error(
      "ExecStart does not identify the old source or package directory",
    );
  return dropIn
    .replace(
      `WorkingDirectory=${oldDirectory}\n`,
      `WorkingDirectory=${target}\n`,
    )
    .replace(command, command.replace(oldDirectory, target));
}

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [configPath, targetArg, source] = process.argv.slice(2);
  if (!configPath || !targetArg || !/^[a-f0-9]{40}$/.test(source ?? ""))
    throw new Error(
      "Usage: node scripts/fork-cutover.mjs <config.json> <target-directory> <source-sha>",
    );
  const { service } = JSON.parse(readFileSync(configPath, "utf8"));
  for (const key of ["systemdUnit", "systemdDropInPath"])
    if (typeof service?.[key] !== "string" || /[\r\n]/.test(service[key]))
      throw new Error(`Invalid service.${key}`);
  for (const key of ["serverPort", "hostDaemonPort"])
    if (
      !Number.isInteger(service[key]) ||
      service[key] < 1 ||
      service[key] > 65535
    )
      throw new Error(`Invalid service.${key}`);
  const target = resolve(targetArg);
  const show = (property) =>
    execFileSync(
      "systemctl",
      ["show", service.systemdUnit, "-p", property, "--value"],
      { encoding: "utf8" },
    ).trim();
  const oldDirectory = show("WorkingDirectory");
  if (!oldDirectory || /\s/.test(oldDirectory + target))
    throw new Error(
      "Expected nonempty unquoted source/package paths without whitespace",
    );
  const dropIn = readFileSync(service.systemdDropInPath, "utf8");
  const release = (() => {
    try {
      return JSON.parse(readFileSync(`${target}/release.json`, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  })();
  if (release && !/^[a-f0-9]{40}$/.test(release.source ?? ""))
    throw new Error("Invalid Release source manifest");
  const actualSource =
    release?.source ??
    execFileSync("git", ["-C", target, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  if (actualSource !== source)
    throw new Error("Target source SHA does not match the verified aggregate");
  const replacement = replacementDropIn({
    dropIn,
    oldDirectory,
    target,
    release: Boolean(release),
  });
  const command = dropIn
    .split("\n")
    .find((line) => /^ExecStart=.+/.test(line))
    .slice("ExecStart=".length);
  if (!show("ExecStart").includes(`argv[]=${command} ;`))
    throw new Error(
      "Selected drop-in is not the installed ExecStart; inspect the winning unit configuration",
    );
  const unit = quote(service.systemdUnit);
  const path = quote(service.systemdDropInPath);
  process.stdout.write(
    `External Agent only. Back up data after stopping the unit. This command prints a plan and does not apply it.\nExpected source: ${source}\nNew drop-in:\n${replacement}\nApply after backup:\nprintf %s ${quote(replacement)} | sudo tee ${path} >/dev/null\nsudo systemctl daemon-reload\nsudo systemctl start ${unit}\nsystemctl show ${unit} -p ExecStart -p WorkingDirectory -p ActiveState -p NRestarts\ncurl -fsS http://127.0.0.1:${service.serverPort}/health\ncurl -fsS http://127.0.0.1:${service.hostDaemonPort}/health\ncurl -fsS http://127.0.0.1:${service.serverPort}/api/v1/system/version\nRollback after stopping the new unit:\nprintf %s ${quote(dropIn)} | sudo tee ${path} >/dev/null\nsudo systemctl daemon-reload\nsudo systemctl start ${unit}\n`,
  );
}
