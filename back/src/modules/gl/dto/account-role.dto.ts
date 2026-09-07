import { IsUUID } from 'class-validator';

/**
 * Which account a role should point at.
 *
 * The ROLE travels in the path, not here: it names the thing being set, and the service validates it
 * against the roles the system actually resolves rather than a list repeated in a DTO — a list
 * repeated is a list that drifts.
 */
export class SetAccountRoleDto {
  @IsUUID()
  accountId!: string;
}
