// Pure validators for Saudi / GCC supplier data. No CAP dependencies, so they're trivially unit-testable.
// Rules and sources: RESEARCH.md §B2 (SAMA rulebook, ZATCA, SPL national address, IBAN registry).

const ARABIC_INDIC = /[٠-٩۰-۹]/g;

/** "٧٠١٢" → "7012"; also Persian digits. Applied to every numeric identifier before validation. */
export function normalizeDigits(value) {
  if (value == null) return value;
  return String(value).replace(ARABIC_INDIC, (d) => String((d.charCodeAt(0) & 0xf) % 10));
}

/** Strip spaces and dashes users paste from documents: "SA03 8000 0000-..." */
export function compact(value) {
  if (value == null) return value;
  return normalizeDigits(String(value)).replace(/[\s-]+/g, '').toUpperCase();
}

/** Unified national number: 10 digits starting with 7 (sole identifier since the 2025 Commercial Register Law). */
export const isUnifiedNo = (v) => /^7\d{9}$/.test(compact(v) || '');

/** Pre-2025 CR number: 10 digits. Accepted only as an optional "legacy" field. */
export const isLegacyCr = (v) => /^\d{10}$/.test(compact(v) || '');

/** KSA VAT number: 15 digits, first and last digit 3. ZATCA publishes no checksum, so this is format-only. */
export const isKsaVat = (v) => /^3\d{13}3$/.test(compact(v) || '');

/** UAE Tax Registration Number: 15 digits. */
export const isUaeTrn = (v) => /^\d{15}$/.test(compact(v) || '');

/** ISO 13616 mod-97 check, any country. */
export function isIban(v) {
  const iban = compact(v) || '';
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

/** Saudi IBAN: "SA" + 2 check digits + 2-char bank code + 18 alphanumerics = 24 chars, mod-97 valid. */
export const isSaudiIban = (v) => /^SA\d{4}[A-Z0-9]{18}$/.test(compact(v) || '') && isIban(v);

/** Bank code = IBAN characters 5–6 (e.g. "80" for Al Rajhi). */
export const bankCodeFromIban = (v) => (isSaudiIban(v) ? compact(v).slice(4, 6) : null);

/** "SA0380000000608010167519" → "SA03 8000 0000 6080 1016 7519" */
export const formatIban = (v) => (compact(v) || '').replace(/(.{4})/g, '$1 ').trim();

/** SWIFT/BIC: 8 or 11 chars. */
export const isSwift = (v) => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(compact(v) || '');

/** International phone number in E.164 form. */
export const isE164 = (v) => /^\+[1-9]\d{7,14}$/.test(compact(v) || '');

export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());

// Saudi National Address (SPL)
export const isBuildingNo = (v) => /^\d{4}$/.test(compact(v) || '');
export const isAdditionalNo = (v) => /^\d{4}$/.test(compact(v) || '');
export const isSaudiPostalCode = (v) => /^\d{5}$/.test(compact(v) || '');
export const isShortAddress = (v) => /^[A-Z]{4}\d{4}$/.test(compact(v) || '');

/** Soft check: the Arabic legal name should actually contain Arabic letters. */
export const hasArabicLetters = (v) => /[؀-ۿ]/.test(String(v || ''));

/**
 * Loose name match for "account holder must equal legal name":
 * case/space/punctuation-insensitive, ignores common company suffixes.
 */
export function namesMatch(a, b) {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/\b(co|company|est|establishment|llc|ltd|limited|inc|corp)\b\.?/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '');
  return !!a && !!b && norm(a) === norm(b);
}
