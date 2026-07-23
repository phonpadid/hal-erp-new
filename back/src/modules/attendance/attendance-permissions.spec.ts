import { describe, expect, it } from 'vitest';
import { PERMISSIONS_KEY } from '../../auth/require-permissions.decorator';
import { EmployeeShiftController, WorkShiftController } from './attendance-shift.controller';
import { AttendancePermissions as P } from './permissions';
import { WorkLocationController } from './work-location.controller';

/**
 * Every endpoint in this capability is gated by permission CODE, never a role name (invariant 5),
 * and writes need a strictly stronger code than reads. Checked as metadata rather than through
 * HTTP because the guard itself is covered by `permissions.guard.spec.ts` — what can regress here
 * is a handler being added without a decorator, which this catches by enumerating every route.
 */

type Ctor = { prototype: object };

/** Every route handler on a controller, i.e. its own prototype methods except the constructor. */
function handlers(controller: Ctor): string[] {
  return Object.getOwnPropertyNames(controller.prototype).filter((n) => n !== 'constructor');
}

function codesFor(controller: Ctor, method: string): string[] | undefined {
  return Reflect.getMetadata(PERMISSIONS_KEY, (controller.prototype as Record<string, object>)[method]);
}

const WRITES: Record<string, string[]> = {
  WorkShiftController: ['create', 'update', 'setDays', 'deactivate', 'remove'],
  EmployeeShiftController: ['assign', 'end', 'remove'],
  WorkLocationController: ['create', 'update', 'deactivate'],
};

const CONTROLLERS: Array<[string, Ctor]> = [
  ['WorkShiftController', WorkShiftController],
  ['EmployeeShiftController', EmployeeShiftController],
  ['WorkLocationController', WorkLocationController],
];

describe('attendance shift endpoints are permission-gated', () => {
  for (const [name, controller] of CONTROLLERS) {
    describe(name, () => {
      it('declares a permission code on every route, leaving none open', () => {
        for (const method of handlers(controller)) {
          expect(codesFor(controller, method), `${name}.${method} has no @RequirePermissions`).toBeTruthy();
        }
      });

      it('gates writes with ATTEND_SHIFT_MANAGE', () => {
        for (const method of WRITES[name]) {
          expect(codesFor(controller, method), `${name}.${method}`).toContain(P.ATTEND_SHIFT_MANAGE);
        }
      });

      it('gates reads with ATTEND_SHIFT_READ and never lets a read require only MANAGE', () => {
        const reads = handlers(controller).filter((m) => !WRITES[name].includes(m));
        for (const method of reads) {
          expect(codesFor(controller, method), `${name}.${method}`).toContain(P.ATTEND_SHIFT_READ);
        }
      });

      it('never grants a write route on the read code alone', () => {
        for (const method of WRITES[name]) {
          expect(codesFor(controller, method)).not.toContain(P.ATTEND_SHIFT_READ);
        }
      });
    });
  }

  it('exposes exactly the two codes this capability owns', () => {
    expect(Object.values(P).sort()).toEqual(['ATTEND_SHIFT_MANAGE', 'ATTEND_SHIFT_READ']);
  });
});
