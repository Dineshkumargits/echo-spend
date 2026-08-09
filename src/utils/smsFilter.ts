/**
 * Shared cheap pre-filter for the SMS inbox, used by both the foreground
 * SmartScan and the background scan so the two can never disagree about which
 * messages are even eligible for parsing.
 *
 * The OTP filter is *exclusionary* — anything it matches is dropped before any
 * parsing happens, and the scan then marks the body as processed, so a false
 * positive here loses a transaction permanently. It therefore matches on word
 * boundaries rather than raw substrings: plain `body.includes('otp')` also fires
 * on real merchant names that happen to contain the letters, most notably
 * "DotPe" (d-OTP-e), which silently dropped every DotPe transaction from every
 * scan. The bank keyword list stays a substring check — it only ever widens what
 * is considered, so a loose match there is harmless.
 */

const BANK_KEYWORDS = [
  'debited', 'credited', 'spent', 'received', 'transferred', 'withdrawn',
  'deposited', 'deposit', 'paid', 'payment', 'purchase', 'txn', 'upi', 'vpa',
  'neft', 'imps', 'rtgs', 'atm', 'pos', 'inr', 'rs.', 'rs ', '₹',
  'transaction', 'a/c', 'acct', 'account', 'bal', 'deducted', 'charged',
  'sent', 'amount', 'amt', 'dr', 'cr', 'card', 'salary', 'refund', 'cashback',
];

const OTP_KEYWORDS = ['otp', 'password', 'verification code', 'one time', 'one-time'];

/**
 * Collapse every run of non-alphanumerics to a single space and pad the ends, so
 * a keyword surrounded by spaces is necessarily a whole word. This deliberately
 * avoids lookbehind assertions, which Hermes does not support across all the
 * RN versions the app ships on. It also folds "one-time" onto "one time", so
 * both spellings are covered by one probe.
 */
const tokenize = (body: string) =>
  ` ${body.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

const OTP_TOKENS = [...new Set(OTP_KEYWORDS.map(k => ` ${k.replace(/[^a-z0-9]+/g, ' ')} `))];

/** True when the SMS is an OTP/verification message that must never be parsed. */
export const isOtpSms = (body: string): boolean => {
  const t = tokenize(body);
  return OTP_TOKENS.some(k => t.includes(k));
};

/** True when the SMS mentions anything financial at all. */
export const hasBankKeyword = (body: string): boolean => {
  const lower = body.toLowerCase();
  return BANK_KEYWORDS.some(k => lower.includes(k));
};

/**
 * The single gate both scans use. Due reminders, promos and balance alerts are
 * intentionally allowed through — classifying those is the model's job, and the
 * `isTransaction` gate handles them downstream.
 */
export const isScanCandidate = (body: string): boolean =>
  !isOtpSms(body) && hasBankKeyword(body);
