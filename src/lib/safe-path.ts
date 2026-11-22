/** Same-site paths only: one leading slash, then plain path characters. Used for ?next= after sign-in. */
export const SAFE_NEXT_PATH = /^\/(?!\/)[A-Za-z0-9_\-/]*$/;

export function isSafeNextPath(value: string | null | undefined): value is string {
  return !!value && value.length <= 200 && SAFE_NEXT_PATH.test(value);
}
