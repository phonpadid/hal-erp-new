import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { UserSettingController } from './user-setting.controller';
import { UserSetting } from './user-setting.entities';
import { UserSettingService } from './user-setting.service';

@Module({
  imports: [MikroOrmModule.forFeature([UserSetting])],
  controllers: [UserSettingController],
  providers: [UserSettingService],
})
export class UserPreferencesModule {}
