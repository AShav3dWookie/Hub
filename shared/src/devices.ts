/**
 * Device tokens let something other than a signed-in browser use the API — the Android
 * companion app now. A token is shown exactly once, when it is created; afterwards the server
 * only knows its hash, so a lost token is revoked and replaced, never recovered.
 */

export const DEVICE_NAME_MAX_LENGTH = 60;

/**
 * What a token may do. `device` is the companion app: voice, its lists, Undo — create only.
 * `logs` reads the hub's logs (`GET /api/device/logs`, `npm run hub:logs`) and nothing else.
 * Neither can do the other's job.
 */
export const DEVICE_TOKEN_SCOPES = ["device", "logs"] as const;
export type DeviceTokenScope = (typeof DEVICE_TOKEN_SCOPES)[number];

export interface DeviceTokenDTO {
  id: number;
  name: string;
  scope: DeviceTokenScope;
  createdAt: string;
  /** Null until the device first uses it. */
  lastUsedAt: string | null;
}

/** The create response — the only time `token` is ever sent. */
export interface CreatedDeviceTokenDTO extends DeviceTokenDTO {
  token: string;
}

export interface CreateDeviceTokenRequest {
  name: string;
  /** Defaults to `device`. */
  scope?: DeviceTokenScope;
}
