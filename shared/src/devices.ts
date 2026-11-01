/**
 * Device tokens let something other than a signed-in browser use the API — the Android
 * companion app now. A token is shown exactly once, when it is created; afterwards the server
 * only knows its hash, so a lost token is revoked and replaced, never recovered.
 */

export const DEVICE_NAME_MAX_LENGTH = 60;

export interface DeviceTokenDTO {
  id: number;
  name: string;
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
}
