import { provision, type Sandbox } from './provision';

/**
 * The sandbox is provisioned once per worker process and shared by every spec file that runs in
 * it. Provisioning is idempotent, so a second worker (or a second run) reuses what is already
 * there rather than building a rival sandbox.
 */
let pending: Promise<Sandbox> | undefined;

export function getSandbox(): Promise<Sandbox> {
  if (!pending) pending = provision();
  return pending;
}
