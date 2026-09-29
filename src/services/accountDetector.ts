import { Platform, PermissionsAndroid } from 'react-native';
import { Account, getAccounts, addAccount } from './database';

export interface DetectedAccountCandidate {
  key: string;              // unique candidate identifier e.g. "HDFC_4092_bank"
  bankName: string;         // e.g. "HDFC Bank"
  accountType: 'bank' | 'credit_card';
  last4Digits: string;      // e.g. "4092"
  suggestedName: string;    // e.g. "HDFC Bank ••4092" or "ICICI Credit Card ••8102"
  balance: number;          // latest available balance or 0
  latestSmsDate: number;    // timestamp ms
  smsCount: number;         // number of SMS detected for this account
  isAlreadyAdded?: boolean; // true if already in user's DB
}

export interface AccountScanResult {
  newCandidates: DetectedAccountCandidate[];
  existingAccounts: DetectedAccountCandidate[];
  totalSmsScanned: number;
}

// ── Bank Identification Dictionary ───────────────────────────────────────────

interface BankDefinition {
  name: string;
  senderCodes: string[];
  bodyKeywords: string[];
  defaultType?: 'bank' | 'credit_card';
}

const BANK_REGISTRY: BankDefinition[] = [
  {
    name: 'HDFC Bank',
    senderCodes: ['HDFCBK', 'HDFC', 'HDFCB', 'HDFCCC'],
    bodyKeywords: ['hdfc bank', 'hdfc'],
  },
  {
    name: 'State Bank of India',
    senderCodes: ['SBIINB', 'SBIPSG', 'SBIUPI', 'SBIRRN', 'SBISMS', 'SBINET', 'SBI'],
    bodyKeywords: ['state bank of india', 'sbi'],
  },
  {
    name: 'SBI Card',
    senderCodes: ['SBICRD', 'SBICARD'],
    bodyKeywords: ['sbi card', 'sbicard'],
    defaultType: 'credit_card',
  },
  {
    name: 'ICICI Bank',
    senderCodes: ['ICICIB', 'ICICI', 'ICICIC', 'ICICIT'],
    bodyKeywords: ['icici bank', 'icici'],
  },
  {
    name: 'Axis Bank',
    senderCodes: ['AXISBK', 'AXIS', 'AXISCC', 'AXISTX'],
    bodyKeywords: ['axis bank', 'axis'],
  },
  {
    name: 'Kotak Mahindra Bank',
    senderCodes: ['KOTAKB', 'KOTAK', 'KMB', 'KOTAKN'],
    bodyKeywords: ['kotak bank', 'kotak mahindra', 'kotak'],
  },
  {
    name: 'Punjab National Bank',
    senderCodes: ['PNBSMS', 'PNB', 'PUNJAB'],
    bodyKeywords: ['punjab national bank', 'pnb'],
  },
  {
    name: 'Bank of Baroda',
    senderCodes: ['BOBTXN', 'BOB', 'BOBALT', 'BARODA'],
    bodyKeywords: ['bank of baroda', 'baroda'],
  },
  {
    name: 'Canara Bank',
    senderCodes: ['CANBNK', 'CANARA', 'CNRB'],
    bodyKeywords: ['canara bank', 'canara'],
  },
  {
    name: 'IndusInd Bank',
    senderCodes: ['INDUSB', 'INDUS', 'INDUSI'],
    bodyKeywords: ['indusind bank', 'indusind'],
  },
  {
    name: 'Federal Bank',
    senderCodes: ['FEDBNK', 'FEDERA', 'FEDB'],
    bodyKeywords: ['federal bank'],
  },
  {
    name: 'IDFC FIRST Bank',
    senderCodes: ['IDFCFB', 'IDFC', 'IDFCB'],
    bodyKeywords: ['idfc first bank', 'idfc first', 'idfc'],
  },
  {
    name: 'Yes Bank',
    senderCodes: ['YESBNK', 'YES', 'YESB'],
    bodyKeywords: ['yes bank'],
  },
  {
    name: 'RBL Bank',
    senderCodes: ['RBLBNK', 'RBL', 'RATNAKAR'],
    bodyKeywords: ['rbl bank', 'ratnakar'],
  },
  {
    name: 'AU Small Finance Bank',
    senderCodes: ['AUBLTD', 'AUBANK', 'AUBNK'],
    bodyKeywords: ['au bank', 'au small finance'],
  },
  {
    name: 'Standard Chartered',
    senderCodes: ['SCBANK', 'STANCHAR', 'SCB'],
    bodyKeywords: ['standard chartered', 'sc bank', 'stan chart'],
  },
  {
    name: 'Citibank',
    senderCodes: ['CITIBK', 'CITI'],
    bodyKeywords: ['citibank', 'citi'],
  },
  {
    name: 'American Express',
    senderCodes: ['AMEXIN', 'AMEX'],
    bodyKeywords: ['american express', 'amex'],
    defaultType: 'credit_card',
  },
  {
    name: 'Union Bank of India',
    senderCodes: ['UNIONB', 'UBI', 'UBIN'],
    bodyKeywords: ['union bank of india', 'union bank'],
  },
  {
    name: 'Bank of India',
    senderCodes: ['BOISMS', 'BOI'],
    bodyKeywords: ['bank of india'],
  },
  {
    name: 'Indian Bank',
    senderCodes: ['INDBNK', 'INDIAN'],
    bodyKeywords: ['indian bank'],
  },
  {
    name: 'Central Bank of India',
    senderCodes: ['CENTBK', 'CBI'],
    bodyKeywords: ['central bank of india', 'central bank'],
  },
  {
    name: 'Indian Overseas Bank',
    senderCodes: ['IOBCHN', 'IOB'],
    bodyKeywords: ['indian overseas bank', 'iob'],
  },
  {
    name: 'UCO Bank',
    senderCodes: ['UCOBNK', 'UCO'],
    bodyKeywords: ['uco bank'],
  },
  {
    name: 'IDBI Bank',
    senderCodes: ['IDBIBK', 'IDBI'],
    bodyKeywords: ['idbi bank', 'idbi'],
  },
  {
    name: 'DBS Bank',
    senderCodes: ['DBSBNK', 'DBS', 'DIGIBK'],
    bodyKeywords: ['dbs bank', 'digibank', 'dbs'],
  },
  {
    name: 'HSBC',
    senderCodes: ['HSBCIN', 'HSBC'],
    bodyKeywords: ['hsbc bank', 'hsbc'],
  },
  {
    name: 'Paytm Payments Bank',
    senderCodes: ['PAYTMB', 'PAYTM'],
    bodyKeywords: ['paytm bank', 'paytm payments bank'],
  },
  {
    name: 'Airtel Payments Bank',
    senderCodes: ['AIRTEL', 'AIRTELPB'],
    bodyKeywords: ['airtel payments bank', 'airtel money'],
  },
  {
    name: 'Jio Payments Bank',
    senderCodes: ['JIOBNK', 'JIO'],
    bodyKeywords: ['jio payments bank'],
  },
  {
    name: 'South Indian Bank',
    senderCodes: ['SIBLTD', 'SIB'],
    bodyKeywords: ['south indian bank'],
  },
  {
    name: 'Karnataka Bank',
    senderCodes: ['KBLTXN', 'KTKBNK', 'KBL'],
    bodyKeywords: ['karnataka bank'],
  },
  {
    name: 'Karur Vysya Bank',
    senderCodes: ['KVBANK', 'KVB'],
    bodyKeywords: ['karur vysya bank', 'kvb'],
  },
  {
    name: 'Bandhan Bank',
    senderCodes: ['BNDHN', 'BANDHAN'],
    bodyKeywords: ['bandhan bank'],
  },
];

