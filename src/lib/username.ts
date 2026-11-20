/** Shared username rules for the login form, the admin form and the API. */
export const normalizeUsername = (value: string) => value.normalize("NFC").trim();

export function usernameError(username: string): string | null {
  if (username.length < 2 || username.length > 40) return "اسم المستخدم من ٢ إلى ٤٠ حرفًا.";
  if (/[\s@]/.test(username)) return "اسم المستخدم بدون مسافات وبدون @.";
  return null;
}
