import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyService } from './api-key.service';
import { ApiKey } from './external-api.entities';
import { JwtOrApiKeyGuard } from '../../auth/jwt-or-api-key.guard';
import { ApiKeyDenyGuard } from '../../auth/api-key-deny.guard';

/**
 * External API keys (M2M). Global so any controller can apply JwtOrApiKeyGuard /
 * ApiKeyDenyGuard without importing this module. RbacModule provides
 * PermissionResolverService (live grant resolution); AuthModule provides the JWT
 * strategy the composed guard falls back to.
 */
@Global()
@Module({
  imports: [MikroOrmModule.forFeature([ApiKey]), AuthModule, RbacModule],
  controllers: [ApiKeyController],
  providers: [ApiKeyService, JwtOrApiKeyGuard, ApiKeyDenyGuard],
  exports: [ApiKeyService, JwtOrApiKeyGuard, ApiKeyDenyGuard],
})
export class ExternalApiModule {}
