import { Module } from '@nestjs/common';
import { getEmbeddingService } from './embedding.service';

export const EMBEDDING_SERVICE = 'EMBEDDING_SERVICE';

@Module({
  providers: [{ provide: EMBEDDING_SERVICE, useFactory: getEmbeddingService }],
  exports: [EMBEDDING_SERVICE],
})
export class EmbeddingModule {}
