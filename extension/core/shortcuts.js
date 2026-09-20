export async function getShortcut() {
  const commands = await chrome.commands.getAll();
  return commands.find((command) => command.name === "_execute_action")?.shortcut || "";
}

export function openShortcuts() {
  const browser = /Edg\//.test(navigator.userAgent) ? "edge" : "chrome";
  return chrome.tabs.create({ url: `${browser}://extensions/shortcuts` });
}
