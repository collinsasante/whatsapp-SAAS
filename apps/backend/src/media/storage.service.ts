import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as Minio from 'minio';
import { Readable } from 'stream';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: 'local' | 'minio' | 's3';
  private minioClient?: Minio.Client;
  private s3Client?: S3Client;
  private readonly bucket: string;
  private readonly uploadPath: string;
  private readonly publicUrl: string;
  private readonly s3Region: string;

  constructor(private configService: ConfigService) {
    this.driver = (configService.get<string>('app.storageDriver', 'local') as 'local' | 'minio' | 's3');
    this.bucket = configService.get<string>('app.minio.bucket', 'whatsapp-platform');
    this.uploadPath = configService.get<string>('app.localUploadPath', './uploads');
    this.publicUrl = configService.get<string>('app.publicUrl', 'http://localhost:3001');
    this.s3Region = configService.get<string>('app.s3.region', 'us-east-1');

    if (this.driver === 'minio') {
      this.minioClient = new Minio.Client({
        endPoint: configService.get<string>('app.minio.endpoint', 'localhost'),
        port: configService.get<number>('app.minio.port', 9000),
        useSSL: configService.get<boolean>('app.minio.useSSL', false),
        accessKey: configService.get<string>('app.minio.accessKey', ''),
        secretKey: configService.get<string>('app.minio.secretKey', ''),
      });
      this.initMinio().catch((e) => this.logger.error('MinIO init failed', e));
    } else if (this.driver === 's3') {
      this.bucket = configService.get<string>('app.s3.bucket', '');
      this.s3Client = new S3Client({
        region: this.s3Region,
        credentials: {
          accessKeyId: configService.get<string>('app.s3.accessKeyId', ''),
          secretAccessKey: configService.get<string>('app.s3.secretAccessKey', ''),
        },
      });
      this.logger.log(`S3 storage initialised (bucket: ${this.bucket}, region: ${this.s3Region})`);
    } else {
      this.initLocal();
    }
  }

  private initLocal() {
    if (!fs.existsSync(this.uploadPath)) {
      fs.mkdirSync(this.uploadPath, { recursive: true });
    }
  }

  private async initMinio() {
    if (!this.minioClient) return;
    const exists = await this.minioClient.bucketExists(this.bucket);
    if (!exists) {
      await this.minioClient.makeBucket(this.bucket, 'us-east-1');
      this.logger.log(`Created MinIO bucket: ${this.bucket}`);
    }
  }

  async upload(file: Express.Multer.File, tenantId: string): Promise<{ fileKey: string; fileUrl: string }> {
    const ext = path.extname(file.originalname);
    const fileKey = `${tenantId}/${uuidv4()}${ext}`;

    if (this.driver === 's3' && this.s3Client) {
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: fileKey,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'public-read',
      }));
      const fileUrl = `https://${this.bucket}.s3.${this.s3Region}.amazonaws.com/${fileKey}`;
      return { fileKey, fileUrl };
    } else if (this.driver === 'minio' && this.minioClient) {
      await this.minioClient.putObject(this.bucket, fileKey, file.buffer, file.size, {
        'Content-Type': file.mimetype,
      });
      const fileUrl = `${this.publicUrl}/api/v1/media/serve/${fileKey.replace(/\//g, '~')}`;
      return { fileKey, fileUrl };
    } else {
      const filePath = path.join(this.uploadPath, fileKey);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, file.buffer);
      const fileUrl = `${this.publicUrl}/api/v1/media/serve/${fileKey.replace(/\//g, '~')}`;
      return { fileKey, fileUrl };
    }
  }

  async delete(fileKey: string): Promise<void> {
    if (this.driver === 's3' && this.s3Client) {
      await this.s3Client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: fileKey }));
    } else if (this.driver === 'minio' && this.minioClient) {
      await this.minioClient.removeObject(this.bucket, fileKey);
    } else {
      const filePath = path.join(this.uploadPath, fileKey);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }

  async getStream(fileKey: string): Promise<NodeJS.ReadableStream | null> {
    if (this.driver === 's3' && this.s3Client) {
      const response = await this.s3Client.send(new GetObjectCommand({ Bucket: this.bucket, Key: fileKey }));
      return response.Body as Readable;
    } else if (this.driver === 'minio' && this.minioClient) {
      return this.minioClient.getObject(this.bucket, fileKey);
    } else {
      const filePath = path.join(this.uploadPath, fileKey);
      if (!fs.existsSync(filePath)) return null;
      return fs.createReadStream(filePath);
    }
  }
}
