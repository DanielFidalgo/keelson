const ALLOWED_URL_PROTOCOLS: readonly string[] = ['http:', 'https:'];

export function requiredTextProblems(requiredTexts: Readonly<Record<string, string>>): string[] {
  return Object.entries(requiredTexts)
    .filter(([, value]) => value.trim() === '')
    .map(([field]) => `${field} must not be empty`);
}

export function urlProblems(url: string): string[] {
  const protocol = URL.canParse(url) ? new URL(url).protocol : null;
  if (protocol !== null && ALLOWED_URL_PROTOCOLS.includes(protocol)) return [];
  return ['url must be an absolute http or https URL'];
}