// Normalize Indian SMS sender headers like "VM-HDFCBK-A", "AD-SBIINB", "VK-ICICIB", "BP-AXISBK"
function resolveBankFromSender(address?: string): BankDefinition | null {
  if (!address) return null;
  const cleanAddr = address.toUpperCase().replace(/[^A-Z0-9]/g, '');

  for (const bank of BANK_REGISTRY) {
    for (const code of bank.senderCodes) {
      if (cleanAddr.includes(code)) {
        return bank;
      }
    }
  }
  return null;
}

function resolveBankFromBody(body: string): BankDefinition | null {
  const lower = body.toLowerCase();
  for (const bank of BANK_REGISTRY) {
    for (const kw of bank.bodyKeywords) {
      const re = new RegExp(`\\b${kw}\\b`, 'i');
      if (re.test(lower)) {
        return bank;
      }
    }
  }
  return null;
}

// ── Balance Regex ────────────────────────────────────────────────────────────
const BALANCE_RE =
  /(?:avail(?:able)?\s*(?:bal(?:ance)?)?|avl\.?\s*bal\.?|avbl\.?\s*bal\.?|a\/c\s*bal\.?|bal(?:ance)?\s*(?:is|:)?|outstanding)\s*(?::?\s*)(?:inr|rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)(?:\s*\b(cr|dr)\b)?/i;

