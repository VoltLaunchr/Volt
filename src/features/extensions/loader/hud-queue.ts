/**
 * HUD message queue — bridges WorkerPlugin.executeActions → useResultActions.
 *
 * When an extension calls VoltAPI.showHUD(), the hud action is processed in
 * executeActions (which runs inside WorkerPlugin.execute()). The main-thread
 * caller (handleLaunch) then reads this queue AFTER execute() resolves to
 * decide whether to delay window hiding, giving the user time to see the HUD.
 */

let _pendingHud: string | null = null;

export function setPendingHud(message: string): void {
  _pendingHud = message;
}

export function consumePendingHud(): string | null {
  const msg = _pendingHud;
  _pendingHud = null;
  return msg;
}
