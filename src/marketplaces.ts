/** Country keys and marketplace base URLs (aligned with go-also-cloud-wrapper). */
export const MARKETPLACES = {
  Austria: 'https://marketplace.also.at',
  Switzerland: 'https://marketplace.also.ch',
  Germany: 'https://marketplace.also.de',
  Denmark: 'https://marketplace.also.dk',
  Estonia: 'https://marketplace.also.ee',
  Finland: 'https://marketplace.also.fi',
  Lithuania: 'https://marketplace.also.lt',
  Netherlands: 'https://marketplace.also.nl',
  Norway: 'https://marketplace.also.no',
  Sweden: 'https://marketplace.also.se',
  Slovenia: 'https://marketplace.also.si',
  France: 'https://marketplace.alsofrance.fr',
  Latvia: 'https://marketplace.alsolatvia.lv',
  Poland: 'https://marketplace.alsopolska.pl',
  Debug: 'https://marketplacetest.ccpaas.net',
} as const;

export type MarketplaceKey = keyof typeof MARKETPLACES;

export function resolveMarketplace(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, '');
  }
  const key = Object.keys(MARKETPLACES).find(
    (k) => k.toLowerCase() === trimmed.toLowerCase(),
  ) as MarketplaceKey | undefined;
  if (!key) {
    throw new Error(
      `Unknown marketplace "${input}". Use a full URL or one of: ${Object.keys(MARKETPLACES).join(', ')}`,
    );
  }
  return MARKETPLACES[key];
}
