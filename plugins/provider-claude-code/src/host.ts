import os from "node:os";
import {
  claudeExecutionEnv,
  resolveClaudeExecution,
} from "./execution-context.js";
import {
  experimental_defineHostEntry,
  experimental_nativeRootsHostContract,
} from "@get-bb/plugin-sdk/host";
import { resolveClaudeNativeRoots } from "./native-roots.js";

export { experimental_providerBridge } from "./bridge/bridge.js";

export default experimental_defineHostEntry({
  contract: experimental_nativeRootsHostContract,
  handlers: {
    resolveNativeRoots: (input) =>
      resolveClaudeNativeRoots({
        cwd: input.cwd,
        homeDir: os.homedir(),
        env: claudeExecutionEnv(
          resolveClaudeExecution(input.experimental_providerOptions),
          process.env,
        ),
      }),
  },
});
