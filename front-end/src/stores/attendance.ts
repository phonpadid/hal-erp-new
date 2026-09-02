import { defineStore } from 'pinia';
import { attendanceSelfApi, correctionSelfApi, leaveSelfApi } from '../api/attendance';
import type {
  AttendanceDayRow,
  AttendanceEventRow,
  LeavePreview,
  MyDaysFilters,
} from '../api/attendance';
import { documentsApi } from '../api/documents';
import { useGeolocation } from '../composables/useGeolocation';
import type { GeolocationStatus } from '../composables/useGeolocation';
import { messageOf } from '../utils/apiError';
import type { LeaveRequestCreateInput, TimeCorrectionCreateInput } from '@erp/shared';

/**
 * Self-service attendance.
 *
 * Nothing here names an employee. Every endpoint behind it resolves the caller from their own
 * account, which is what lets the punch screen run on `ATTEND_PUNCH_SELF` alone and why the store
 * has no notion of "whose" attendance it holds.
 *
 * Write actions refresh what they invalidated and return a boolean; the view decides whether to
 * toast. That division matters more here than elsewhere — a punch is a button somebody presses
 * twice when they are unsure it worked, and the screen must show the first press landing.
 */

/** A leave or correction request is three calls; when one fails the store says which. */
export type RequestStep = 'document' | 'detail' | 'submit';

interface AttendanceState {
  todayEvents: AttendanceEventRow[];
  myDays: AttendanceDayRow[];
  total: number;
  page: number;
  limit: number;
  filters: MyDaysFilters;
  /** The location verdict of the last LANDED punch, so the screen can say which of the four
   * outcomes happened. Empty while none has landed — every message it maps to also asserts the
   * punch was recorded, so a verdict left standing over a failed punch states something false. */
  locationStatus: GeolocationStatus | '';
  leavePreview: LeavePreview | null;
  correctablePunches: AttendanceEventRow[];
  loading: boolean;
  punching: boolean;
  error: string;
  /** Which step of a three-call request failed, so the message can name it. */
  failedStep: RequestStep | '';
}

export const useAttendanceStore = defineStore('attendance', {
  state: (): AttendanceState => ({
    todayEvents: [],
    myDays: [],
    total: 0,
    page: 1,
    limit: 20,
    filters: {},
    locationStatus: '',
    leavePreview: null,
    correctablePunches: [],
    loading: false,
    punching: false,
    error: '',
    failedStep: '',
  }),

  getters: {
    /**
     * Which way the employee is currently facing, from the last punch of the day. Derived rather
     * than stored: the ledger is the only thing that knows, and a cached flag would be a second
     * answer able to disagree with it.
     */
    isCheckedIn(state): boolean {
      const last = state.todayEvents[state.todayEvents.length - 1];
      return last?.direction === 'IN';
    },
    hasPunchedToday(state): boolean {
      return state.todayEvents.length > 0;
    },
  },

  actions: {
    async loadToday(date?: string) {
      this.loading = true;
      this.error = '';
      try {
        this.todayEvents = await attendanceSelfApi.myEvents(date);
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async loadMyDays(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await attendanceSelfApi.myDays(page ?? this.page, limit ?? this.limit, this.filters);
        this.total = res.total;
        this.page = res.page;
        this.limit = res.limit;
        this.myDays = res.items;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    setFilters(filters: MyDaysFilters) {
      this.filters = filters;
      return this.loadMyDays(1);
    },

    /**
     * Punch, attaching the location when there is one.
     *
     * The location is read first and never blocks: a denial, a timeout, or a browser without the
     * API all still punch, because losing an attendance record to a permission prompt is worse than
     * recording one without coordinates. The verdict is kept so the screen can say which happened.
     *
     * The verdict is published only once the punch has actually landed, and cleared when it has
     * not. Every message it maps to reads "...your punch was recorded without it" — a sentence
     * that is a lie next to a request the server refused, and the screen showed exactly that
     * when an account with no employee record pressed the button: a 400 in the toast, and
     * underneath it a line saying the punch had been recorded.
     *
     * Refreshes today's punches itself — the store owns the reload.
     */
    async punch(direction: 'IN' | 'OUT'): Promise<boolean> {
      this.punching = true;
      this.error = '';
      this.locationStatus = '';
      try {
        const reading = await useGeolocation().read();
        const body = {
          source: 'WEB' as const,
          ...(reading.latitude && reading.longitude
            ? { latitude: reading.latitude, longitude: reading.longitude }
            : {}),
        };
        if (direction === 'IN') await attendanceSelfApi.checkIn(body);
        else await attendanceSelfApi.checkOut(body);
        this.locationStatus = reading.status;
        await this.loadToday();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      } finally {
        this.punching = false;
      }
    },

    /** What a candidate range would charge. Optional context, so a failure is swallowed. */
    async previewLeave(params: { fromDate: string; toDate: string; fromHalf?: string; toHalf?: string }) {
      if (!params.fromDate || !params.toDate) {
        this.leavePreview = null;
        return;
      }
      try {
        this.leavePreview = await leaveSelfApi.previewOwn(params);
      } catch {
        // A preview nobody can compute is not an error worth interrupting the form for; the server
        // recounts at submit anyway, and that is the count that binds.
        this.leavePreview = null;
      }
    },

    /**
     * Raise leave: create the document, attach the detail, submit. One action to the requester,
     * three calls underneath, and the step that failed is recorded so the message can name it —
     * "we created your document but could not submit it" is actionable; "request failed" is not.
     */
    async requestLeave(
      documentTypeId: string,
      detail: Omit<LeaveRequestCreateInput, 'documentId'>,
    ): Promise<boolean> {
      this.error = '';
      this.failedStep = '';
      let documentId = '';
      try {
        this.failedStep = 'document';
        const doc = await documentsApi.create({ documentTypeId });
        documentId = doc.id;

        this.failedStep = 'detail';
        await leaveSelfApi.create({ ...detail, documentId });

        this.failedStep = 'submit';
        // Leave carries `derives_quantity`, so the generic submit endpoint refuses it — the days
        // are counted from the shift and the holiday calendar, never stated by the requester.
        await leaveSelfApi.submit(documentId);

        this.failedStep = '';
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },

    /** The punches a correction could name, for the caller's own shift day. */
    async loadCorrectablePunches(shiftDate: string) {
      this.error = '';
      try {
        this.correctablePunches = shiftDate ? await correctionSelfApi.myCorrectable(shiftDate) : [];
      } catch (e) {
        this.error = messageOf(e);
        this.correctablePunches = [];
      }
    },

    /**
     * Raise a correction. Same three steps as leave, and the detail carries no employee: whose
     * attendance it is about comes from the document, so there is no field here to point elsewhere.
     */
    async requestCorrection(
      documentTypeId: string,
      detail: Omit<TimeCorrectionCreateInput, 'documentId'>,
    ): Promise<boolean> {
      this.error = '';
      this.failedStep = '';
      try {
        this.failedStep = 'document';
        const doc = await documentsApi.create({ documentTypeId });

        this.failedStep = 'detail';
        await correctionSelfApi.create({ ...detail, documentId: doc.id });

        this.failedStep = 'submit';
        // A correction carries no derived quantity, so the generic submit is exactly right for it.
        await documentsApi.submit(doc.id);

        this.failedStep = '';
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },
  },
});
