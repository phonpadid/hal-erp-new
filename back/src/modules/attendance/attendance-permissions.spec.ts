import { describe, expect, it } from 'vitest';
import { PERMISSIONS_KEY } from '../../auth/require-permissions.decorator';
import { AttendanceCaptureController } from './attendance-capture.controller';
import { AttendanceDayController } from './attendance-day.controller';
import { LeaveRequestController } from './leave-request.controller';
import { OvertimeClaimController } from './overtime-claim.controller';
import { AttendancePeriodController } from './attendance-period.controller';
import { TimeCorrectionController } from './time-correction.controller';
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

  it('exposes exactly the codes this capability owns', () => {
    expect(Object.values(P).sort()).toEqual([
      'ATTEND_CORRECTION_MANAGE',
      'ATTEND_DAY_READ',
      'ATTEND_DAY_RECOMPUTE',
      'ATTEND_DAY_SELF',
      'ATTEND_PERIOD_CLOSE',
      'ATTEND_PERIOD_MANAGE',
      'ATTEND_PERIOD_READ',
      'ATTEND_PERIOD_REOPEN',
      'ATTEND_PUNCH_MANAGE',
      'ATTEND_PUNCH_READ',
      'ATTEND_PUNCH_SELF',
      'ATTEND_SHIFT_MANAGE',
      'ATTEND_SHIFT_READ',
      'LEAVE_MANAGE',
      'OT_CLAIM_MANAGE',
    ]);
  });
});

/**
 * Reading the projection and rebuilding it are different powers: a supervisor should see days
 * without being able to overwrite a month of computed history, so no read route may be satisfied
 * by the recompute code alone or vice versa.
 */
describe('AttendanceDayController permission grading', () => {
  const handlersByName = AttendanceDayController.prototype as unknown as Record<string, object>;
  const codesFor = (method: string): string[] | undefined =>
    Reflect.getMetadata(PERMISSIONS_KEY, handlersByName[method]);

  const RECOMPUTE = ['recompute', 'recomputeCompany'];
  const READ = ['list'];
  const SELF = ['listOwn'];

  it('accounts for every route, so a new one cannot slip in ungated', () => {
    const handlers = Object.getOwnPropertyNames(AttendanceDayController.prototype).filter(
      (n) => n !== 'constructor',
    );
    expect(handlers.sort()).toEqual([...RECOMPUTE, ...READ, ...SELF].sort());
    for (const method of handlers) {
      expect(codesFor(method), `${method} has no @RequirePermissions`).toBeTruthy();
    }
  });

  it('gates rebuilding on ATTEND_DAY_RECOMPUTE alone', () => {
    for (const method of RECOMPUTE) {
      expect(codesFor(method)).toEqual([P.ATTEND_DAY_RECOMPUTE]);
    }
  });

  it('gates reading on ATTEND_DAY_READ, never on the recompute code', () => {
    for (const method of READ) {
      expect(codesFor(method)).toEqual([P.ATTEND_DAY_READ]);
    }
  });

  /**
   * The gap this slice closed. Gating `days/me` on ATTEND_DAY_READ meant that letting somebody see
   * their own attendance let them see the whole company's — the capture controller below has drawn
   * exactly this line since its own slice, and the daily one had not.
   */
  it('gates the caller own days on ATTEND_DAY_SELF, not on the code that lists everyone', () => {
    for (const method of SELF) {
      expect(codesFor(method)).toEqual([P.ATTEND_DAY_SELF]);
    }
  });

  it('never satisfies a self route with the code that reads everyone', () => {
    for (const method of SELF) {
      expect(codesFor(method)).not.toContain(P.ATTEND_DAY_READ);
    }
  });

  it('never satisfies the general list with the self code alone', () => {
    for (const method of READ) {
      expect(codesFor(method)).not.toContain(P.ATTEND_DAY_SELF);
    }
  });
});

/**
 * Capture is graded rather than binary: punching as yourself, punching for others, and reading
 * other people's punches are three different powers. The self-service routes must never require
 * one of the stronger codes (that would lock employees out of their own attendance), and the
 * on-behalf routes must never be reachable on the self code alone.
 */
