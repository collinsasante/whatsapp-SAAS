import { Global, Module } from '@nestjs/common';
import { CredentialsEncryptionService } from './credentials-encryption.service';

@Global()
@Module({
  providers: [CredentialsEncryptionService],
  exports: [CredentialsEncryptionService],
})
export class CredentialsEncryptionModule {}
