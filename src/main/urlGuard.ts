// Pure URL check for the navigation guard (no Electron imports).
/** True only when `url` parses and has exactly the same origin as `base`. Any parse error denies. */
export function isAllowedUrl(url: string, base: string): boolean {
  try {
    const u = new URL(url);
    return u.origin !== 'null' && u.origin === new URL(base).origin;
  } catch {
    return false;
  }
}
