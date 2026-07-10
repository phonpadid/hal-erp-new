import { api } from './client';
import type { ChangePasswordInput } from '@erp/shared';

/** The signed-in user's own profile (identity + optional linked employee + active-company access). */
export interface OwnProfile {
  username: string;
  email: string;
  emailVerifiedAt: string | null;
  status: string;
  employee: { fullName: string; position: string | null; departmentName: string } | null;
  // Role(s) held and resolved permission grants for the active company.
  roles: string[];
  permissions: { code: string; scope: string }[];
  // Short-lived URL for the user's 1:1 profile image, or null when none is set.
  profileImageUrl: string | null;
}

/** Own-account reads/writes — the server resolves the user from the JWT (no id in the path). */
export const profileApi = {
  get: () => api.get<OwnProfile>('/auth/profile').then((r) => r.data),
  changePassword: (payload: ChangePasswordInput) =>
    api.post('/auth/change-password', payload).then((r) => r.data),
};

/** Allowed signature image types + size cap — mirror the server DTO so the two never drift. */
export const SIGNATURE_ACCEPT = ['image/png', 'image/jpeg'] as const;
export const SIGNATURE_MAX_KB = 1024;

/** The signed-in user's current signature (or an empty state). */
export interface OwnSignature {
  hasSignature: boolean;
  signature: { id: string; mimeType: string | null; uploadedAt: string | null; url: string } | null;
}

/** Own-signature reads/writes — self-scoped (the server resolves the user from the JWT). */
export const signatureApi = {
  get: () => api.get<OwnSignature>('/auth/signature').then((r) => r.data),
  presignUpload: (body: { fileName: string; contentType: string }) =>
    api
      .post<{ uploadUrl: string; key: string }>('/auth/signature/presign-upload', body)
      .then((r) => r.data),
  register: (meta: { filePath: string; mimeType: string; fileSizeKb?: number }) =>
    api.post<OwnSignature>('/auth/signature', meta).then((r) => r.data),
};

/** Generic direct-to-bucket upload: presign a PUT URL, upload the bytes, PUT to storage. */
async function putToBucket(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: file.type ? { 'Content-Type': file.type } : undefined,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

/**
 * Upload the signed-in user's 1:1 profile image: presign → PUT bytes → register the object as
 * the current profile image. Returns the fresh view URL.
 */
export async function uploadUserProfileImage(file: File): Promise<string> {
  const { data: presign } = await api.post<{ uploadUrl: string; key: string }>('/auth/profile-image/presign-upload', {
    fileName: file.name,
    contentType: file.type,
  });
  await putToBucket(presign.uploadUrl, file);
  const { data } = await api.post<{ profileImageUrl: string }>('/auth/profile-image', {
    filePath: presign.key,
    mimeType: file.type,
    fileSizeKb: Math.max(1, Math.round(file.size / 1024)),
  });
  return data.profileImageUrl;
}

/** base64-encode an ArrayBuffer in chunks (avoids call-stack limits on larger buffers). */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Decode a base64 string into a PNG Blob. */
function pngFromBase64(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

/**
 * Remove the signature image's background via the server (remove.bg key stays server-side).
 * Returns a transparent PNG blob.
 */
export async function removeSignatureBackground(blob: Blob): Promise<Blob> {
  const imageBase64 = toBase64(await blob.arrayBuffer());
  const { data } = await api.post<{ imageBase64: string }>('/auth/signature/remove-bg', {
    imageBase64,
    mimeType: blob.type || 'image/png',
  });
  return pngFromBase64(data.imageBase64);
}

/**
 * Full signature upload: presign a PUT URL, upload the bytes straight to the bucket, then
 * register the object as the user's new current signature. Returns the updated signature.
 */
export async function uploadSignature(file: File): Promise<OwnSignature> {
  const { uploadUrl, key } = await signatureApi.presignUpload({ fileName: file.name, contentType: file.type });
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: file.type ? { 'Content-Type': file.type } : undefined,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return signatureApi.register({
    filePath: key,
    mimeType: file.type,
    fileSizeKb: Math.max(1, Math.round(file.size / 1024)),
  });
}
