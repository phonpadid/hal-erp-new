import { IsDateString, IsString, MaxLength } from 'class-validator';

export class CreateHolidayDto {
  @IsDateString()
  holidayDate!: string;

  @IsString()
  @MaxLength(255)
  name!: string;
}
