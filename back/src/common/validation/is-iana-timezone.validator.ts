import { isValidTimeZone } from '@erp/shared';
import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Validates an IANA time-zone name (Asia/Bangkok, Asia/Vientiane) for class-validator DTOs.
 *
 * Delegates to the shared predicate so this rule cannot drift from the Zod schema the Vue forms
 * use. That predicate asks the runtime's own tz database rather than checking a hardcoded list,
 * so it tracks whatever tzdata is installed.
 */
@ValidatorConstraint({ name: 'isIanaTimeZone', async: false })
export class IsIanaTimeZone implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isValidTimeZone(value);
  }

  defaultMessage(): string {
    return 'timezone must be a valid IANA time zone, e.g. Asia/Bangkok';
  }
}
