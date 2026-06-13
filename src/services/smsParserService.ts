import {
  Transaction,
  Subscription,
  Goal,
  Loan,
  Account,
  Category,
  Budget,
  upsertMerchantMapping,
  isSmsAlreadyProcessed,
  getSubscriptions,
  getGoals,
  getLoans,
  getAccounts,
  getCategories,
  getTopMerchantMappings,
  getBudgets,
} from './database';
import { extractJSONObject } from '../utils/extractJSON';
import { notify } from '../utils/notify';
import { AIModelManager } from './aiModelManager';

/**
 * Normalize an SMS body for deduplication.
 * Strips leading/trailing whitespace, collapses internal whitespace runs to
 * a single space, and lowercases. This ensures that trivially different
 * versions of the same bank SMS (extra newline, trailing space, unicode
 * non-breaking space) hash to the same value.
 */
export function normalizeSmsBody(str: string): string {
  return str.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * FNV-1a 64-bit hash (emulated with two 32-bit halves) for SMS deduplication.
 * Input is normalized before hashing to prevent trivial whitespace differences
 * from producing different hashes.
 */
export function hashSms(str: string): string {
  const normalized = normalizeSmsBody(str);
  const FNV_PRIME = 0x01000193;
  let hHi = 0x811c9dc5 ^ 0xdeadbeef;
  let hLo = 0x811c9dc5;

  for (let i = 0; i < normalized.length; i++) {
    const c = normalized.charCodeAt(i);
    hLo ^= c;
    hLo = Math.imul(hLo, FNV_PRIME) >>> 0;
    hHi ^= (c << 4) ^ (c >> 4);
    hHi = Math.imul(hHi, FNV_PRIME) >>> 0;
  }

  return hLo.toString(16).padStart(8, '0') + hHi.toString(16).padStart(8, '0');
}

/** Normalize a merchant name */
function normalizeMerchant(raw: string): string {
  // If it's all caps and long, title-case it. Otherwise preserve casing.
  const clean = raw
    .replace(/\*[A-Z0-9]+/g, '')
    .replace(/\d{6,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (clean === clean.toUpperCase() && clean.length > 3) {
    return clean
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }
  return clean;
}

// ─── Local regex-based SMS parser (primary fast path) ─────────────────────────

// Pass-2 keyword fallback: allows up to 40 non-digit chars between keyword and amount
// so it handles "debited from A/c XXXX 500.00", "Dr INR 500", etc.
const AMOUNT_KEYWORD_RE = /(?:debited|credited|deducted|spent|paid|charged|withdrawn|sent|received|payment|purchase|transfer(?:red)?|txn|amount|amt|dr\b|cr\b)[^₹\d]{0,40}?(?:(?:inr|rs\.?|₹)\s*)?([\\d,]+(?:\.\d{1,2})?)/i;

// Pass-3: older SBI/bank "NNN Dr" / "NNN Cr" suffix format with no currency marker
const AMOUNT_DR_CR_SUFFIX_RE = /([\d,]+(?:\.\d{1,2})?)\s*\b(dr|cr)\b/i;

// Balance patterns — covers all major Indian bank SMS variants:
// "Avl Bal", "Avl. Bal.", "Avbl Bal", "Available Balance", "A/c Bal", "Bal:", etc.
// Captures both the balance amount and an optional trailing "Cr" or "Dr" suffix
const BALANCE_RE = /(?:avail(?:able)?\s*(?:bal(?:ance)?)?|avl\.?\s*bal\.?|avbl\.?\s*bal\.?|a\/c\s*bal\.?|bal(?:ance)?\s*(?:is|:)?|outstanding)\s*(?::?\s*)(?:inr|rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)(?:\s*\b(cr|dr)\b)?/i;

// "declined", "failed", etc. — these are NOT completed transactions
const DECLINED_RE = /\b(?:declined|failed|rejected|unsuccessful|not\s+processed|reversal|reversed|could\s+not\s+process)\b/i;

// Robust word-boundary-based pattern matching and scoring system for transaction type detection:
const DEBIT_SCORING_PATTERNS = [
  { re: /\bdebited\b/i, score: 5 },
  { re: /\bspent\b/i, score: 4 },
  { re: /\bcharged\b/i, score: 4 },
  { re: /\bwithdrawn\b/i, score: 4 },
  { re: /\bwithdrawal\b/i, score: 4 },
  { re: /\bsent\b/i, score: 4 },
  { re: /\bpaid\b/i, score: 3 },
  { re: /\bpayment\b/i, score: 3 },
  { re: /\bpurchase\b/i, score: 3 },
  { re: /\bused\b/i, score: 2 },
  { re: /\bdebit\b(?!\s+card)/i, score: 3 },
  { re: /\bdr\b/i, score: 2 },
];

const CREDIT_SCORING_PATTERNS = [
  { re: /\bcredited\b/i, score: 5 },
  { re: /\breceived\b/i, score: 4 },
  { re: /\bdeposited\b/i, score: 4 },
  { re: /\bdeposit\b/i, score: 4 },
  { re: /\brefunded\b/i, score: 4 },
  { re: /\brefund\b/i, score: 4 },
  { re: /\bcashback\b/i, score: 4 },
  { re: /\bsalary\b/i, score: 4 },
  { re: /\bstipend\b/i, score: 4 },
  { re: /\bincome\b/i, score: 4 },
  { re: /\bcredit\b(?!\s+(?:card|limit|score|line|control))/i, score: 3 },
  { re: /\bcr\b/i, score: 2 },
];

const TRANSFER_SCORING_PATTERNS = [
  { re: /\btransferred\b/i, score: 3 },
  { re: /\btransfer\b/i, score: 3 },
  { re: /\bneft\b/i, score: 3 },
  { re: /\bimps\b/i, score: 3 },
  { re: /\brtgs\b/i, score: 3 },
  { re: /\bown a\/c\b/i, score: 4 },
  { re: /\bself transfer\b/i, score: 4 },
];

// Ordered from most-specific to least-specific.
// "from MERCHANT" added for credit-style SMS ("received from Infosys").
// UPI VPA pattern anchored with word boundary to avoid matching email addresses.
const MERCHANT_PATTERNS = [
  /\bat\s+([A-Za-z][A-Za-z0-9 &'.\-]{2,30}?)(?:\s+on\b|\s+for\b|\s+ref|\s+txn|\s+upi|\s+at\b|[,.]|$)/i,
  /\bto\s+([A-Za-z][A-Za-z0-9 &'.\-]{2,30}?)(?:\s+on\b|\s+for\b|\s+ref|\s+txn|\s+upi|\s+at\b|[,.]|$)/i,
  /\bfrom\s+([A-Za-z][A-Za-z0-9 &'.\-]{2,30}?)(?:\s+on\b|\s+for\b|\s+ref|\s+txn|\s+upi|\s+at\b|[,.]|$)/i,
  /\bfor\s+([A-Za-z][A-Za-z0-9 &'.\-]{2,30}?)(?:\s+on\b|\s+ref|\s+txn|\s+upi|\s+at\b|[,.]|$)/i,
  /\b([A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z]{2,})\b/i,  // UPI VPA (e.g. merchant@okaxis)
];

// ISO first, then "DD-Mon-YY(YY)", then numeric with -, /, or . separators.
// All three are valid in Indian bank SMS ("15/01/24", "15-01-24", "15.01.24").
const DATE_PATTERNS: Array<{ re: RegExp; format: 'iso' | 'dmonY' | 'ddmmyy' }> = [
  { re: /(\d{4}-\d{2}-\d{2})/, format: 'iso' },
  { re: /(\d{1,2}[-\/\s][A-Za-z]{3}[-\/\s]\d{2,4})/, format: 'dmonY' },
  { re: /(\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{2,4})/, format: 'ddmmyy' },
];

// Time pattern: "14:30", "14:30:00", "2:30 PM"
const TIME_RE = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\b(?!\d)/i;

const CATEGORY_KEYWORDS: Array<{ keys: string[]; category: string }> = [
  { keys: ['swiggy', 'zomato', 'restaurant', 'cafe', 'food', 'eat', 'pizza', 'burger', 'kitchen', 'dhaba', 'hotel', 'barbeque', 'bakery', 'canteen'], category: 'Food & Dining' },
  { keys: ['uber', 'ola', 'rapido', 'metro', 'railway', 'irctc', 'petrol', 'fuel', 'parking', 'bus', 'cab', 'auto', 'makemytrip', 'goibibo', 'yatra', 'redbus', 'flight', 'airline', 'indigo', 'airasia', 'spicejet'], category: 'Transport' },
  { keys: ['amazon', 'flipkart', 'myntra', 'mall', 'mart', 'shop', 'store', 'market', 'supermarket', 'bigbasket', 'blinkit', 'zepto', 'nykaa', 'meesho', 'snapdeal', 'jiomart'], category: 'Shopping' },
  { keys: ['grocer', 'grocery', 'vegetables', 'fruits', 'dmart', 'reliance fresh', 'more supermarket', 'spencer'], category: 'Groceries' },
  { keys: ['electricity', 'water', 'gas', 'bill', 'recharge', 'mobile', 'airtel', 'jio', 'bsnl', 'vi ', 'broadband', 'wifi', 'postpaid', 'prepaid', 'dth', 'tata sky', 'dish tv', 'sun direct'], category: 'Bills & Utilities' },
  { keys: ['hospital', 'pharmacy', 'medical', 'doctor', 'clinic', 'health', 'apollo', 'medplus', 'chemist', 'diagnostic', 'netmeds', 'practo', '1mg', 'thyrocare', 'lal path'], category: 'Health' },
  { keys: ['netflix', 'prime', 'hotstar', 'disney', 'spotify', 'cinema', 'pvr', 'inox', 'bookmyshow', 'multiplex', 'youtube', 'zee5', 'sonyliv', 'jiocinema'], category: 'Entertainment' },
  { keys: ['school', 'college', 'university', 'tuition', 'coaching', 'udemy', 'coursera', 'byju', 'unacademy', 'fees', 'admission'], category: 'Education' },
  { keys: ['insurance', 'lic', 'premium', 'policy', 'star health', 'hdfc life', 'max life', 'bajaj allianz'], category: 'Insurance' },
  { keys: ['mutual fund', 'zerodha', 'groww', 'kuvera', 'navi', 'coin', 'sip', 'investment', 'demat', 'nps', 'ppf', 'elss'], category: 'Investments' },
  { keys: ['salary', 'payroll', 'income', 'stipend', 'dividends', 'interests'], category: 'Salary' },
  { keys: ['neft', 'imps', 'rtgs', 'upi', 'transfer', 'wallet', 'own a/c', 'self transfer'], category: 'Transfer' },
  { keys: ['emi', 'loan', 'repayment', 'instalment', 'installment'], category: 'Loan Payment' },
];

// Catches clear non-transaction SMS when AI is offline (regex fallback only).
// Patterns are deliberately unambiguous — "paid/debited/credited" never appears here.
const NON_TRANSACTION_RE = /\b(?:bill\s+(?:generated|due|amount|of\s+rs)|amount\s+(?:due|outstanding)|(?:amount|amt)\s+outstanding|outstanding\s+(?:amount|due|balance)|min(?:imum)?\s+(?:amount|amt|due|payment)|minimum\s+payment|total\s+(?:amount\s+)?due|payment\s+(?:due|reminder)|statement\s+(?:for|balance|generated)|pre-approved|limit\s+(?:increased|enhanced|update)|congratulations|eligible\s+for|apply\s+now|cashback\s+(?:of|earned|reward)|offer\s+(?:for|on|expires)|you\s+have\s+won|due\s+(?:by|on|date)|pay\s+by|payment\s+by|please\s+pay|avoid\s+(?:late\s+fee|interest|charges))\b/i;

function parseWithRegex(
  smsBody: string,
  accounts: Account[],
  categories: Category[],
  merchantHints: Array<{ raw: string; clean: string; category: string }>,
  smsTimestamp?: number,
): ParsedSmsResult | null {
  const lower = smsBody.toLowerCase();

  // ── 0. Reject non-transactions early ─────────────────────────────────────
  if (DECLINED_RE.test(lower)) return null;
  if (NON_TRANSACTION_RE.test(lower)) return null;

  // ── 6. Account match ─────────────────────────────────────────────────────
  const matchedAccount = matchSmsToAccount(smsBody, accounts);

  // ── 7. Available Balance (extracted first so we can exclude it from amount search and type detection) ──
  let balanceAfter: number | undefined;
  let cleanSmsForType = lower;
  const balMatch = smsBody.match(BALANCE_RE);
  if (balMatch) {
    const rawBal = balMatch[1].replace(/,/g, '');
    balanceAfter = parseFloat(rawBal) || undefined;
    // Strip the balance substring from the cleaned text to avoid matching its Cr/Dr suffix
    cleanSmsForType = lower.replace(balMatch[0].toLowerCase(), '');
  }

  // ── 1. Amount ─────────────────────────────────────────────────────────────
  // Pass 1: collect ALL currency-tagged amounts in document order, then exclude
  // whichever value matches the reported balance (tolerance: ±0.01 for float noise).
  const ALL_CURRENCY_RE = /(?:(?:inr|rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s*(?:inr|rs\.?|₹))/gi;
  const currencyAmounts: number[] = [];
  let cm: RegExpExecArray | null;
  while ((cm = ALL_CURRENCY_RE.exec(smsBody)) !== null) {
    const val = parseFloat((cm[1] || cm[2] || '0').replace(/,/g, ''));
    if (val > 0) currencyAmounts.push(val);
  }
  const isBalance = (v: number) => balanceAfter !== undefined && Math.abs(v - balanceAfter) < 0.02;
  const txAmounts = currencyAmounts.filter(v => !isBalance(v));
  let amount = txAmounts.length > 0 ? txAmounts[0] : (currencyAmounts[0] ?? 0);

  // Pass 2: keyword-anchored fallback for SMS with no currency marker
  // e.g. "debited from A/c XXXX 500.00" or "Dr INR 500"
  if (amount === 0) {
    const km = smsBody.match(AMOUNT_KEYWORD_RE);
    if (km?.[1]) amount = parseFloat(km[1].replace(/,/g, '')) || 0;
  }

  // Pass 3: "NNN Dr" / "NNN Cr" suffix format used in older SBI-style SMS
  if (amount === 0) {
    const dc = smsBody.match(AMOUNT_DR_CR_SUFFIX_RE);
    if (dc?.[1]) amount = parseFloat(dc[1].replace(/,/g, '')) || 0;
  }

  // Hard reject: no amount AND no account match → definitely not a bank SMS worth saving.
  // If we have a last4 match, allow through even with amount=0 so it surfaces for manual review.
  if (amount <= 0 && !matchedAccount) return null;
  if (amount <= 0 && matchedAccount?.matchType !== 'last4') return null;

  // ── 2. Transaction type ───────────────────────────────────────────────────
  let txType: 'debit' | 'credit' | 'transfer' = 'debit';
  let debitScore = 0;
  let creditScore = 0;
  let transferScore = 0;

  for (const pattern of DEBIT_SCORING_PATTERNS) {
    if (pattern.re.test(cleanSmsForType)) {
      debitScore += pattern.score;
    }
  }

  for (const pattern of CREDIT_SCORING_PATTERNS) {
    if (pattern.re.test(cleanSmsForType)) {
      creditScore += pattern.score;
    }
  }

  for (const pattern of TRANSFER_SCORING_PATTERNS) {
    if (pattern.re.test(cleanSmsForType)) {
      transferScore += pattern.score;
    }
  }

  // Handle "NNN Cr" / "NNN Dr" suffix format for type detection on the cleaned text
  const drCrSuffix = cleanSmsForType.match(AMOUNT_DR_CR_SUFFIX_RE)?.[2]?.toLowerCase();
  if (drCrSuffix === 'cr') {
    creditScore += 5;
  } else if (drCrSuffix === 'dr') {
    debitScore += 5;
  }

  // Choose the transaction type based on the scoring
  if (transferScore > debitScore && transferScore > creditScore) {
    txType = 'transfer';
  } else if (creditScore > debitScore) {
    txType = 'credit';
  } else {
    txType = 'debit';
  }

  // ── 3. Merchant ───────────────────────────────────────────────────────────
  let merchant = 'Unknown';
  for (const pattern of MERCHANT_PATTERNS) {
    const m = smsBody.match(pattern);
    if (m?.[1]) {
      const raw = m[1].trim();
      const hint = merchantHints.find(h => raw.toLowerCase().includes(h.raw.toLowerCase().slice(0, 6)));
      merchant = hint ? hint.clean : normalizeMerchant(raw);
      break;
    }
  }

  // ── 4. Date + Time ────────────────────────────────────────────────────────
  // Default: use the SMS received timestamp so the date is never "today" when
  // the actual transaction was on a different day.
  let txDate = smsTimestamp ? new Date(smsTimestamp).toISOString() : new Date().toISOString();
  const MONTH_MAP: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  for (const { re, format } of DATE_PATTERNS) {
    const m = smsBody.match(re);
    if (!m?.[1]) continue;
    let parsed: Date | null = null;
    if (format === 'iso') {
      parsed = new Date(m[1]);
    } else if (format === 'dmonY') {
      // "15-Jan-24", "15 Jan 2024", "15/Jan/24"
      const parts = m[1].split(/[-\/\s]+/);
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const mon = MONTH_MAP[parts[1].toLowerCase().slice(0, 3)];
        let yr = parseInt(parts[2], 10);
        if (yr < 100) yr += yr >= 50 ? 1900 : 2000;
        if (mon !== undefined && !isNaN(day) && !isNaN(yr)) parsed = new Date(yr, mon, day);
      }
    } else {
      // "DD/MM/YY", "DD-MM-YYYY", "DD.MM.YY" — Indian convention (day first, NOT MM/DD)
      const parts = m[1].split(/[-\/.]/);
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const mon = parseInt(parts[1], 10) - 1;
        let yr = parseInt(parts[2], 10);
        if (yr < 100) yr += yr >= 50 ? 1900 : 2000;
        if (!isNaN(day) && !isNaN(mon) && !isNaN(yr) && mon >= 0 && mon <= 11)
          parsed = new Date(yr, mon, day);
      }
    }
    if (parsed && !isNaN(parsed.getTime())) {
      const yr = parsed.getFullYear();
      const mo = String(parsed.getMonth() + 1).padStart(2, '0');
      const da = String(parsed.getDate()).padStart(2, '0');
      const originalTime = smsTimestamp ? new Date(smsTimestamp).toISOString() : new Date().toISOString();
      const timePart = originalTime.substring(10); // extracts T...Z
      txDate = `${yr}-${mo}-${da}${timePart}`;
      break;
    }
  }

  // Overlay time component if the SMS contains an explicit time ("14:30", "2:30 PM")
  const tMatch = smsBody.match(TIME_RE);
  if (tMatch) {
    let h = parseInt(tMatch[1], 10);
    const min = parseInt(tMatch[2], 10);
    const sec = tMatch[3] ? parseInt(tMatch[3], 10) : 0;
    const meridiem = tMatch[4]?.toLowerCase();
    if (meridiem === 'pm' && h < 12) h += 12;
    if (meridiem === 'am' && h === 12) h = 0;
    if (h >= 0 && h < 24 && min >= 0 && min < 60) {
      const d = new Date(txDate);
      d.setHours(h, min, sec, 0);
      txDate = d.toISOString();
    }
  }

  // ── 5. Category ───────────────────────────────────────────────────────────
  let category = 'Other';
  for (const kw of CATEGORY_KEYWORDS) {
    if (kw.keys.some(k => lower.includes(k))) {
      const userCat = categories.find(c =>
        c.name.toLowerCase().includes(kw.category.toLowerCase().split(' ')[0]) ||
        kw.category.toLowerCase().includes(c.name.toLowerCase())
      );
      category = userCat?.name ?? kw.category;
      break;
    }
  }
  // Merchant hint overrides category (learned from user's past confirmations)
  if (merchant !== 'Unknown') {
    const hint = merchantHints.find(h => merchant.toLowerCase().includes(h.clean.toLowerCase().slice(0, 5)));
    if (hint?.category) category = hint.category;
  }

  // ── 6. Confidence adjustment ─────────────────────────────────────────────
  // If we have a last4 match AND a clear amount, boost confidence
  let confidence: 'high' | 'medium' | 'low' = 'medium';
  if (amount > 0 && matchedAccount?.matchType === 'last4') {
    confidence = 'high';
  }

  return {
    isTransaction: true,
    transaction: {
      amount,
      merchant: merchant === 'Unknown' ? 'Review Needed' : merchant,
      category,
      type: txType,
      date: txDate,
      isConfirmed: false,
      rawSms: smsBody,
      isRecurring: false,
      confidence,
      source: 'sms',
      balanceAfter,
    },
    confidence,
    alreadySaved: false,
    suggestedAccountId: matchedAccount?.id ?? accounts[0]?.id,
    isAnomaly: false,
    parsedOffline: false,
  };
}

export interface ParsedSmsResult {
  /**
   * false  → determined this SMS is NOT a real executed transaction
   *          (reminder, promotional, balance alert, due notice, etc.) — skip it.
   * true   → real money movement; add to review queue.
   */
  isTransaction: boolean;
  transaction: Partial<Transaction>;
  confidence: 'high' | 'medium' | 'low';
  alreadySaved: boolean;
  /** Available balance after transaction, if mentioned in SMS */
  balanceAfter?: number;
  /** Account ID matched from suggestedAccountName */
  suggestedAccountId?: number;
  /** Flagged as unusually high spend */
  isAnomaly?: boolean;
  /** True when the local regex parser was used instead of on-device AI */
  parsedOffline?: boolean;
}

export interface ScanContext {
  subscriptions: Subscription[];
  goals: Goal[];
  loans: Loan[];
  accounts: Account[];
  categories: Category[];
  budgets: Budget[];
}

/** Build a rich, structured prompt section for user's accounts */
function buildAccountContext(accounts: Account[]): string {
  if (!accounts.length) return '';
  const lines = accounts.map(a => {
    if (a.accountType === 'credit_card') {
      return `  - "${a.name}" (credit card, limit: ₹${(a.creditLimit ?? 0).toLocaleString('en-IN')}, outstanding: ₹${Math.abs(a.balance).toLocaleString('en-IN')})`;
    }
    if (a.accountType === 'wallet') {
      return `  - "${a.name}" (wallet, balance: ₹${a.balance.toLocaleString('en-IN')})`;
    }
    return `  - "${a.name}" (${a.accountType}, balance: ₹${a.balance.toLocaleString('en-IN')})`;
  });
  return `\nUser's Bank Accounts (use name exactly as listed to suggest which account this SMS belongs to):\n${lines.join('\n')}`;
}

/** Build category context grouped by type */
function buildCategoryContext(categories: Category[]): string {
  if (!categories.length) return '';
  const expense = categories.filter(c => c.type === 'expense').map(c => `"${c.name}"`).join(', ');
  const income = categories.filter(c => c.type === 'income').map(c => `"${c.name}"`).join(', ');
  const transfer = categories.filter(c => c.type === 'transfer').map(c => `"${c.name}"`).join(', ');
  const parts: string[] = [];
  if (expense) parts.push(`expense: ${expense}`);
  if (income) parts.push(`income: ${income}`);
  if (transfer) parts.push(`transfer: ${transfer}`);
  return `\nCategories:\n${parts.map(p => `  ${p}`).join('\n')}`;
}

/** Build budget context so AI can flag anomalies */
function buildBudgetContext(budgets: Budget[]): string {
  if (!budgets.length) return '';
  const monthly = budgets
    .filter(b => b.period === 'monthly')
    .map(b => `${b.categoryName}: ₹${b.amount.toLocaleString('en-IN')}`)
    .join(', ');
  return monthly ? `\nMonthly budgets set by user: ${monthly}` : '';
}

/**
 * On-device LLM parser — used only for ambiguous SMS that regex can't handle confidently.
 * Returns a parsed result or null if the LLM determines it's not a transaction.
 */
async function parseWithLLM(
  smsBody: string,
  smsDate: string,
  accounts: Account[],
  categories: Category[],
  budgets: Budget[],
  subscriptions: Subscription[],
  loans: Loan[],
  goals: Goal[],
  merchantHints: Array<{ raw: string; clean: string; category: string }>,
): Promise<ParsedSmsResult | null> {
  // Prioritize core categories and limit total categories to 25 to prevent "Context is full" error in LLM
  const coreSet = new Set([
    'food & dining', 'transport', 'shopping', 'groceries',
    'bills & utilities', 'health', 'entertainment', 'salary',
    'transfer', 'other'
  ]);
  const coreCats = categories.filter(c => coreSet.has(c.name.toLowerCase()));
  const otherCats = categories.filter(c => !coreSet.has(c.name.toLowerCase()));
  const limitedCategories = [...coreCats, ...otherCats].slice(0, 25);

  const categoryNames = limitedCategories.length > 0
    ? limitedCategories.map(c => c.name)
    : ['Food & Dining', 'Transport', 'Shopping', 'Bills & Utilities', 'Entertainment', 'Health', 'Other'];
  
  const categoryHint = `[${categoryNames.map(name => `'${name}'`).join(', ')}]`;
  const merchantContext = 'Merchant Context: Clean string resolution for known nodes.';

  // Streamlined prompt optimized for 1B edge models with explicit global rules
  const prompt = `<|im_start|>system
You are a strict, deterministic banking SMS data extraction engine. Analyze the provided SMS input text and output a single valid JSON object matching the exact schema keys in sequence.

Rules:
1. isTransaction MUST be false for alerts, payment requests, links, OTP verification codes, minimum balance warnings, statement generation notices, or pre-approved limit offers. It is true ONLY if money has explicitly and successfully been debited, credited, or spent.
2. If isTransaction is false, the amount key MUST be strictly forced to 0.
3. If isTransaction is false and no merchant is being paid, use the bank or service name as the merchant.
4. Output ONLY the raw JSON block without markdown backticks.<|im_end|>
<|im_start|>user
SMS: "${smsBody}"
SMS Date: ${smsDate}
Available Categories: ${categoryHint}
${merchantContext}

Return JSON matching the schema.<|im_end|>
<|im_start|>assistant` ;

  const schemaProperties: Record<string, any> = {
    isTransaction: { type: 'boolean' },
    amount: { type: 'number' },
    merchant: { type: 'string' },
    type: { type: 'string', enum: ['credit', 'debit', 'transfer'] },
    category: { type: 'string' }
  };

  const schema = {
    type: 'object',
    properties: schemaProperties,
    required: ['isTransaction']
  };

  try {
    const rawOutput = await AIModelManager.runInference(prompt, {
      maxTokens: 256,
      temperature: 0.1,
      timeoutMs: 25000,
      stopSequences: ['}'],
      jsonSchema: JSON.stringify(schema),
    });

    console.log('raw output=======', rawOutput)

    if (!rawOutput || rawOutput.trim() === '') {
      return null;
    }

    const parsed = extractJSONObject<{
      isTransaction?: boolean;
      amount?: number;
      merchant?: string;
      type?: string;
      category?: string;
    }>(rawOutput);

    if (!parsed) {
      console.warn('[SmsParserService] Failed to extract JSON from LLM output.');
      return null;
    }

    if (parsed.isTransaction === false) {
      return null;
    }

    const cleanMerchant = normalizeMerchant(parsed.merchant || 'Unknown');
    const txType = (parsed.type === 'credit' || parsed.type === 'transfer') ? parsed.type : 'debit';
    const amount = parsed.amount || 0;

    if (cleanMerchant !== 'Unknown') {
      await upsertMerchantMapping(parsed.merchant || cleanMerchant, cleanMerchant, parsed.category || 'Other');
    }

    console.log('[SmsParserService] LLM parsed successfully: merchant =', cleanMerchant, ', amount =', amount);

    return {
      isTransaction: true,
      transaction: {
        amount: Math.abs(amount),
        merchant: cleanMerchant,
        category: parsed.category || 'Other',
        type: txType,
        date: smsDate,
        isConfirmed: false,
        rawSms: smsBody,
        isRecurring: false,
        confidence: 'low',
        source: 'sms',
        subscriptionId: subscriptions.find(s => s.name === cleanMerchant)?.id,
        goalId: goals.find(g => g.name === cleanMerchant)?.id,
        loanId: loans.find(l => l.lender === cleanMerchant)?.id,
      },
      confidence: 'low',
      alreadySaved: false,
      isAnomaly: false,
      parsedOffline: false,
    };
  } catch (err) {
    console.error('[SmsParserService] Exception in parseWithLLM:', err);
    return null;
  }
}

// Rate-limit the "AI not available" notification to once per 60s across all SMS in a scan
let _aiDownNotified = false;

export const SmsParserService = {
  /**
   * Hybrid SMS parser: regex-first, on-device LLM for ambiguous cases.
   *
   * Flow:
   * 1. Run regex parser (fast, ~0ms)
   * 2. If confidence is high → return regex result
   * 3. If confidence is medium/low or merchant is "Review Needed" → try on-device LLM
   * 4. If LLM fails or isn't available → return regex result as-is
   */
  async parse(
    smsBody: string,
    currentCategories: string[] = [],
    merchantHints: Array<{ raw: string; clean: string; category: string }> = [],
    context?: Partial<ScanContext>,
    smsTimestamp?: number,
  ): Promise<ParsedSmsResult> {
    const {
      subscriptions = [],
      goals = [],
      loans = [],
      accounts = [],
      categories = [],
      budgets = [],
    } = context || {};

    const smsDate = smsTimestamp
      ? new Date(smsTimestamp).toISOString()
      : new Date().toISOString();
    const hash = hashSms(smsBody);

    const alreadySaved = await isSmsAlreadyProcessed(hash);
    if (alreadySaved) {
      return {
        isTransaction: true,
        transaction: { rawSms: smsBody, isConfirmed: false },
        confidence: 'low',
        alreadySaved: true,
      };
    }

    // ── Step 1: Regex parser (fast path) ────────────────────────────────────
    const regexResult = parseWithRegex(smsBody, accounts, categories, merchantHints, smsTimestamp);
    // Regex determined this is not a transaction at all → skip
    if (!regexResult) {
      // If the on-device model is loaded, give it a chance to classify ambiguous SMS
      // that regex outright rejected (e.g. unusual formats)
      const modelLoaded = AIModelManager.isModelLoaded();
      if (modelLoaded) {
        try {
          const llmResult = await parseWithLLM(
            smsBody, smsDate, accounts, categories, budgets,
            subscriptions, loans, goals, merchantHints,
          );
          if (llmResult) return llmResult;
        } catch (err) {
          console.error('[SmsParserService] LLM failed for regex-rejected SMS:', err);
        }
      }
      return {
        isTransaction: false,
        transaction: { rawSms: smsBody, isConfirmed: false },
        confidence: 'low',
        alreadySaved: false,
      };
    }

    // ── Step 2: High-confidence regex → return immediately ──────────────────
    if (regexResult.confidence === 'high' && regexResult.transaction.merchant !== 'Review Needed') {
      return regexResult;
    }

    // ── Step 3: Ambiguous — try on-device LLM ──────────────────────────────
    const modelLoaded = AIModelManager.isModelLoaded();
    if (modelLoaded) {
      try {
        const llmResult = await parseWithLLM(
          smsBody, smsDate, accounts, categories, budgets,
          subscriptions, loans, goals, merchantHints,
        );
        if (llmResult) {
          // Merge LLM result with regexResult for date, balance, and account matching
          return {
            isTransaction: true,
            transaction: {
              ...regexResult.transaction, // Keep regex date, balanceAfter, accountId, etc.
              amount: regexResult.transaction.amount || llmResult.transaction.amount || 0,
              merchant: llmResult.transaction.merchant || regexResult.transaction.merchant || 'Review Needed',
              category: llmResult.transaction.category || regexResult.transaction.category || 'Other',
              type: llmResult.transaction.type || regexResult.transaction.type || 'debit',
              confidence: 'medium',
            },
            confidence: 'medium',
            alreadySaved: false,
            suggestedAccountId: regexResult.suggestedAccountId,
            balanceAfter: regexResult.balanceAfter,
            isAnomaly: llmResult.isAnomaly || regexResult.isAnomaly || false,
            parsedOffline: false,
          };
        }
      } catch (err) {
        console.error('[SmsParserService] LLM failed for ambiguous SMS:', err);
        // LLM failed — fall through to regex result
      }
    } else if (!_aiDownNotified) {
      // Model not loaded — show a one-time notification per scan
      _aiDownNotified = true;
      notify.info('AI model not loaded', 'Using basic parsing — review transactions before confirming');
      setTimeout(() => { _aiDownNotified = false; }, 60_000);
    }

    // ── Step 4: Fall back to regex result ────────────────────────────────────
    console.log('[SmsParserService] Falling back to Regex Parse Result.');
    regexResult.parsedOffline = true;
    return regexResult;
  },

  /** Load all context needed for a full scan */
  async getContext(): Promise<{ context: ScanContext; merchantHints: Array<{ raw: string; clean: string; category: string }> }> {
    const [subs, gs, ls, accs, cats, mappings, budgets] = await Promise.all([
      getSubscriptions(true),
      getGoals(true),
      getLoans(true),
      getAccounts(),
      getCategories(),
      getTopMerchantMappings(100),
      getBudgets(),
    ]);

    return {
      context: {
        subscriptions: subs,
        goals: gs,
        loans: ls,
        accounts: accs,
        categories: cats,
        budgets,
      },
      merchantHints: mappings.map(m => ({ raw: m.merchantRaw, clean: m.merchantClean, category: m.categoryName })),
    };
  },
};

export type SmsMatchType = 'last4' | 'upi' | 'bankname';
export type SmsAccountMatch = Account & { matchType: SmsMatchType };

/**
 * Match a raw SMS body against the user's registered accounts.
 *
 * Returns the matched account with a matchType indicating confidence:
 *  - 'last4'    — last-4-digits match (strongest — definitively ties SMS to account)
 *  - 'upi'      — UPI VPA handle match (medium)
 *  - 'bankname' — bank name keyword match (weakest)
 *
 * Returns null if no account can be tied to this SMS.
 */
export function matchSmsToAccount(smsBody: string, accounts: Account[]): SmsAccountMatch | null {
  const trackable = accounts.filter(
    a => a.accountType === 'bank' || a.accountType === 'credit_card'
  );
  if (trackable.length === 0) return null;

  const lower = smsBody.toLowerCase();

  // ── 0. Gather Candidates from SMS for 2 to 4 digits ───────────────────────
  const candidates: string[] = [];

  // Pass A: Extract from masked runs like xx29, *169, xxxx6169, etc.
  // We look for any word containing at least one mask character (*, x, X) and ending with 2-4 digits.
  const maskedPattern = /\b[*xX]+\d{2,4}\b/gi;
  let m: RegExpExecArray | null;
  while ((m = maskedPattern.exec(smsBody)) !== null) {
    const digits = m[0].replace(/[^0-9]/g, '');
    if (digits.length >= 2) {
      candidates.push(digits);
    }
  }

  // Pass B: Keyword-anchored digits (e.g. "a/c xx29", "card ending 169", "account 4321")
  // Exclude general prepositions like "on" and "thru" when matching shorter 2-3 digit sequences to avoid matching dates or transaction IDs.
  const anchorPattern = /(?:a\/c|acct?|account|card|ending|ending\s+with|ending\s+in|no\.?|xx+|x+)(?:\s+with|\s+number)?\s*[*xX\d]*?(\d{2,4})\b/gi;
  while ((m = anchorPattern.exec(smsBody)) !== null) {
    const digits = m[1];
    if (digits.length >= 2) {
      candidates.push(digits);
    }
  }

  // Pass C: General 4-digit groups (fallback for non-anchored standard 4-digit formatting)
  const general4DigitPattern = /\b\d{4}\b/g;
  while ((m = general4DigitPattern.exec(smsBody)) !== null) {
    candidates.push(m[0]);
  }

  // Also check last digits of any other long numeric/masked runs (e.g. "xxxxxx1769")
  const longRunsPattern = /[*xX\d]{5,}/g;
  while ((m = longRunsPattern.exec(smsBody)) !== null) {
    const digits = m[0].replace(/[^0-9]/g, '');
    if (digits.length >= 2) {
      candidates.push(digits);
    }
  }

  const uniqueCandidates = Array.from(new Set(candidates));

  const accountsWithDigits = trackable.filter(a => a.last4Digits);
  if (accountsWithDigits.length > 0 && uniqueCandidates.length > 0) {
    // 1. First priority: Exact match
    for (const cand of uniqueCandidates) {
      const hit = accountsWithDigits.find(a => a.last4Digits === cand);
      if (hit) return { ...hit, matchType: 'last4' };
    }

    // 2. Second priority: Suffix-based partial match (if one is a suffix of the other)
    for (const cand of uniqueCandidates) {
      const hit = accountsWithDigits.find(a => {
        if (!a.last4Digits) return false;
        const minLen = Math.min(cand.length, a.last4Digits.length);
        if (minLen < 2) return false;
        return cand.slice(-minLen) === a.last4Digits.slice(-minLen);
      });
      if (hit) return { ...hit, matchType: 'last4' };
    }
  }

  // ── 1. UPI VPA / handle → bank name keyword ────────────────────────────────
  const vpaMatch = lower.match(/@([a-z]+)/);
  if (vpaMatch) {
    const handle = vpaMatch[1];
    const hit = trackable.find(a => {
      const n = a.name.toLowerCase();
      return handle.includes(n.split(' ')[0]) || n.split(' ').some(w => handle.includes(w));
    });
    if (hit) return { ...hit, matchType: 'upi' };
  }

  // ── 2. Bank name keyword in SMS body ──────────────────────────────────────
  const hit = trackable.find(a => {
    const nameLower = a.name.toLowerCase();
    const keyword = nameLower.split(' ')[0];
    if (keyword === 'sbi' && (lower.includes('sbi') || lower.includes('sbicrd'))) return true;
    return keyword.length >= 3 && lower.includes(keyword);
  });
  if (hit) return { ...hit, matchType: 'bankname' };

  return null;
}
