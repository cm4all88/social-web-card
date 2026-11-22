export const MIN_PASSWORD = 8;

/** Why a new password can't be used, or null when it can. */
export function newPasswordError(next: string, current: string): string | null {
  if (next.length < MIN_PASSWORD)
    return `Your new password needs at least ${MIN_PASSWORD} characters.`;
  if (next === current) return "Choose a password that's different from your current one.";
  return null;
}
