// Each pattern matches a banned slug in a case-insensitive way.
// Slug should be normalized (trimmed, lowercased) before testing.
export const bannedPatterns: RegExp[] = [
  // domain verification / well-known files — these could be used to
  // spoof ownership verification or intercept ACME challenges
  /^\.?well-known/i,
  /^acme-challenge/i,
  /^apple-app-site-association$/i,
  /^assetlinks\.json$/i,
  /^google[a-z0-9]*\.html$/i,
  /^google-verification/i,
  /^bing-verification/i,
  /^facebook-domain-verification/i,
  /^atlassian-domain-verification/i,
  /^keybase\.txt$/i,
  /^pgp-key\.txt$/i,
  /^openpgpkey/i,
  /^robots\.txt$/i,
  /^sitemap\.xml$/i,
  /^favicon(\.ico)?$/i,
  /^security\.txt$/i,
  /^ads\.txt$/i,
  /^humans\.txt$/i,
  /^manifest\.json$/i,
  // even if these are made as notes, the native endpoint handler will take precedence and route to something like /api, but this is to prevent any issues just in case
  /^api(\/.*)?$/i,
  /^admin(\/.*)?$/i,
  /^static(\/.*)?$/i,
  /^assets(\/.*)?$/i,
  /^public(\/.*)?$/i,
  /^raw(\/.*)?$/i,
  /^health$/i,
  /^status$/i,
  /^_next(\/.*)?$/i,
  /^\.env$/i,
  /^config$/i,

  // structural: reject any slug containing a slash or leading dot outright,
  // since legitimate note IDs shouldn't need them
  /^\./,
  /\//,
];

export function isBannedSlug(slug: string): boolean {
  const normalized = slug.trim().toLowerCase();
  return bannedPatterns.some((pattern) => pattern.test(normalized));
}
