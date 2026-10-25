import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export function canStopFromHost(tabs: readonly { dirty: boolean; saving: boolean; loading: boolean }[], busy: boolean): boolean {
  return !busy && !tabs.some(tab => tab.dirty || tab.saving || tab.loading);
}

export async function connectManagement(canStop: () => boolean): Promise<() => void> {
  const unlisten = await listen<string>("management-stop-check", event => {
    void invoke("management_stop_reply", { id: event.payload, allowed: canStop() });
  });
  try { await invoke("management_ready"); }
  catch (error) { unlisten(); throw error; }
  return unlisten;
}