describe('AttendanceCaptureController permission grading', () => {
  const handlersByName = AttendanceCaptureController.prototype as unknown as Record<string, object>;
  const codesFor = (method: string): string[] | undefined =>
    Reflect.getMetadata(PERMISSIONS_KEY, handlersByName[method]);

  const SELF = ['checkIn', 'checkOut', 'listOwn'];
  const MANAGE = ['punchFor', 'bulkPunch'];
  const READ = ['list'];

  it('declares a permission code on every route', () => {
    const handlers = Object.getOwnPropertyNames(AttendanceCaptureController.prototype).filter(
      (n) => n !== 'constructor',
    );
    // Every handler is accounted for, so a new route cannot be added without landing in a bucket.
    expect(handlers.sort()).toEqual([...SELF, ...MANAGE, ...READ].sort());
    for (const method of handlers) {
      expect(codesFor(method), `${method} has no @RequirePermissions`).toBeTruthy();
    }
  });

  it('gates self-service on ATTEND_PUNCH_SELF alone', () => {
    for (const method of SELF) {
      expect(codesFor(method)).toEqual([P.ATTEND_PUNCH_SELF]);
    }
  });

  it('gates punching for others on ATTEND_PUNCH_MANAGE, never on the self code', () => {
    for (const method of MANAGE) {
      expect(codesFor(method)).toContain(P.ATTEND_PUNCH_MANAGE);
      expect(codesFor(method)).not.toContain(P.ATTEND_PUNCH_SELF);
    }
  });

  it('gates reading other people on ATTEND_PUNCH_READ, never on the self code', () => {
    for (const method of READ) {
      expect(codesFor(method)).toContain(P.ATTEND_PUNCH_READ);
      expect(codesFor(method)).not.toContain(P.ATTEND_PUNCH_SELF);
    }
  });
});

/**
 * Leave mixes three authorities on one controller: raising and submitting a leave IS a document
 * action, configuring what a leave TYPE means is administration, and the stale read reports on the
 * daily projection. Each route must carry the code for what it actually does — a leave-type write
 * gated by DOC_CREATE would let any requester rewrite the company's notice windows.
 */
describe('LeaveRequestController permission grading', () => {
  const handlersByName = LeaveRequestController.prototype as unknown as Record<string, object>;
  const codesFor = (method: string): string[] | undefined =>
    Reflect.getMetadata(PERMISSIONS_KEY, handlersByName[method]);

  const DOCUMENT_ACTIONS = ['create', 'preview', 'previewOwn', 'submit', 'forDocument'];
  const TYPE_ADMIN = ['upsertType', 'listTypes'];
  const PROJECTION_READ = ['staleDays'];

  it('accounts for every route, so a new one cannot slip in ungated', () => {
    const handlers = Object.getOwnPropertyNames(LeaveRequestController.prototype).filter(
      (n) => n !== 'constructor',
    );
    expect(handlers.sort()).toEqual([...DOCUMENT_ACTIONS, ...TYPE_ADMIN, ...PROJECTION_READ].sort());
    for (const method of handlers) {
      expect(codesFor(method), `${method} has no @RequirePermissions`).toBeTruthy();
    }
  });

  it('gates leave-type administration on LEAVE_MANAGE alone', () => {
    for (const method of TYPE_ADMIN) {
      expect(codesFor(method)).toEqual([P.LEAVE_MANAGE]);
    }
  });

  it('never lets a document-level code reach leave-type administration', () => {
    for (const method of TYPE_ADMIN) {
      expect(codesFor(method)).not.toContain('DOC_CREATE');
      expect(codesFor(method)).not.toContain('DOC_SUBMIT');
    }
  });

  it('gates submitting a leave on the document submit code', () => {
    expect(codesFor('submit')).toEqual(['DOC_SUBMIT']);
  });

  it('reports projection staleness under the projection read code', () => {
    expect(codesFor('staleDays')).toEqual([P.ATTEND_DAY_READ]);
  });

  it('gates both previews on the document creation code', () => {
    // Self-service preview is not a weaker power than the named one — it is the same act about a
    // subject the caller cannot choose. The narrowing lives in the route, not in a second code.
    expect(codesFor('preview')).toEqual(['DOC_CREATE']);
    expect(codesFor('previewOwn')).toEqual(['DOC_CREATE']);
  });
});

/**
 * Certifying overtime is a document action throughout — raising, previewing, submitting and
 * reading a claim are all things a requester does with a document. `OT_CLAIM_MANAGE` exists for
 * certifying on someone ELSE's behalf and for the ceiling, neither of which has a route yet; this
 * spec pins that so a future route cannot quietly reuse a document code for an admin power.
 */
