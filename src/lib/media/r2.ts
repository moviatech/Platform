import "server-only";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const accountId = process.env.R2_ACCOUNT_ID ?? "";
const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? "";
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? "";
const bucket = process.env.R2_BUCKET ?? "";

let client: S3Client | null = null;

export function r2Configured() {
  return Boolean(accountId && accessKeyId && secretAccessKey && bucket);
}

function r2() {
  client ??= new S3Client({ region: "auto", endpoint: `https://${accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey } });
  return client;
}

export function presignUpload(key: string, contentType: string, expiresIn = 900) {
  return getSignedUrl(r2(), new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn });
}

export function presignDownload(key: string, expiresIn = 600) {
  return getSignedUrl(r2(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

export async function deleteObject(key: string) {
  await r2().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
