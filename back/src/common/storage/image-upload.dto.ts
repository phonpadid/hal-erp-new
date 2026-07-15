/** Allowed profile-image types + size cap (kept in sync with the client-side guard). */
export const PROFILE_IMAGE_MIME_ALLOWLIST = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const PROFILE_IMAGE_MAX_SIZE_KB = 5 * 1024; // 5 MB
