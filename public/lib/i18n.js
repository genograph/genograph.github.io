/** Choose the saved language when valid; otherwise follow the system locale. */
export function initialLanguage(storedLanguage, systemLanguage) {
  if (storedLanguage === 'tr' || storedLanguage === 'en') return storedLanguage;

  const primaryLanguage = String(systemLanguage || '')
    .trim()
    .toLowerCase()
    .split(/[-_]/, 1)[0];
  return primaryLanguage === 'tr' ? 'tr' : 'en';
}
