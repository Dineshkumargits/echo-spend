import Constants from 'expo-constants';
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

const extra = Constants.expoConfig?.extra ?? {};

const OLLAMA_ENDPOINT: string =
  extra.ollamaEndpoint || 'https://ollama.adkdev.in/api/generate';
const MODEL_NAME: string = extra.ollamaModel || 'gemma4:latest';
const CF_CLIENT_ID: string = extra.cfAccessClientId || '';
const CF_CLIENT_SECRET: string = extra.cfAccessClientSecret || '';

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
  return raw
    .replace(/\*[A-Z0-9]+/g, '')
    .replace(/\d{6,}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export class OllamaUnreachableError extends Error {
  constructor() { super('AI server unreachable'); }
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 2,
  delayMs = 800
): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, options);
    } catch {
      // Network-level failure (offline, DNS, timeout)
      if (attempt === retries - 1) throw new OllamaUnreachableError();
      await new Promise(r => setTimeout(r, delayMs));
      continue;
    }

    if (res.ok) return res;

    const errText = await res.text().catch(() => '');
    if (res.status === 403) {
      throw new Error(`403 Forbidden: CF Access blocked. ${errText}`);
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      if (attempt === retries - 1) throw new OllamaUnreachableError();
      await new Promise(r => setTimeout(r, delayMs * Math.pow(2, attempt)));
      continue;
    }
    if (res.status < 500) throw new Error(`HTTP Error ${res.status}: ${errText}`);
    throw new Error(`Server Error ${res.status}: ${errText}`);
  }
  throw new OllamaUnreachableError();
}

// ─── Local regex-based SMS parser (runs when Ollama is unreachable) ───────────

// Pass-2 keyword fallback: allows up to 40 non-digit chars between keyword and amount
// so it handles "debited from A/c XXXX 500.00", "Dr INR 500", etc.
const AMOUNT_KEYWORD_RE = /(?:debited|credited|deducted|spent|paid|charged|withdrawn|sent|received|payment|purchase|transfer(?:red)?|txn|amount|amt|dr\b|cr\b)[^₹\d]{0,40}?(?:(?:inr|rs\.?|₹)\s*)?([\d,]+(?:\.\d{1,2})?)/i;

// Pass-3: older SBI/bank "NNN Dr" / "NNN Cr" suffix format with no currency marker
const AMOUNT_DR_CR_SUFFIX_RE = /([\d,]+(?:\.\d{1,2})?)\s*\b(dr|cr)\b/i;

