import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Rejects requests without a valid JWT (401). */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
