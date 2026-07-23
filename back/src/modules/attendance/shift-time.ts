import { BadRequestException } from '@nestjs/common';
import { MINUTES_PER_DAY } from './attendance.entities';

/**
 * The wire speaks "HH:MM"; storage counts minutes from local midnight. Converting at the
 * boundary keeps the API and the admin UI readable while the database keeps a representation
 * that needs no branch to compute a duration and cannot contradict itself (see design decision
 * 1 — a stored `crosses_midnight` flag can disagree with the times it describes).
 */

/** `"HH:MM"` with hours 00-47, so a night shift's end can be written as the next day's clock. */
export const TIME_PATTERN = /^([0-3][0-9]|4[0-7]):[0-5][0-9]$/;

/** `"08:00"` → 480. Hours above 23 express a time on the following calendar day. */
export function timeToMinutes(time: string): number {
  if (!TIME_PATTERN.test(time)) {
    throw new BadRequestException(`Invalid time '${time}': expected HH:MM`);
  }
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** 480 → `"08:00"`; 1800 → `"30:00"`, i.e. 06:00 the next day. */
export function minutesToTime(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Convert an end time that reads as earlier than the start into its next-day form: a shift
 * entered as 22:00-06:00 becomes 1320-1800. Without this the caller would have to write "30:00"
 * to describe a night shift, which nobody does.
 */
export function normalizeEndMinute(startMinute: number, endMinute: number): number {
  return endMinute <= startMinute ? endMinute + MINUTES_PER_DAY : endMinute;
}
