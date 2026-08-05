import { Client } from "minio";
import dotenv from "dotenv";

dotenv.config();

export const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT || "localhost",
  port: parseInt(process.env.MINIO_PORT || "9000", 10),
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});

export const BUCKET = process.env.MINIO_BUCKET || "candleapp-media";

export async function ensureBucketExists() {
  const exists = await minioClient.bucketExists(BUCKET).catch(() => false);
  if (!exists) {
    await minioClient.makeBucket(BUCKET);
    console.log(`Created MinIO bucket: ${BUCKET}`);
  }
}
