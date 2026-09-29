import { randomUUID } from "node:crypto";

const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function privateObjectDirectory(): string {
  const directory = process.env.PRIVATE_OBJECT_DIR?.trim().replace(/^\/+|\/+$/g, "");
  if (!directory) throw new Error("PRIVATE_OBJECT_DIR is not configured");
  return directory;
}

function objectLocation(objectPath: string): { bucketName: string; objectName: string } {
  if (!objectPath.startsWith("/objects/payment-photos/") || objectPath.includes("..")) {
    throw new Error("Invalid private payment photo path");
  }
  const fullPath = `${privateObjectDirectory()}/${objectPath.slice("/objects/".length)}`;
  const [bucketName, ...objectParts] = fullPath.split("/");
  const objectName = objectParts.join("/");
  if (!bucketName || !objectName) throw new Error("Invalid private object directory");
  return { bucketName, objectName };
}

async function signObjectUrl(
  objectPath: string,
  method: "PUT" | "GET" | "HEAD",
  ttlSeconds: number,
): Promise<string> {
  const { bucketName, objectName } = objectLocation(objectPath);
  const response = await fetch(`${SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Object Storage could not sign a ${method} URL`);
  const result = (await response.json()) as { signed_url?: unknown };
  if (typeof result.signed_url !== "string") throw new Error("Object Storage returned an invalid signed URL");
  return result.signed_url;
}

export async function createPaymentPhotoUpload(
  customerId: number,
  employeeId: number,
): Promise<{ uploadURL: string; objectPath: string }> {
  const objectPath = `/objects/payment-photos/customers/${customerId}/employees/${employeeId}/${randomUUID()}`;
  return { uploadURL: await signObjectUrl(objectPath, "PUT", 15 * 60), objectPath };
}

export async function inspectPaymentPhoto(
  objectPath: string,
): Promise<{ size: number; contentType: string } | null> {
  const signedUrl = await signObjectUrl(objectPath, "HEAD", 60);
  const response = await fetch(signedUrl, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Object Storage returned ${response.status} while checking a payment photo`);
  const size = Number(response.headers.get("content-length"));
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PHOTO_BYTES || !ALLOWED_CONTENT_TYPES.has(contentType)) {
    return null;
  }
  return { size, contentType };
}

export async function fetchPaymentPhoto(objectPath: string): Promise<Response> {
  const signedUrl = await signObjectUrl(objectPath, "GET", 60);
  return fetch(signedUrl, { signal: AbortSignal.timeout(30_000) });
}

export const PAYMENT_PHOTO_CONTENT_TYPES = ALLOWED_CONTENT_TYPES;
export const PAYMENT_PHOTO_MAX_BYTES = MAX_PHOTO_BYTES;