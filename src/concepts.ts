import type { Category } from './core';
// Short object concepts, not new model endpoints or a promise of segmentation quality.
export const conceptCategories = {
  shirt: 'top', 'T-shirt': 'top', top: 'top', trousers: 'bottom', jeans: 'bottom',
  skirt: 'bottom', dress: 'dress', shoes: 'shoes', jacket: 'layer', blazer: 'layer', coat: 'layer',
  bag: 'accessory', ring: 'accessory', bracelet: 'accessory', sunglasses: 'accessory',
  watch: 'accessory', necklace: 'accessory', earrings: 'accessory',
} as const satisfies Record<string, Category>;
export type Concept = keyof typeof conceptCategories;
export const isConcept = (value: unknown): value is Concept => typeof value === 'string' && Object.hasOwn(conceptCategories, value);
