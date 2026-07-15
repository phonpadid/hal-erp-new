import { AsyncLocalStorage } from 'node:async_hooks';
import type { Grant } from '../../auth/jwt-payload.interface';

/** Per-request identity + active-company context derived from the JWT. */
export interface RequestContextStore {
  userId?: string;
  companyId?: string;
  departmentId?: string;
  grants: Grant[];
  /** Set when the request authenticated via an API key — the originating api_key.id. */
  apiKeyId?: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export const RequestContext = {
  run<T>(store: RequestContextStore, cb: () => T): T {
    return storage.run(store, cb);
  },
  get(): RequestContextStore | undefined {
    return storage.getStore();
  },
  userId(): string | undefined {
    return storage.getStore()?.userId;
  },
  companyId(): string | undefined {
    return storage.getStore()?.companyId;
  },
  departmentId(): string | undefined {
    return storage.getStore()?.departmentId;
  },
  grants(): Grant[] {
    return storage.getStore()?.grants ?? [];
  },
  /** The originating API key id when the request authenticated via a key, else undefined. */
  apiKeyId(): string | undefined {
    return storage.getStore()?.apiKeyId;
  },
  /** Permission codes only (back-compat helper for the guard / quick checks). */
  permissions(): string[] {
    return (storage.getStore()?.grants ?? []).map((g) => g.code);
  },
};