// Balance patterns — covers all major Indian bank SMS variants:
// "Avl Bal", "Avl. Bal.", "Avbl Bal", "Available Balance", "A/c Bal", "Bal:", etc.
const BALANCE_RE = /(?:avail(?:able)?\s*(?:bal(?:ance)?)?|avl\.?\s*bal\.?|avbl\.?\s*bal\.?|a\/c\s*bal\.?|bal(?:ance)?\s*(?:is|:)?|outstanding)\s*(?::?\s*)(?:inr|rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i;

// "declined", "failed", etc. — these are NOT completed transactions
const DECLINED_RE = /\b(?:declined|failed|rejected|unsuccessful|not\s+processed|reversal|reversed|could\s+not\s+process)\b/i;

const DEBIT_WORDS = ['debited', 'debit', 'spent', 'paid', 'payment', 'purchase', 'withdrawn', 'withdrawal', 'used', 'charged', 'dr '];
const CREDIT_WORDS = ['credited', 'credit', 'received', 'deposited', 'deposit', 'refund', 'cashback', 'cr '];
const TRANSFER_WORDS = ['transfer', 'neft', 'imps', 'rtgs'];

// Ordered from most-specific to least-specific.
// "from MERCHANT" added for credit-style SMS ("received from Infosys").
// UPI VPA pattern anchored with word boundary to avoid matching email addresses.
const MERCHANT_PATTERNS = [
  /\bat\s+([A-Za-z][A-Za-z0-9 &'.\-]{2,30}?)(?:\s+on\b|\s+for\b|\s+ref|\s+txn|\s+upi|[,.]|$)/i,
  /\bto\s+([A-Za-z][A-Za-z0-9 &'.\-]{2,30}?)(?:\s+on\b|\s+for\b|\s+ref|\s+upi|[,.]|$)/i,
  /\bfrom\s+([A-Za-z][A-Za-z0-9 &'.\-]{2,30}?)(?:\s+on\b|\s+for\b|\s+ref|\s+upi|[,.]|$)/i,
  /\bfor\s+([A-Za-z][A-Za-z0-9 &'.\-]{2,30}?)(?:\s+on\b|\s+ref|\s+upi|[,.]|$)/i,
  /\b([A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z]{2,})\b/i,  // UPI VPA (e.g. merchant@okaxis)
];

// ISO first, then "DD-Mon-YY(YY)", then numeric with -, /, or . separators.
// All three are valid in Indian bank SMS ("15/01/24", "15-01-24", "15.01.24").
const DATE_PATTERNS: Array<{ re: RegExp; format: 'iso' | 'dmonY' | 'ddmmyy' }> = [
  { re: /(\d{4}-\d{2}-\d{2})/, format: 'iso' },
  { re: /(\d{1,2}[-\/\s][A-Za-z]{3}[-\/\s]\d{2,4})/, format: 'dmonY' },
  { re: /(\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4})/, format: 'ddmmyy' },
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
  { keys: ['salary', 'payroll', 'income', 'stipend'], category: 'Salary' },
  { keys: ['neft', 'imps', 'rtgs', 'upi', 'transfer', 'wallet'], category: 'Transfer' },
  { keys: ['emi', 'loan', 'repayment', 'instalment', 'installment'], category: 'Loan Payment' },
];

// Catches clear non-transaction SMS when AI is offline (regex fallback only).
// Patterns are deliberately unambiguous — "paid/debited/credited" never appears here.
const NON_TRANSACTION_RE = /\b(?:bill\s+(?:generated|due|amount|of\s+rs)|amount\s+(?:due|outstanding)|(?:amount|amt)\s+outstanding|outstanding\s+(?:amount|due|balance)|min(?:imum)?\s+(?:amount|amt|due|payment)|minimum\s+payment|total\s+(?:amount\s+)?due|payment\s+(?:due|reminder)|statement\s+(?:for|balance|generated)|pre-approved|limit\s+(?:increased|enhanced|update)|congratulations|eligible\s+for|apply\s+now|cashback\s+(?:of|earned|reward)|offer\s+(?:for|on|expires)|you\s+have\s+won|due\s+(?:by|on|date)|pay\s+by|payment\s+by|please\s+pay|avoid\s+(?:late\s+fee|interest|charges))\b/i;

function parseSmsFallback(
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

  // ── 7. Available Balance (extracted first so we can exclude it from amount search) ──
  let balanceAfter: number | undefined;
  const balMatch = smsBody.match(BALANCE_RE);
  if (balMatch) {
    const rawBal = balMatch[1].replace(/,/g, '');
    balanceAfter = parseFloat(rawBal) || undefined;
  }

  // ── 1. Amount ─────────────────────────────────────────────────────────────
  // Pass 1: collect ALL currency-tagged amounts in document order, then exclude
  // whichever value matches the reported balance (tolerance: ±0.01 for float noise).
  const ALL_CURRENCY_RE = /(?:(?:inr|rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:inr|rs\.?|₹))/gi;
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
  if (CREDIT_WORDS.some(w => lower.includes(w))) {
    txType = 'credit';
  } else if (TRANSFER_WORDS.some(w => lower.includes(w))) {
    txType = 'transfer';
  } else if (DEBIT_WORDS.some(w => lower.includes(w))) {
    txType = 'debit';
  }
  // Handle "NNN Cr" / "NNN Dr" suffix format for type detection
  const drCrSuffix = smsBody.match(AMOUNT_DR_CR_SUFFIX_RE)?.[2]?.toLowerCase();
  if (drCrSuffix === 'cr') txType = 'credit';
  else if (drCrSuffix === 'dr') txType = 'debit';

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
      confidence: 'medium',
      source: 'sms',
      balanceAfter,
    },
    confidence: 'medium',
    alreadySaved: false,
    suggestedAccountId: matchedAccount?.id ?? accounts[0]?.id,
    isAnomaly: false,
    parsedOffline: true,
  };
}

export interface ParsedSmsResult {
  /**
   * false  → AI determined this SMS is NOT a real executed transaction
   *          (reminder, promotional, balance alert, due notice, etc.) — skip it.
   * true   → real money movement; add to review queue.
   */
  isTransaction: boolean;
  transaction: Partial<Transaction>;
  confidence: 'high' | 'medium' | 'low';
  alreadySaved: boolean;
  /** Available balance after transaction, if mentioned in SMS */
  balanceAfter?: number;
  /** Account ID matched from AI's suggestedAccountName */
  suggestedAccountId?: number;
  /** AI flagged this as unusually high spend */
  isAnomaly?: boolean;
  /** True when Ollama was unreachable and the local regex parser was used instead */
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

// Rate-limit the "AI server is down" notification to once per 60s across all SMS in a scan
let _ollamaDownNotified = false;

export const SmsParserService = {
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

    // Use full Category objects if available, else fall back to the string list
    const categoryHint = categories.length > 0
      ? categories.map(c => `"${c.name}"`).join(' | ')
      : currentCategories.length > 0
        ? currentCategories.map(c => `"${c}"`).join(' | ')
        : '"Food" | "Transport" | "Shopping" | "Bills" | "Entertainment" | "Health" | "Other"';

    const merchantContext = merchantHints.length > 0
      ? `\nKnown merchant mappings (use these for consistent naming): ${merchantHints.slice(0, 15).map(m => `"${m.raw}" → "${m.clean}" (${m.category})`).join(', ')}`
      : '';

    const accountCtx = buildAccountContext(accounts);
    const categoryCtx = buildCategoryContext(categories);
    const budgetCtx = buildBudgetContext(budgets);

    const subContext = subscriptions.length > 0
      ? `\nActive Subscriptions: ${subscriptions.map(s => `"${s.name}" (₹${s.amount}/${s.frequency}, category: ${s.category})`).join(', ')}`
      : '';

    const loanContext = loans.length > 0
      ? `\nActive Loans/EMIs: ${loans.map(l => `"${l.lender}" (EMI: ₹${l.emiAmount}, type: ${l.type})`).join(', ')}`
      : '';

    const goalContext = goals.length > 0
      ? `\nSaving Goals: ${goals.map(g => `"${g.name}" (target: ₹${g.targetAmount})`).join(', ')}`
      : '';

    const accountNameList = accounts.length > 0
      ? accounts.map(a => `"${a.name}"`).join(' | ')
      : '"unknown"';

    const prompt = `You are a precise Indian personal finance assistant. Your primary job is to determine whether an SMS represents a REAL executed bank transaction, then extract its details.

SMS: "${smsBody}"
SMS received on: ${smsDate}
${merchantContext}${accountCtx}${categoryCtx}${budgetCtx}${subContext}${loanContext}${goalContext}

Return ONLY valid JSON in this exact format:
{
  "isTransaction": <true | false>,
  "amount": <positive number, or 0 if not a transaction>,
  "merchant": "<cleaned merchant name — no transaction IDs, no location codes>",
  "type": "credit" | "debit" | "transfer",
  "category": ${categoryHint},
  "date": "<ISO-8601 date extracted from SMS text, or use received date: ${smsDate}>",
  "confidence": "high" | "low",
  "isRecurring": <boolean>,
  "anomaly": <boolean — true if amount seems unusually large given merchant or category budgets>,
  "suggestedAccountName": ${accountNameList},
  "suggestedEntity": {
    "type": "subscription" | "goal" | "loan" | "none",
    "name": "<exact name from context lists above, or empty string>"
  },
  "balanceAfter": <number — extract available/outstanding/remaining balance if mentioned in SMS, else null>
}

Rules:
- isTransaction MUST be true ONLY for a completed, executed money movement (debit/credit/transfer actually happened).
  Set isTransaction to false for: credit card due reminders, minimum due alerts, payment reminders, bill statements, balance alerts, promotional offers, cashback earned notices, OTPs, limit change alerts, loan disbursal pending notifications.
- confidence "high" = amount + merchant + type all clearly stated; "low" = SMS is ambiguous or some fields must be inferred.
- amount must be a positive number (absolute value). Set 0 if isTransaction is false.
- type: "credit" if money entered the account, "debit" if money left, "transfer" if between user's own accounts. UPI sent = debit, UPI received = credit.
- Merchant: clean, human-readable, no Ref/order IDs, no location codes.
- suggestedAccountName: pick from the list above based on bank name, card number, or UPI handle in the SMS.
- anomaly: true if amount is >3x the monthly budget for that category, or merchant seems suspicious.
`;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };
      if (CF_CLIENT_ID) headers['CF-Access-Client-Id'] = CF_CLIENT_ID;
      if (CF_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = CF_CLIENT_SECRET;

      const response = await fetchWithRetry(OLLAMA_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: MODEL_NAME,
          prompt,
          stream: false,
          format: 'json',
          options: { temperature: 0.1 },
        }),
      });

      const responseText = await response.text();
      const ollamaResult = JSON.parse(responseText);
      const rawModelOutput: string = ollamaResult.response || '';

      // AI was reachable but returned an empty body — it deliberately rejected this SMS.
      // Do NOT fall back to regex; respect the AI's judgement.
      if (!rawModelOutput || rawModelOutput.trim() === 'null' || rawModelOutput.trim() === '') {
        return { isTransaction: false, transaction: { rawSms: smsBody, isConfirmed: false }, confidence: 'low', alreadySaved: false };
      }

      const parsed = extractJSONObject<{
        isTransaction?: boolean;
        amount?: number;
        merchant?: string;
        type?: string;
        category?: string;
        date?: string;
        confidence?: string;
        isRecurring?: boolean;
        anomaly?: boolean;
        suggestedAccountName?: string;
        suggestedEntity?: { type: string; name: string };
        balanceAfter?: number;
      }>(rawModelOutput);

      // AI explicitly said not a transaction, or returned an empty/no-amount object.
      // Do NOT fall back to regex — the AI was reachable and made a deliberate call.
      if (!parsed || parsed.isTransaction === false || !parsed.amount || parsed.amount <= 0) {
        return { isTransaction: false, transaction: { rawSms: smsBody, isConfirmed: false }, confidence: 'low', alreadySaved: false };
      }

      const amount = parsed.amount;
      const cleanMerchant = normalizeMerchant(parsed.merchant || 'Unknown');
      // Confidence is now "high" | "low" from the prompt; treat anything else as "low".
      const confidence: 'high' | 'medium' | 'low' = parsed.confidence === 'high' ? 'high' : 'low';
      const txType = (parsed.type === 'credit' || parsed.type === 'transfer') ? parsed.type : 'debit';
      let txDate = parsed.date || smsDate;
      if (parsed.date) {
        // If AI returns just a date (YYYY-MM-DD) or midnight time, overlay the exact SMS received time
        if (parsed.date.length === 10 || parsed.date.includes('T00:00:00')) {
          const timePart = smsDate.includes('T') ? smsDate.substring(smsDate.indexOf('T')) : '';
          txDate = parsed.date.substring(0, 10) + timePart;
        }
      }
      const balanceAfter = (parsed.balanceAfter && parsed.balanceAfter > 0) ? parsed.balanceAfter : undefined;

      // NOTE: isTransactionDuplicate was removed here. It used a ±1 day / same-amount
      // window which caused every recurring expense to be permanently hash-locked after
      // the first scan. SMS-body hash deduplication (isSmsAlreadyProcessed above) is the
      // correct dedup layer — it's body-exact and never blocks genuinely new SMS.

      if (cleanMerchant !== 'Unknown') {
        await upsertMerchantMapping(parsed.merchant || cleanMerchant, cleanMerchant, parsed.category || 'Other');
      }

      // Match AI's suggested account name to the actual accounts list
      let suggestedAccountId: number | undefined;
      if (parsed.suggestedAccountName && accounts.length > 0) {
        const suggested = parsed.suggestedAccountName.toLowerCase().trim();
        const matched = accounts.find(a => a.name.toLowerCase().trim() === suggested)
          ?? accounts.find(a => suggested.includes(a.name.toLowerCase().trim().split(' ')[0]))
          ?? accounts[0];
        suggestedAccountId = matched?.id;
      } else if (accounts.length > 0) {
        suggestedAccountId = accounts[0].id;
      }

      return {
        isTransaction: true,
        transaction: {
          amount: Math.abs(amount),
          merchant: cleanMerchant,
          category: parsed.category || 'Other',
          type: txType,
          date: txDate,
          isConfirmed: false,
          rawSms: smsBody,
          isRecurring: parsed.isRecurring || false,
          confidence,
          source: 'sms',
          subscriptionId: parsed.suggestedEntity?.type === 'subscription'
            ? subscriptions.find(s => s.name === parsed.suggestedEntity?.name)?.id
            : undefined,
          goalId: parsed.suggestedEntity?.type === 'goal'
            ? goals.find(g => g.name === parsed.suggestedEntity?.name)?.id
            : undefined,
          loanId: parsed.suggestedEntity?.type === 'loan'
            ? loans.find(l => l.lender === parsed.suggestedEntity?.name)?.id
            : undefined,
          balanceAfter,
        },
        confidence,
        alreadySaved: false,
        suggestedAccountId,
        isAnomaly: parsed.anomaly ?? false,
      };
    } catch (error) {
      if (error instanceof OllamaUnreachableError) {
        if (!_ollamaDownNotified) {
          _ollamaDownNotified = true;
          notify.info('AI server is down', 'Using local parsing — review transactions before confirming');
          setTimeout(() => { _ollamaDownNotified = false; }, 60_000);
        }
      }
      // Errors mean AI was UNREACHABLE (network failure, malformed JSON, etc.) — not a deliberate
      // rejection. Fall back to the local regex parser so the user still sees the SMS.
      const local = parseSmsFallback(smsBody, accounts, categories, merchantHints, smsTimestamp);
      if (local) return local;

      // Regex also failed — skip silently (don't pollute the review queue with garbage).
      return { isTransaction: false, transaction: { rawSms: smsBody, isConfirmed: false }, confidence: 'low', alreadySaved: false };
    }
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

  // ── 1. Last-4-digits match (strongest signal) ──────────────────────────────
  // Covers: "a/c XX1234", "card 1234", "ending 1234", "ending in 1234",
  //         "no. 1234", "xx 1234", "X 1234", "thru 1234"
  const last4Pattern = /(?:a\/c|acct?|account|card|ending|ending\s+with|ending\s+in|no\.?|xx+|x+|thru|on)(?:\s+with|\s+number)?\s*[*xX\d]*?(\d{4})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = last4Pattern.exec(smsBody)) !== null) {
    const digits = m[1];
    const hit = trackable.find(a => a.last4Digits && a.last4Digits === digits);
    if (hit) return { ...hit, matchType: 'last4' };
  }

  // Also catch bare 4-digit groups (e.g. "linked to 4321", "VPA xxxxxx4321")
  // Only check accounts that have last4Digits set to avoid false positives.
  const accountsWith4 = trackable.filter(a => a.last4Digits);
  if (accountsWith4.length > 0) {
    const bareDigits = smsBody.match(/\b\d{4}\b/g) ?? [];
    for (const d of bareDigits) {
      const hit = accountsWith4.find(a => a.last4Digits === d);
      if (hit) return { ...hit, matchType: 'last4' };
    }
    // Also check last 4 of longer digit runs (e.g. "xxxxxx1234")
    const longRuns = smsBody.match(/[xX*\d]{6,}/g) ?? [];
    for (const run of longRuns) {
      const suffix = run.replace(/[^0-9]/g, '').slice(-4);
      if (suffix.length === 4) {
        const hit = accountsWith4.find(a => a.last4Digits === suffix);
        if (hit) return { ...hit, matchType: 'last4' };
      }
    }
  }

  // ── 2. UPI VPA / handle → bank name keyword ────────────────────────────────
  const vpaMatch = lower.match(/@([a-z]+)/);
  if (vpaMatch) {
    const handle = vpaMatch[1];
    const hit = trackable.find(a => {
      const n = a.name.toLowerCase();
      return handle.includes(n.split(' ')[0]) || n.split(' ').some(w => handle.includes(w));
    });
    if (hit) return { ...hit, matchType: 'upi' };
  }

  // ── 3. Bank name keyword in SMS body ──────────────────────────────────────
  const hit = trackable.find(a => {
    const nameLower = a.name.toLowerCase();
    const keyword = nameLower.split(' ')[0];
    if (keyword === 'sbi' && (lower.includes('sbi') || lower.includes('sbicrd'))) return true;
    return keyword.length >= 3 && lower.includes(keyword);
  });
  if (hit) return { ...hit, matchType: 'bankname' };

  return null;
}
