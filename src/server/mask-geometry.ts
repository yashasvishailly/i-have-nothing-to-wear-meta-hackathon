// Numeric-only diagnostics. SDK boxes are half-open; wire x2/y2 are inclusive.
// No clamping, resizing, offset guessing or acceptance override occurs here.
export type GeometryIssue = 'non_integer' | 'invalid_source' | 'negative_origin' | 'outside_source' | 'empty_bounds' | 'invalid_mask_dimensions' | 'pixel_budget' | 'source_pixel_budget';
export interface MaskGeometryRow {
  index: number; sourceWidth: number | null; sourceHeight: number | null;
  left: number | null; top: number | null; right: number | null; bottom: number | null;
  maskWidth: number | null; maskHeight: number | null; cumulativePixels: number | null;
  sourceBoxWidth: number | null; sourceBoxHeight: number | null; cumulativeSourcePixels: number | null;
  mapping: 'identity' | 'native-grid-to-source-box';
  issues: GeometryIssue[];
}
const numeric = (v: number) => Number.isSafeInteger(v) ? v : null;
export function maskGeometry(index: number, width: number, height: number, bounds: { left: number; top: number; right: number; bottom: number }, mask: { width: number; height: number }, cumulativePixels: number, cumulativeSourcePixels=(bounds.right-bounds.left)*(bounds.bottom-bounds.top)): MaskGeometryRow {
  const { left, top, right, bottom } = bounds, issues: GeometryIssue[] = [];
  if (![left, top, right, bottom, mask.width, mask.height].every(Number.isSafeInteger)) issues.push('non_integer');
  if (![width, height].every(v => Number.isSafeInteger(v) && v > 0)||!Number.isSafeInteger(width*height)||width*height>24e6) issues.push('invalid_source');
  if (left < 0 || top < 0) issues.push('negative_origin');
  if (right > width || bottom > height) issues.push('outside_source');
  if (right <= left || bottom <= top) issues.push('empty_bounds');
  // Raster dimensions are independent of source-box dimensions. Validate both
  // grids, then explicitly project; never infer a particular provider max side.
  if (![mask.width,mask.height].every(v=>Number.isSafeInteger(v)&&v>0)||!Number.isSafeInteger(mask.width*mask.height)) issues.push('invalid_mask_dimensions');
  if (!Number.isSafeInteger(cumulativePixels) || cumulativePixels > 24e6) issues.push('pixel_budget');
  if (!Number.isSafeInteger(cumulativeSourcePixels)||cumulativeSourcePixels>24e6) issues.push('source_pixel_budget');
  return { index, sourceWidth: numeric(width), sourceHeight: numeric(height), left: numeric(left), top: numeric(top), right: numeric(right), bottom: numeric(bottom), maskWidth: numeric(mask.width), maskHeight: numeric(mask.height), cumulativePixels: numeric(cumulativePixels),sourceBoxWidth:numeric(right-left),sourceBoxHeight:numeric(bottom-top),cumulativeSourcePixels:numeric(cumulativeSourcePixels),mapping:mask.width===right-left&&mask.height===bottom-top?'identity':'native-grid-to-source-box', issues };
}
