import type { ApiErrorBody, SessionUser } from '../types';

export class ApiError extends Error {
  status: number;
  code: string | undefined;
  body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody = {}) {
    super(body.message || body.error || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error;
    this.body = body;
  }
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/([$?*|{}\\^])/g, '\\$1')}=([^;]*)`)
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers || {});

  if (!headers.has('Content-Type') && init.body != null) {
    headers.set('Content-Type', 'application/json');
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrf = getCookie('csrf');
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }

  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers
  });

  if (response.status === 204) {
    return null as T;
  }

  const text = await response.text();
  const body = text ? (JSON.parse(text) as ApiErrorBody | T) : null;

  if (!response.ok) {
    throw new ApiError(response.status, (body as ApiErrorBody | null) || {});
  }

  return body as T;
}

export async function loginRequest(username: string, password: string): Promise<void> {
  await apiFetch<{ ok: true }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
}

export async function logoutRequest(): Promise<void> {
  await apiFetch<{ ok: true }>('/api/auth/logout', {
    method: 'POST'
  });
}

export async function fetchSessionUser(): Promise<SessionUser | null> {
  try {
    const data = await apiFetch<{ user: SessionUser }>('/api/auth/me');
    return data.user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}
