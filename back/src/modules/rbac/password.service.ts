import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

/** One-way password hashing (rbac: Credential Verification). Never stores plaintext. */
@Injectable()
export class PasswordService {
  private readonly cost = 10;

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.cost);
  }

  verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
