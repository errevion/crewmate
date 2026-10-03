let pluginModule: any;
try {
  pluginModule = await import("@errevion/crewmate/plugin");
} catch {
  pluginModule = await import("../../dist/src/adapters/opencode/index.js");
}

export const crewmateOpenCodePlugin =
  pluginModule.crewmateOpenCodePlugin || pluginModule.default;
export const crewmatePlugin = crewmateOpenCodePlugin;
export default crewmateOpenCodePlugin;