function extractBalance(body: string): number | null {
  const match = body.match(BALANCE_RE);
  if (!match) return null;
  const num = parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(num) ? num : null;
}

// Credit card indicators
const CC_CONTEXT_RE = /\b(?:credit\s*card|creditcard|card\s*ending|spent\s*on\s*card|card\s*no\.?|limit\s*avail|statement\s*for\s*card|min(?:imum)?\s*due|total\s*due|sbicrd)\b/i;

// ── Permissions Helper ───────────────────────────────────────────────────────

export async function checkSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
  } catch {
    return false;
  }
}

export async function requestSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      {
        title: 'SMS Permission Required',
        message:
          'Echo Spend reads financial SMS strictly on-device to detect your bank accounts and credit cards. Your messages never leave your phone.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      }
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

// ── Account Detection Core ───────────────────────────────────────────────────

export interface DetectAccountsOptions {
  daysBack?: number;
  maxMessages?: number;
}

// ── Directional & Role-Aware Patterns for Account Detection ─────────────────

function isCreditSms(body: string): boolean {
  const b = body.toLowerCase();
  if (
    /\b(?:debited|spent|withdrawn|paid|payment\s+of)\b/i.test(b) &&
    !/\bpayment\s+received\b/i.test(b)
  ) {
    return false;
  }
  return /\b(?:credited|deposited|salary|refund|cashback|received\s+in|payment\s+received)\b/i.test(
    b
  );
}

// Beneficiary / receiving account patterns in debit or transfer-out SMS
const BENEFICIARY_PATTERNS = [
  // to ... a/c ending 5678 / transfer to John A/c 5678 / sent to Ramesh (a/c 5678)
  // (guarding against "your a/c" or "ur a/c")
  /(?:to|towards|sent\s+to|transfer(?:red)?\s+to|trf\s+to|paid\s+to)\s+(?!(?:your|ur)\b)[^.;\n]{0,50}?(?:a\/c|account|card)\s*(?:ending\s*(?:with|in)?\s*)?[:\s]*[*xX.\d]*?(\d{3,4})\b/gi,
  // beneficiary / payee / bene / dest / recipient a/c ending 5678
  /\b(?:bene(?:ficiary)?|payee|recipient|dest(?:ination)?|target)\s*(?:a\/c|acct?|account|no\.?)?\s*(?:ending\s*(?:with|in)?\s*)?[:\s]*[*xX.\d]*?(\d{3,4})\b/gi,
  // in favor of ... a/c 5678
  /in\s+favo(?:u)?r\s+of\s+[^.;\n]{0,40}?(?:a\/c|account)?\s*[*xX.\d]*?(\d{3,4})\b/gi,
  // in debit SMS: credited to ... a/c 5678
  /credited\s+to\s+(?!(?:your|ur)\b)[^.;\n]{0,30}?(?:a\/c|account)?\s*[*xX.\d]*?(\d{3,4})\b/gi,
  // to a/c *5678 / to *5678 / To A/c ending 5678
  /\bto\s+(?!(?:your|ur)\b)(?:a\/c|acct?|account)\s*(?:ending\s*(?:with|in)?\s*)?[:\s]*[*xX.\d]*?(\d{3,4})\b/gi,
  /\bto\s+[*xX.]{1,}(\d{3,4})\b/gi,
  /\btrf\s+to\s*[*xX.]{1,}(\d{3,4})\b/gi,
];

// In credit / inbound SMS: remitter or sending counterparty account
const REMITTER_PATTERNS = [
  /(?:from|remitter|sender|by\s+transfer\s+from)\s+(?!(?:your|ur)\b)[^.;\n]{0,30}?(?:a\/c|account)?\s*[:\s]*[*xX.\d]*?(\d{3,4})\b/gi,
];

// Masked mobile numbers: e.g. "mobile 98XXXX5678" or "linked to mobile"
const MOBILE_PATTERNS = [
  /(?:mobile|phone|mob)\s*(?:no\.?|number)?\s*[:\s]*[*xX\d]*?(\d{4})\b/gi,
  /linked\s+to\s+mobile\s*[*xX\d]*?(\d{4})\b/gi,
];

// User own card patterns
const CARD_PATTERNS = [
  /(?:credit\s*card|card)\s*(?:ending\s*(?:with|in)?|no\.?|number)?\s*[:\s]*[*xX.\d]*?(\d{4})\b/gi,
  /(?:spent\s+on|used\s+on)\s+[^.]+?card\s+[*xX.\d]*?(\d{4})\b/gi,
  /\b[*xX.]{2,}\s*(\d{4})\s*(?:credit\s*card|card)\b/gi,
  /received\s+towards\s+(?:your\s+)?(?:card|account|sbi\s+card)\s*(?:ending\s*)?[:\s]*[*xX.\d]*?(\d{4})\b/gi,
  /\b(?:ending|ending\s+in)\s+(\d{4})\b/gi,
];

// User own bank account patterns
const BANK_OWN_PATTERNS = [
  // debited from your / ur a/c or debited from a/c
  /(?:debited\s+from|deducted\s+from|withdrawn\s+(?:at\s+atm\s+)?from|paid\s+from|drawn\s+on)\s+(?:your\s+|ur\s+)?(?:a\/c|account)\s*[:\s]*[*xX.\d]*?(\d{3,4})\b/gi,
  // from your a/c ...
  /from\s+(?:your\s+|ur\s+)?(?:a\/c|account)\s*(?:ending\s*(?:with|in)?\s*)?[:\s]*[*xX.\d]*?(\d{3,4})\b/gi,
  // your a/c 1234 is debited / credited
  /(?:your|ur)\s+(?:a\/c|account)\s*(?:ending\s*(?:with|in)?\s*)?[:\s]*[*xX.\d]*?(\d{3,4})\s+(?:is|has\s+been|was)?\s*(?:debited|credited)/gi,
  // a/c 1234 debited / credited / for ...
  /(?:a\/c|acct?|account)\s*[:\s]*[*xX.\d]*?(\d{3,4})\s+(?:is|has\s+been|was)?\s*(?:debited|credited|for)/gi,
  // credited to your a/c / deposited in your a/c
  /(?:credited\s+with\s+[^.]+?to|credited\s+to|deposited\s+in|received\s+in)\s+(?:your\s+|ur\s+)?(?:a\/c|account)\s*[:\s]*[*xX.\d]*?(\d{3,4})\b/gi,
  // Standard a/c pattern (disambiguated by counterparty filtering)
  /(?:a\/c|acct?|account)\s*(?:no\.?|number)?\s*(?:ending\s*(?:with|in)?|with\s*no\.?)?\s*[:\s]*[*xX.\d]*?(\d{3,4})\b/gi,
  // Masked run with 2+ mask characters (*, x, X, .)
  /\b[*xX.]{2,}(\d{3,4})\b/gi,
];

/**
 * Extracts candidate 3-4 digit account identifiers belonging to the USER from an SMS body,
 * rigorously filtering out beneficiary, payee, and receiving accounts.
 */
function extractAccountDigits(
  body: string,
  isCc: boolean
): Array<{ digits: string; type: 'bank' | 'credit_card' }> {
  const isCredit = isCreditSms(body);
  const counterpartySet = new Set<string>();
  const mobileSet = new Set<string>();

  // 1. Collect masked mobile numbers so they are never treated as accounts
  for (const pat of MOBILE_PATTERNS) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(body)) !== null) {
      if (m[1]) mobileSet.add(m[1]);
    }
  }

  // 2. Identify counterparty (beneficiary in debit, remitter in credit)
  const cpPatterns = isCredit ? REMITTER_PATTERNS : BENEFICIARY_PATTERNS;
  for (const pat of cpPatterns) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(body)) !== null) {
      if (m[1]) counterpartySet.add(m[1]);
    }
  }

  const rawCandidates: Array<{ digits: string; type: 'bank' | 'credit_card' }> = [];

  // 3. Extract Credit Card candidates
  for (const pat of CARD_PATTERNS) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(body)) !== null) {
      if (m[1] && m[1].length === 4) {
        rawCandidates.push({ digits: m[1], type: 'credit_card' });
      }
    }
  }

  // 4. Extract Bank Account candidates
  for (const pat of BANK_OWN_PATTERNS) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(body)) !== null) {
      if (m[1] && m[1].length >= 3 && m[1].length <= 4) {
        rawCandidates.push({ digits: m[1], type: isCc ? 'credit_card' : 'bank' });
      }
    }
  }

  // 5. Filter out:
  //    - Any number identified as a receiving / counterparty account
  //    - Any number identified as a mobile phone suffix
  //    - Calendar years (2023, 2024, 2025, 2026, 2027)
  const INVALID_YEARS = new Set(['2023', '2024', '2025', '2026', '2027']);
  const seen = new Set<string>();
  const filtered: Array<{ digits: string; type: 'bank' | 'credit_card' }> = [];

  for (const item of rawCandidates) {
    if (
      !counterpartySet.has(item.digits) &&
      !mobileSet.has(item.digits) &&
      !INVALID_YEARS.has(item.digits) &&
      !seen.has(item.digits)
    ) {
      seen.add(item.digits);
      filtered.push(item);
    }
  }

  return filtered;
}