describe('OvertimeClaimController permission grading', () => {
  const handlersByName = OvertimeClaimController.prototype as unknown as Record<string, object>;
  const codesFor = (method: string): string[] | undefined =>
    Reflect.getMetadata(PERMISSIONS_KEY, handlersByName[method]);

  const EXPECTED: Record<string, string> = {
    create: 'DOC_CREATE',
    preview: 'DOC_CREATE',
    submit: 'DOC_SUBMIT',
    forDocument: 'DOC_VIEW',
  };

  it('accounts for every route, so a new one cannot slip in ungated', () => {
    const handlers = Object.getOwnPropertyNames(OvertimeClaimController.prototype).filter(
      (n) => n !== 'constructor',
    );
    expect(handlers.sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const method of handlers) {
      expect(codesFor(method), `${method} has no @RequirePermissions`).toBeTruthy();
    }
  });

  it('gates each route on the code for what it actually does', () => {
    for (const [method, code] of Object.entries(EXPECTED)) {
      expect(codesFor(method)).toEqual([code]);
    }
  });

  it('never satisfies a claim route with the admin code alone', () => {
    for (const method of Object.keys(EXPECTED)) {
      expect(codesFor(method)).not.toContain(P.OT_CLAIM_MANAGE);
    }
  });
});

/**
 * A correction is a document until it is approved, so raising one is graded as a document action —
 * not as an attendance power. The attendance code appears only where the route touches attendance
 * policy: how far back a correction may reach. Reading someone's correctable punches is a punch
 * read, because that is exactly what it returns.
 */
describe('TimeCorrectionController permission grading', () => {
  const handlersByName = TimeCorrectionController.prototype as unknown as Record<string, object>;
  const codesFor = (method: string): string[] | undefined =>
    Reflect.getMetadata(PERMISSIONS_KEY, handlersByName[method]);

  const EXPECTED: Record<string, string> = {
    create: 'DOC_CREATE',
    correctable: P.ATTEND_PUNCH_READ,
    ownCorrectable: P.ATTEND_PUNCH_SELF,
    window: P.ATTEND_CORRECTION_MANAGE,
    setWindow: P.ATTEND_CORRECTION_MANAGE,
    forDocument: 'DOC_VIEW',
  };

  it('accounts for every route, so a new one cannot slip in ungated', () => {
    const handlers = Object.getOwnPropertyNames(TimeCorrectionController.prototype).filter(
      (n) => n !== 'constructor',
    );
    expect(handlers.sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const method of handlers) {
      expect(codesFor(method), `${method} has no @RequirePermissions`).toBeTruthy();
    }
  });

  it('gates each route on the code for what it actually does', () => {
    for (const [method, code] of Object.entries(EXPECTED)) {
      expect(codesFor(method)).toEqual([code]);
    }
  });

  it('does not let the correction admin code stand in for raising or reading a document', () => {
    for (const method of ['create', 'forDocument']) {
      expect(codesFor(method)).not.toContain(P.ATTEND_CORRECTION_MANAGE);
    }
  });
});

/**
 * Four codes for four different powers. The one that matters most is the last assertion: closing a
 * period is routine month-end work, and reopening reaches back into one somebody may already have
 * been paid against — so a role that closes every month must not thereby be able to reopen.
 */
describe('AttendancePeriodController permission grading', () => {
  const handlersByName = AttendancePeriodController.prototype as unknown as Record<string, object>;
  const codesFor = (method: string): string[] | undefined =>
    Reflect.getMetadata(PERMISSIONS_KEY, handlersByName[method]);

  const EXPECTED: Record<string, string> = {
    list: P.ATTEND_PERIOD_READ,
    closedEvents: P.ATTEND_PERIOD_READ,
    lines: P.ATTEND_PERIOD_READ,
    lineLeave: P.ATTEND_PERIOD_READ,
    log: P.ATTEND_PERIOD_READ,
    declare: P.ATTEND_PERIOD_MANAGE,
    update: P.ATTEND_PERIOD_MANAGE,
    close: P.ATTEND_PERIOD_CLOSE,
    reopen: P.ATTEND_PERIOD_REOPEN,
  };

  it('accounts for every route, so a new one cannot slip in ungated', () => {
    const handlers = Object.getOwnPropertyNames(AttendancePeriodController.prototype).filter(
      (n) => n !== 'constructor',
    );
    expect(handlers.sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const method of handlers) {
      expect(codesFor(method), `${method} has no @RequirePermissions`).toBeTruthy();
    }
  });

  it('gates each route on the code for what it actually does', () => {
    for (const [method, code] of Object.entries(EXPECTED)) {
      expect(codesFor(method)).toEqual([code]);
    }
  });

  it('never lets a read code reach a write route', () => {
    for (const method of ['declare', 'update', 'close', 'reopen']) {
      expect(codesFor(method)).not.toContain(P.ATTEND_PERIOD_READ);
    }
  });

  it('does not let closing stand in for reopening', () => {
    expect(codesFor('reopen')).not.toContain(P.ATTEND_PERIOD_CLOSE);
    expect(codesFor('close')).not.toContain(P.ATTEND_PERIOD_REOPEN);
  });
});
