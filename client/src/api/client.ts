import { markSignedOut } from "./session.js";

const BASE_URL = "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Routes where a 401 means "wrong password", not "your session is gone".
 *
 * `/auth/login` 401s on a bad password while already signed out, and `/auth/password` 401s when
 * the *current* password given is wrong — signing that user out would be both wrong and
 * baffling, since their session is perfectly good.
 */
const PASSWORD_ROUTES = ["/auth/login", "/auth/password"];

/**
 * Turn a response into its parsed body, or throw.
 *
 * A failure carries the server's own `{ error }` message where there is one, falling back to
 * the status text when the body is missing or is not JSON — an nginx error page, say. A 204 has
 * no body at all and resolves to undefined.
 *
 * Every 401 outside {@link PASSWORD_ROUTES} is taken as proof the session has gone, and recorded
 * so the app drops to the login screen. Doing it here rather than per caller is what makes it
 * complete: a photo upload, the gallery, or a notifications call failing is just as much a lost
 * session as a failed sync, and the cached auth status will not discover it on its own.
 */
async function handleResponse<T>(res: Response, path: string): Promise<T> {
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error ?? message;
    } catch {
      // No JSON body to take a message from; the status text stands.
    }
    if (res.status === 401 && !PASSWORD_ROUTES.some((p) => path.startsWith(p))) {
      await markSignedOut();
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  return handleResponse<T>(res, path);
}

/**
 * POST multipart/form-data (e.g. file uploads). Unlike request(), this omits the
 * Content-Type header so the browser sets its own multipart boundary.
 */
async function postForm<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  return handleResponse<T>(res, path);
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "DELETE", body: body ? JSON.stringify(body) : undefined }),
  postForm,
};
