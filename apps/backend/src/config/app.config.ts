import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env['PORT'] ?? '3001', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  jwtSecret: process.env['JWT_SECRET'] ?? 'changeme',
  jwtRefreshSecret: process.env['JWT_REFRESH_SECRET'] ?? 'changeme-refresh',
  jwtExpiresIn: process.env['JWT_EXPIRES_IN'] ?? '15m',
  jwtRefreshExpiresIn: process.env['JWT_REFRESH_EXPIRES_IN'] ?? '7d',
  frontendUrl: process.env['FRONTEND_URL'] ?? 'http://localhost:3000',
  realtimeUrl: process.env['REALTIME_URL'] ?? 'http://localhost:3002',
  storageDriver: process.env['STORAGE_DRIVER'] ?? 'local',
  localUploadPath: process.env['LOCAL_UPLOAD_PATH'] ?? './uploads',
  publicUrl: process.env['PUBLIC_URL'] ?? 'http://localhost:3001',
  minio: {
    endpoint: process.env['MINIO_ENDPOINT'] ?? 'localhost',
    port: parseInt(process.env['MINIO_PORT'] ?? '9000', 10),
    useSSL: process.env['MINIO_USE_SSL'] === 'true',
    accessKey: process.env['MINIO_ACCESS_KEY'] ?? 'minioadmin',
    secretKey: process.env['MINIO_SECRET_KEY'] ?? 'minioadmin',
    bucket: process.env['MINIO_BUCKET'] ?? 'whatsapp-platform',
  },
  s3: {
    accessKeyId: process.env['AWS_ACCESS_KEY_ID'] ?? '',
    secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] ?? '',
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    bucket: process.env['AWS_S3_BUCKET'] ?? '',
  },
}));
