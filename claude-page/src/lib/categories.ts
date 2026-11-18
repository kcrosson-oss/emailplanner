// Every email falls under one of these categories; the label is shown before its title.
export type Category = 'city_launch' | 'trades' | 'general' | 'services';

export const CATEGORIES: { id: Category; label: string; color: string; bg: string }[] = [
  { id: 'city_launch', label: 'City Launch', color: '#ffffff', bg: '#FF4801' },
  { id: 'trades', label: 'Trades', color: '#ffffff', bg: '#2463A6' },
  { id: 'general', label: 'General ResQ', color: '#ffffff', bg: '#5A6466' },
  { id: 'services', label: 'ResQ Services', color: '#ffffff', bg: '#2E7C8A' },
];

export const categoryOf = (id: string | undefined | null) => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[2];
export const isCategory = (v: unknown): v is Category => CATEGORIES.some((c) => c.id === v);

/** Best guess for a new email from its title (can be changed). */
export function guessCategory(title: string): Category {
  const t = title.toLowerCase();
  if (/\blaunch\b|systems check/.test(t)) return 'city_launch';
  if (/\btrades?\b/.test(t)) return 'trades';
  if (/resq services|why resq/.test(t)) return 'services';
  return 'general';
}
