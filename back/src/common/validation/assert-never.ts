/**
 * Compile-time exhaustiveness: call this in a `default:` branch and the build fails if a union
 * member has no case. The runtime throw is the fallback for a value that reached the switch anyway
 * — an untyped caller, or a string that came off the wire past its validator.
 *
 * Written for `act()`, where the append-only `approval_log` row is inserted before the action is
 * interpreted: an action with no branch used to be recorded and then ignored, which is a lie in the
 * one table the rest of the system treats as evidence. Refusing loudly is the only safe end to that
 * switch.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}
