import { request as pwRequest, type APIRequestContext } from '@playwright/test';

/**
 * Where the running API is. Derived exactly as `playwright.config.ts` derives it — `E2E_BASE_URL`,
 * else the `PORT` the config loaded out of `back/.env`, else 3000. This used to default to 5000 on
 * its own, so the config would wait for a server on one port while every flow signed in against
 * another: the whole suite failed with ECONNREFUSED unless `E2E_BASE_URL` happened to be exported.
 * One default, in agreement with the config, is the point.
 */
export const API_BASE =
  process.env.E2E_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
export const API_PREFIX = '/api-new';

/** What the server said, kept whole — a failing flow is only diagnosable with the body. */
export class ApiError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`${method} ${path} → ${status} ${JSON.stringify(body)}`);
    this.name = 'ApiError';
  }
}

/**
 * One authenticated caller. The e2e flows are written as "this person does this", so the token
 * belongs to the client rather than being threaded through every call.
 */
export class Api {
  private constructor(
    private readonly ctx: APIRequestContext,
    readonly token: string,
    readonly userId: string,
    readonly username: string,
  ) {}

  static async login(username: string, password: string): Promise<Api> {
    const ctx = await pwRequest.newContext({ baseURL: API_BASE });
    const res = await ctx.post(`${API_PREFIX}/auth/login`, {
      data: { username, password },
    });
    const body = await parse(res);
    if (!res.ok())
      throw new ApiError('POST', '/auth/login', res.status(), body);
    const b = body as {
      accessToken: string;
      user: { id: string; username: string };
    };
    return new Api(ctx, b.accessToken, b.user.id, b.user.username);
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  async get<T = any>(path: string): Promise<T> {
    const res = await this.ctx.get(API_PREFIX + path, {
      headers: this.headers(),
    });
    const body = await parse(res);
    if (!res.ok()) throw new ApiError('GET', path, res.status(), body);
    return body as T;
  }

  async post<T = any>(path: string, data?: unknown): Promise<T> {
    const res = await this.ctx.post(API_PREFIX + path, {
      headers: this.headers(),
      data: data ?? {},
    });
    const body = await parse(res);
    if (!res.ok()) throw new ApiError('POST', path, res.status(), body);
    return body as T;
  }

  async put<T = any>(path: string, data?: unknown): Promise<T> {
    const res = await this.ctx.put(API_PREFIX + path, {
      headers: this.headers(),
      data: data ?? {},
    });
    const body = await parse(res);
    if (!res.ok()) throw new ApiError('PUT', path, res.status(), body);
    return body as T;
  }

  async patch<T = any>(path: string, data?: unknown): Promise<T> {
    const res = await this.ctx.patch(API_PREFIX + path, {
      headers: this.headers(),
      data: data ?? {},
    });
    const body = await parse(res);
    if (!res.ok()) throw new ApiError('PATCH', path, res.status(), body);
    return body as T;
  }

  /** Multipart upload — the REC templates all carry a required `file` field. */
  async upload<T = any>(
    path: string,
    name: string,
    buf: Buffer,
    mimeType = 'image/png',
  ): Promise<T> {
    const res = await this.ctx.post(API_PREFIX + path, {
      headers: this.headers(),
      multipart: { file: { name, mimeType, buffer: buf } },
    });
    const body = await parse(res);
    if (!res.ok()) throw new ApiError('POST', path, res.status(), body);
    return body as T;
  }

  /** The raw result, for tests that assert on a refusal rather than on a value. */
  async attempt(
    method: 'get' | 'post' | 'put' | 'patch',
    path: string,
    data?: unknown,
  ): Promise<{ status: number; body: any }> {
    const res = await this.ctx[method](API_PREFIX + path, {
      headers: this.headers(),
      ...(method === 'get' ? {} : { data: data ?? {} }),
    });
    return { status: res.status(), body: await parse(res) };
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }
}

async function parse(res: { text(): Promise<string> }): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