/**
 * Scans SMS messages on the device and returns detected bank accounts and credit cards.
 */
export async function detectAccountsFromSms(
  options: DetectAccountsOptions = {}
): Promise<AccountScanResult> {
  const { daysBack = 365, maxMessages = 3000 } = options;

  if (Platform.OS !== 'android') {
    return { newCandidates: [], existingAccounts: [], totalSmsScanned: 0 };
  }

  const hasPermission = await checkSmsPermission();
  if (!hasPermission) {
    return { newCandidates: [], existingAccounts: [], totalSmsScanned: 0 };
  }

  // Load existing accounts for comparison
  let existingDbAccounts: Account[] = [];
  try {
    existingDbAccounts = await getAccounts();
  } catch (e) {
    console.warn('[AccountDetector] Could not fetch existing accounts:', e);
  }

  let SMSModule: any;
  try {
    SMSModule = require('react-native-get-sms-android');
  } catch {
    return { newCandidates: [], existingAccounts: [], totalSmsScanned: 0 };
  }
  const SmsAndroid = SMSModule?.default || SMSModule;
  if (!SmsAndroid?.list) {
    return { newCandidates: [], existingAccounts: [], totalSmsScanned: 0 };
  }

  const minDate = daysBack > 0 ? Date.now() - daysBack * 24 * 60 * 60 * 1000 : 0;

  const rawMessages = await new Promise<Array<{ address?: string; body: string; date: number }>>(
    (resolve) => {
      SmsAndroid.list(
        JSON.stringify({
          box: 'inbox',
          maxCount: maxMessages,
          indexFrom: 0,
          minDate,
        }),
        () => resolve([]),
        (_: number, list: string) => {
          try {
            const parsed = JSON.parse(list) as any[];
            resolve(
              parsed.map((s) => ({
                address: s.address as string | undefined,
                body: (s.body || '') as string,
                date: (s.date || Date.now()) as number,
              }))
            );
          } catch {
            resolve([]);
          }
        }
      );
    }
  );

  const candidateMap = new Map<string, DetectedAccountCandidate>();

  for (const msg of rawMessages) {
    const { address, body, date } = msg;
    if (!body || body.length < 15) continue;

    // 1. Identify bank from sender or body
    const bank = resolveBankFromSender(address) || resolveBankFromBody(body);
    if (!bank) continue;

    const isCcContext = CC_CONTEXT_RE.test(body) || bank.defaultType === 'credit_card';
    const extracted = extractAccountDigits(body, isCcContext);
    if (extracted.length === 0) continue;

    const balance = extractBalance(body);

    for (const item of extracted) {
      const type = bank.defaultType === 'credit_card' ? 'credit_card' : item.type;
      const key = `${bank.name}_${type}_${item.digits}`;
      const existing = candidateMap.get(key);

      if (!existing) {
        candidateMap.set(key, {
          key,
          bankName: bank.name,
          accountType: type,
          last4Digits: item.digits,
          suggestedName:
            type === 'credit_card'
              ? `${bank.name} Card ••${item.digits}`
              : `${bank.name} ••${item.digits}`,
          balance: balance ?? 0,
          latestSmsDate: date,
          smsCount: 1,
        });
      } else {
        existing.smsCount += 1;
        if (date > existing.latestSmsDate) {
          existing.latestSmsDate = date;
          if (balance !== null) existing.balance = balance;
        }
      }
    }
  }

  // 4. Split candidates into new vs already existing
  const newCandidates: DetectedAccountCandidate[] = [];
  const existingAccounts: DetectedAccountCandidate[] = [];

  for (const candidate of candidateMap.values()) {
    if (candidate.smsCount < 1) continue;

    // Check if this matches an existing account in DB
    const alreadyExists = existingDbAccounts.some((dbAcc) => {
      // Match by last 4 digits
      if (dbAcc.last4Digits && candidate.last4Digits) {
        if (dbAcc.last4Digits === candidate.last4Digits) {
          return true;
        }
      }
      // Or exact match on name
      if (dbAcc.name.trim().toLowerCase() === candidate.suggestedName.trim().toLowerCase()) {
        return true;
      }
      return false;
    });

    if (alreadyExists) {
      existingAccounts.push({ ...candidate, isAlreadyAdded: true });
    } else {
      newCandidates.push({ ...candidate, isAlreadyAdded: false });
    }
  }

  // Sort by recency & SMS frequency
  newCandidates.sort((a, b) => b.latestSmsDate - a.latestSmsDate || b.smsCount - a.smsCount);
  existingAccounts.sort((a, b) => b.latestSmsDate - a.latestSmsDate);

  return {
    newCandidates,
    existingAccounts,
    totalSmsScanned: rawMessages.length,
  };
}

// ── Batch Add Helper ─────────────────────────────────────────────────────────

/**
 * Saves a list of detected candidates to the database as registered accounts.
 */
export async function addDetectedAccounts(
  candidates: Array<{
    name: string;
    balance: number;
    accountType: 'bank' | 'credit_card' | 'wallet' | 'cash';
    last4Digits?: string;
  }>
): Promise<number[]> {
  const ids: number[] = [];
  const today = new Date().toISOString();

  for (const item of candidates) {
    try {
      const id = await addAccount({
        name: item.name.trim(),
        balance: item.balance || 0,
        accountType: item.accountType,
        last4Digits: item.last4Digits?.trim() || undefined,
        startDate: today,
        startingBalance: item.balance || 0,
        displayOrder: 0,
      });
      ids.push(id);
    } catch (err) {
      console.warn(`[AccountDetector] Failed to add account ${item.name}:`, err);
    }
  }

  return ids;
}
