export const TOGGLE_WORKSPACE_SWITCHER_EVENT = "termany:toggle-workspace-switcher";

/** Opens the switcher rendered by the currently active Pages/Agents sidebar. */
export function toggleWorkspaceSwitcher() {
  window.dispatchEvent(new Event(TOGGLE_WORKSPACE_SWITCHER_EVENT));
}
