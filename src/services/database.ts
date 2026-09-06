import * as SQLite from 'expo-sqlite';
import { hashSms } from './smsHash';
import { resolveCycle, cycleAnchorFrom, CycleAnchor, CycleWindow } from './salaryCycle';

export interface Category {
  id: number;
  name: string;
  icon: string;
  color: string;
  type: 'income' | 'expense' | 'transfer';
  parentId?: number;
}

export interface Transaction {
  id: number;
  amount: number;
  category: string;
  merchant: string;
  type: 'credit' | 'debit' | 'transfer';
  date: string;
  accountId?: number;
  toAccountId?: number;
  isConfirmed: boolean;
  rawSms?: string;
  isRecurring?: boolean;
  /**
   * A correction to make a running balance match reality — not spending, not
   * income. Moves the balance, excluded from every total and chart.
   */
  isAdjustment?: boolean;
  recurrenceRule?: string;
  notes?: string;
  subscriptionId?: number;
  goalId?: number;
  loanId?: number;
  confidence?: 'high' | 'medium' | 'low';
  source?: 'sms' | 'csv' | 'manual' | 'auto';
  /**
   * Whether the on-device AI has parsed this transaction. Real-time incoming SMS
   * are parsed REGEX-ONLY (the model can't safely load in the headless task), so
   * they're saved with aiEnriched=0 and later upgraded by the deferred AI
   * enrichment pass (see enrichPendingSmsWithAI) while still unconfirmed.
   */
  aiEnriched?: boolean;
  /** Indexed hash of rawSms — see isRawSmsAlreadyExists. Set automatically. */
  rawSmsHash?: string | null;
  isTransfer?: boolean;
  tags?: string[];
  balanceAfter?: number;
  splitMemberId?: number;
}

export interface Subscription {
  id: number;
  name: string;
  amount: number;
  category: string;
  frequency: 'monthly' | 'yearly' | 'weekly';
  nextDueDate: string;
  lastPaidDate?: string;
  isActive: boolean;
  /** Account to auto-debit when paying this subscription */
  debitAccountId?: number;
  /** Whether the cost is shared with others */
  splitEnabled?: boolean;
  /** JSON array of { name: string } objects — each person sharing this sub */
  splitMembers?: string;
  notes?: string;
  /**
   * The transaction that last advanced this subscription. Makes settling
   * idempotent: the same payment seen again on a later edit is a no-op.
   */
  lastPaidTxId?: number;
  /** Day of month the bill falls on, so short months don't move it for good. */
  billingDay?: number;
}

export interface Goal {
  id: number;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline?: string;
  category: string;
  isActive: boolean;
  /** Account from which contributions are pulled */
  linkedAccountId?: number;
  /** Planned monthly contribution amount */
  monthlyContribution?: number;
  notes?: string;
}

export interface Loan {
  id: number;
  lender: string;
  totalAmount: number;
  remainingAmount: number;
  emiAmount: number;
  nextDueDate: string;
  interestRate?: number;
  isActive: boolean;
  type: 'borrowed' | 'lent';
  /** Account from which EMI is debited (borrowed) or where repayments are credited (lent) */
  linkedAccountId?: number;
  /** Total loan tenure in months */
  tenure?: number;
  notes?: string;
}

export interface Account {
  id: number;
  name: string;
  balance: number;
  accountType: 'bank' | 'credit_card' | 'cash' | 'wallet';
  creditLimit?: number;
  /** Day-of-month (1–31) when the CC statement is generated */
  statementDay?: number;
  /** Day-of-month (1–31) when the CC bill payment is due */
  billDueDay?: number;
  startDate: string;
  lastScannedDate?: string;
  /** Last 4 digits of account/card number — used to match bank SMS to this account */
  last4Digits?: string;
  displayOrder: number;
  startingBalance: number;
}

export interface Budget {
  id: number;
  /**
   * User-given label for the budget. Absent (older rows, or a user who cleared
   * the field) → the label falls back to the category selection.
   */
  name?: string;
  /** primary category (first selection) — kept for display and back-compat */
  categoryName: string;
  /**
   * All selected category names. A name that is a parent category implicitly
   * covers its subcategories too. Absent/empty → treat as [categoryName].
   */
  categoryNames?: string[];
  amount: number;
  period: 'monthly' | 'weekly';
  startDate: string;
  /** carry last window's leftover (or overspend) into the current limit */
  rollover?: boolean;
}

export interface Insight {
  id: number;
  type: 'weekly_digest' | 'anomaly' | 'suggestion' | 'recurring_detected';
  title: string;
  body: string;
  generatedAt: string;
  dismissedAt?: string;
}

export interface Split {
  id: number;
  transactionId?: number;
  title: string;
  totalAmount: number;
  paidByAccountId?: number;
  receiveToAccountId?: number;
  date: string;
  notes?: string;
}

export interface SplitMember {
  id: number;
  splitId: number;
  name: string;
  share: number;
  isMe: boolean;
  isPaid: boolean;
  paidDate?: string;
  repaidToAccountId?: number;
}

export interface SplitWithStats extends Split {
  memberCount: number;
  pendingCount: number;
  collectedAmount: number;
  pendingAmount: number;
}

export interface MerchantMapping {
  id: number;
  merchantRaw: string;
  merchantClean: string;
  categoryName: string;
  usageCount: number;
}

export interface SpendTrendPoint {
  date: string;
  total: number;
}

export interface CategoryBreakdown {
  category: string;
  total: number;
  percentage: number;
  count: number;
}

let db: SQLite.SQLiteDatabase;
let initPromise: Promise<void> | null = null;

/** Close the current DB connection (call before overwriting the DB file on restore) */
export const closeDatabase = async () => {
  if (db) {
    try { await db.closeAsync(); } catch (_) { }
  }
  initPromise = null;
};

/**
 * Flush all WAL-mode pending writes into the main DB file.
 * Must be called before reading the .db file for backup, otherwise recent
 * writes sitting in the .db-wal file will be absent from the backup copy.
 */
export const checkpointWal = async () => {
  if (db) {
    try {
      await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (e) {
      console.error('[Database] WAL checkpoint failed:', e);
      throw e;
    }
  }
};

export const initDatabase = async () => {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      db = await SQLite.openDatabaseAsync('echospend.db');

      // Run pragmas individually — combining them in one execAsync call causes
      // a NullPointerException on some Android versions.
      await db.execAsync('PRAGMA journal_mode = WAL;');
      await db.execAsync('PRAGMA foreign_keys = ON;');

      // Create each table in its own execAsync — a single large multi-statement
      // block with FOREIGN KEY constraints reliably throws NullPointerException
      // on Android in expo-sqlite v2.
      await db.execAsync(`CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0,
        accountType TEXT NOT NULL DEFAULT 'bank',
        creditLimit REAL,
        statementDay INTEGER,
        billDueDay INTEGER,
        startDate TEXT NOT NULL,
        lastScannedDate TEXT,
        last4Digits TEXT,
        displayOrder INTEGER DEFAULT 0,
        startingBalance REAL DEFAULT 0
      );`);

      await db.execAsync(`CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        icon TEXT NOT NULL,
        color TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'expense',
        parentId INTEGER,
        FOREIGN KEY(parentId) REFERENCES categories(id) ON DELETE CASCADE,
        UNIQUE(name, parentId)
      );`);

      await db.execAsync(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount REAL NOT NULL,
        category TEXT NOT NULL,
        merchant TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'debit',
        date TEXT NOT NULL,
        accountId INTEGER,
        isConfirmed INTEGER DEFAULT 0,
        rawSms TEXT,
        isRecurring INTEGER DEFAULT 0,
        recurrenceRule TEXT,
        notes TEXT,
        subscriptionId INTEGER,
        goalId INTEGER,
        loanId INTEGER,
        confidence TEXT DEFAULT 'medium',
        source TEXT DEFAULT 'manual',
        isTransfer INTEGER DEFAULT 0,
        tags TEXT,
        balanceAfter REAL,
        toAccountId INTEGER,
        splitMemberId INTEGER,
        aiEnriched INTEGER DEFAULT 0,
        FOREIGN KEY(accountId) REFERENCES accounts(id) ON DELETE SET NULL,
        FOREIGN KEY(toAccountId) REFERENCES accounts(id) ON DELETE SET NULL,
        FOREIGN KEY(splitMemberId) REFERENCES split_members(id) ON DELETE SET NULL
      );`);

      await db.execAsync(`CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        categoryName TEXT NOT NULL,
        amount REAL NOT NULL,
        period TEXT NOT NULL DEFAULT 'monthly',
        startDate TEXT NOT NULL
      );`);

      await db.execAsync(`CREATE TABLE IF NOT EXISTS insights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        generatedAt TEXT NOT NULL,
        dismissedAt TEXT
      );`);

      await db.execAsync(`CREATE TABLE IF NOT EXISTS merchant_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        merchantRaw TEXT NOT NULL,
        merchantClean TEXT NOT NULL,
        categoryName TEXT NOT NULL,
        usageCount INTEGER DEFAULT 1,
        UNIQUE(merchantRaw)
      );`);

      await db.execAsync(`CREATE TABLE IF NOT EXISTS sms_hashes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL UNIQUE,
        processedAt TEXT NOT NULL
      );`);

      await db.execAsync(`CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        amount REAL NOT NULL,
        category TEXT NOT NULL,
        frequency TEXT NOT NULL DEFAULT 'monthly',
        nextDueDate TEXT NOT NULL,
        lastPaidDate TEXT,
        isActive INTEGER DEFAULT 1,
        debitAccountId INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
        splitEnabled INTEGER DEFAULT 0,
        splitMembers TEXT,
        notes TEXT
      );`);

      await db.execAsync(`CREATE TABLE IF NOT EXISTS goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        targetAmount REAL NOT NULL,
        currentAmount REAL NOT NULL DEFAULT 0,
        deadline TEXT,
        category TEXT NOT NULL,
        isActive INTEGER DEFAULT 1,
        linkedAccountId INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
        monthlyContribution REAL,
        notes TEXT
      );`);

      await db.execAsync(`CREATE TABLE IF NOT EXISTS loans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lender TEXT NOT NULL,
        totalAmount REAL NOT NULL,
        remainingAmount REAL NOT NULL,
        emiAmount REAL NOT NULL,
        nextDueDate TEXT NOT NULL,
        interestRate REAL,
        isActive INTEGER DEFAULT 1,
        type TEXT DEFAULT 'borrowed',
        linkedAccountId INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
        tenure INTEGER,
        notes TEXT
      );`);

      await db.execAsync(`CREATE TABLE IF NOT EXISTS splits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transactionId INTEGER,
        title TEXT NOT NULL,
        totalAmount REAL NOT NULL,
        paidByAccountId INTEGER,
        receiveToAccountId INTEGER,
        date TEXT NOT NULL,
        notes TEXT,
        FOREIGN KEY(transactionId) REFERENCES transactions(id) ON DELETE SET NULL,
        FOREIGN KEY(paidByAccountId) REFERENCES accounts(id) ON DELETE SET NULL,
        FOREIGN KEY(receiveToAccountId) REFERENCES accounts(id) ON DELETE SET NULL
      );`);

      await db.execAsync(`CREATE TABLE IF NOT EXISTS split_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        splitId INTEGER NOT NULL,
        name TEXT NOT NULL,
        share REAL NOT NULL,
        isMe INTEGER NOT NULL DEFAULT 0,
        isPaid INTEGER NOT NULL DEFAULT 0,
        paidDate TEXT,
        repaidToAccountId INTEGER,
        FOREIGN KEY(splitId) REFERENCES splits(id) ON DELETE CASCADE,
        FOREIGN KEY(repaidToAccountId) REFERENCES accounts(id) ON DELETE SET NULL
      );`);

      await db.execAsync(`CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );`);

      // Credit card statements. A statement is a frozen fact: totalDue is what the
      // bank billed at generation and never changes. Payments accumulate into
      // paidAmount, so `remaining` is totalDue - paidAmount — the same way a bank
      // shows a partially-paid bill.
      //
      // UNIQUE(accountId, dueDate) is the dedup key: banks re-send the same
      // reminder repeatedly until the due date (and sometimes after payment), and
      // every one of those must land on the SAME statement row.
      await db.execAsync(`CREATE TABLE IF NOT EXISTS card_statements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        accountId INTEGER NOT NULL,
        statementDate TEXT,
        dueDate TEXT NOT NULL,
        totalDue REAL NOT NULL,
        minimumDue REAL,
        paidAmount REAL NOT NULL DEFAULT 0,
        isPaid INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'sms',
        rawSms TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        UNIQUE(accountId, dueDate),
        FOREIGN KEY(accountId) REFERENCES accounts(id) ON DELETE CASCADE
      );`);
      await db.execAsync(
        'CREATE INDEX IF NOT EXISTS idx_card_statements_due ON card_statements(accountId, dueDate DESC);'
      );

      // Which transaction settled which statement, and for how much.
      //
      // Statement paidAmount used to be incremented in place, which is only safe
      // when a payment is seen exactly once — true while the only caller was SMS
      // ingest. A card payment is usually only *identifiable* later (the bank's
      // SMS says money left the account, not that a card was paid), so the same
      // transaction gets re-examined on every edit. UNIQUE(transactionId) is what
      // makes that safe: re-applying replaces the row instead of paying twice,
      // and deleting the transaction gives the amount back.
      await db.execAsync(`CREATE TABLE IF NOT EXISTS card_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transactionId INTEGER NOT NULL,
        statementId INTEGER NOT NULL,
        accountId INTEGER NOT NULL,
        amount REAL NOT NULL,
        appliedAt TEXT NOT NULL,
        UNIQUE(transactionId, statementId),
        FOREIGN KEY(transactionId) REFERENCES transactions(id) ON DELETE CASCADE,
        FOREIGN KEY(statementId) REFERENCES card_statements(id) ON DELETE CASCADE
      );`);
      await db.execAsync(
        'CREATE INDEX IF NOT EXISTS idx_card_payments_stmt ON card_payments(statementId);'
      );
      await db.execAsync(
        'CREATE INDEX IF NOT EXISTS idx_card_payments_tx ON card_payments(transactionId);'
      );

      // Actual salary arrivals the user has confirmed. The budget cycle is
      // anchored on these rather than a recurring day-of-month, because payroll
      // moves (30th, then 31st, then the 1st). UNIQUE on the instant so the same
      // salary can't be recorded twice by a manual entry and a detection.
      await db.execAsync(`CREATE TABLE IF NOT EXISTS salary_dates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurredAt TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL DEFAULT 'manual',
        createdAt TEXT NOT NULL
      );`);
      await db.execAsync(
        'CREATE INDEX IF NOT EXISTS idx_salary_dates_occurred ON salary_dates(occurredAt DESC);'
      );

      // Tombstones for default categories the user deliberately deleted.
      // seedDatabase() runs on EVERY initDatabase() — including in the fresh JS
      // context of each headless background task — and decides what to insert by
      // asking "does this category exist?". Without a record of intent it cannot
      // tell a user's deletion from a fresh install, so it kept resurrecting
      // deleted defaults minutes later. `parentName` is NULL for a top-level
      // category; subcategory names are only unique within their parent.
      await db.execAsync(`CREATE TABLE IF NOT EXISTS deleted_default_categories (
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        parentName TEXT,
        deletedAt TEXT NOT NULL
      );`);
      await db.execAsync(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_deleted_default_categories
         ON deleted_default_categories(name, type, IFNULL(parentName, ''));`
      );

      // Run Migrations & Seeding
      await runMigrations();
      await seedDatabase();
      // await seedMockData();
    } catch (err) {
      initPromise = null; // Reset on failure so we can retry
      throw err;
    }
  })();

  return initPromise;
};

const runMigrations = async () => {
  // Indexes
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC);');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_transactions_confirmed ON transactions(isConfirmed);');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_subscriptions_next ON subscriptions(nextDueDate);');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_goals_category ON goals(category);');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_transactions_dedup ON transactions(amount, type, accountId, date);');

  // Legacy migrations (catch failures if columns already exist)
  const migrations = [
    'ALTER TABLE budgets ADD COLUMN rollover INTEGER DEFAULT 0',
    'ALTER TABLE budgets ADD COLUMN categoryNames TEXT',
    'ALTER TABLE budgets ADD COLUMN name TEXT',
    // What the BANK told us was already paid, kept apart from what our own
    // ledger accounts for. paidAmount is the greater of the two — the bank's
    // figure already includes payments we may have matched ourselves, so adding
    // them would double count.
    'ALTER TABLE card_statements ADD COLUMN reportedPaid REAL NOT NULL DEFAULT 0',
    'ALTER TABLE subscriptions ADD COLUMN lastPaidTxId INTEGER REFERENCES transactions(id) ON DELETE SET NULL',
    'ALTER TABLE subscriptions ADD COLUMN billingDay INTEGER',
    'ALTER TABLE transactions ADD COLUMN isAdjustment INTEGER DEFAULT 0',
    'ALTER TABLE transactions ADD COLUMN isRecurring INTEGER DEFAULT 0',
    'ALTER TABLE transactions ADD COLUMN recurrenceRule TEXT',
    'ALTER TABLE transactions ADD COLUMN notes TEXT',
    'ALTER TABLE accounts ADD COLUMN accountType TEXT DEFAULT "bank"',
    'ALTER TABLE accounts ADD COLUMN creditLimit REAL',
    'ALTER TABLE accounts ADD COLUMN dueDate TEXT',
    'ALTER TABLE accounts ADD COLUMN statementDay INTEGER',
    'ALTER TABLE accounts ADD COLUMN billDueDay INTEGER',
    'ALTER TABLE categories ADD COLUMN parentId INTEGER REFERENCES categories(id) ON DELETE CASCADE',
    'ALTER TABLE transactions ADD COLUMN subscriptionId INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL',
    'ALTER TABLE transactions ADD COLUMN goalId INTEGER REFERENCES goals(id) ON DELETE SET NULL',
    'ALTER TABLE transactions ADD COLUMN loanId INTEGER REFERENCES loans(id) ON DELETE SET NULL',
    'ALTER TABLE transactions ADD COLUMN confidence TEXT DEFAULT "medium"',
    'ALTER TABLE loans ADD COLUMN type TEXT DEFAULT "borrowed"',
    'ALTER TABLE transactions ADD COLUMN source TEXT DEFAULT "manual"',
    'ALTER TABLE transactions ADD COLUMN isTransfer INTEGER DEFAULT 0',
    'ALTER TABLE transactions ADD COLUMN tags TEXT',
    'ALTER TABLE accounts ADD COLUMN last4Digits TEXT',
    'ALTER TABLE subscriptions ADD COLUMN debitAccountId INTEGER REFERENCES accounts(id) ON DELETE SET NULL',
    'ALTER TABLE subscriptions ADD COLUMN splitEnabled INTEGER DEFAULT 0',
    'ALTER TABLE subscriptions ADD COLUMN splitMembers TEXT',
    'ALTER TABLE subscriptions ADD COLUMN notes TEXT',
    'ALTER TABLE goals ADD COLUMN linkedAccountId INTEGER REFERENCES accounts(id) ON DELETE SET NULL',
    'ALTER TABLE goals ADD COLUMN monthlyContribution REAL',
    'ALTER TABLE goals ADD COLUMN notes TEXT',
    'ALTER TABLE loans ADD COLUMN linkedAccountId INTEGER REFERENCES accounts(id) ON DELETE SET NULL',
    'ALTER TABLE loans ADD COLUMN tenure INTEGER',
    'ALTER TABLE loans ADD COLUMN notes TEXT',
    'ALTER TABLE accounts ADD COLUMN displayOrder INTEGER DEFAULT 0',
    'ALTER TABLE transactions ADD COLUMN balanceAfter REAL',
    'ALTER TABLE accounts ADD COLUMN startingBalance REAL DEFAULT 0',
    'ALTER TABLE transactions ADD COLUMN toAccountId INTEGER REFERENCES accounts(id) ON DELETE SET NULL',
  ];
  for (const m of migrations) {
    try { await db.execAsync(m); } catch (_) { }
  }

  // Versioned one-time migrations using PRAGMA user_version
  const versionRow = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const dbVersion = versionRow?.user_version ?? 0;

  if (dbVersion < 1) {
    await db.execAsync('DELETE FROM sms_hashes');
    await db.execAsync('PRAGMA user_version = 1');
  }

  if (dbVersion < 2) {
    await db.execAsync('PRAGMA foreign_keys = OFF');
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS categories_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        icon TEXT NOT NULL,
        color TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'expense',
        parentId INTEGER,
        FOREIGN KEY(parentId) REFERENCES categories_new(id) ON DELETE CASCADE,
        UNIQUE(name, parentId)
      )
    `);
    await db.execAsync(`
      INSERT OR IGNORE INTO categories_new (id, name, icon, color, type, parentId)
      SELECT id, name, icon, color, type, parentId FROM categories
    `);
    await db.execAsync('DROP TABLE categories');
    await db.execAsync('ALTER TABLE categories_new RENAME TO categories');
    await db.execAsync('PRAGMA foreign_keys = ON');
    await db.execAsync('PRAGMA user_version = 2');
  }

  if (dbVersion < 3) {
    const lucideToEmoji: Record<string, string> = {
      Coffee: '☕', Car: '🚗', ShoppingBag: '🛍️', Zap: '⚡', Tv: '📺',
      Heart: '❤️', TrendingUp: '📈', Briefcase: '💼', RotateCw: '🔄',
      HelpCircle: '⭐', Folder: '📁', Wallet: '👛', Banknote: '💵',
      Coins: '🪙', PiggyBank: '🐷', CreditCard: '💳', Landmark: '🏦',
      Calculator: '🧮', Gift: '🎁', Utensils: '🍽️', IceCream: '🍦',
      Candy: '🍬', Beer: '🍺', Wine: '🍷', Pizza: '🍕', Bus: '🚌',
      Train: '🚂', Plane: '✈️', Bike: '🚲', Ship: '🚢', Truck: '🚛',
      Globe: '🌍', Palmtree: '🌴', Home: '🏠', Baby: '👶', Cat: '🐈',
      Dog: '🐕', Shirt: '👕', Key: '🔑', Lock: '🔒', Umbrella: '☂️',
      Gamepad2: '🎮', Film: '🎬', Clapboard: '🎬', Music: '🎵',
      Headphones: '🎧', Monitor: '🖥️', Smartphone: '📱', Mic: '🎤',
      Wifi: '📶', Stethoscope: '🩺', Pill: '💊', Dumbbell: '💪',
      GraduationCap: '🎓', Book: '📚', Library: '📖', Wrench: '🔧',
      Hammer: '🔨', Palette: '🎨', PenTool: '✏️', Camera: '📷',
      Lightbulb: '💡', Flower2: '🌸', Leaf: '🌿', Sun: '🌞',
      Moon: '🌙', Star: '⭐', Disc: '💿', Printer: '🖨️',
    };
    for (const [lucideName, emoji] of Object.entries(lucideToEmoji)) {
      await db.runAsync('UPDATE categories SET icon = ? WHERE icon = ?', emoji, lucideName);
    }
    await db.execAsync('PRAGMA user_version = 3');
  }

  if (dbVersion < 4) {
    await db.execAsync(`
      DELETE FROM categories 
      WHERE id NOT IN (
        SELECT MIN(id) 
        FROM categories 
        GROUP BY name, IFNULL(parentId, 0)
      )
    `);
    await db.execAsync('PRAGMA user_version = 4');
  }

  if (dbVersion < 5) {
    try {
      await db.execAsync(
        'ALTER TABLE transactions ADD COLUMN splitMemberId INTEGER REFERENCES split_members(id) ON DELETE SET NULL'
      );
    } catch (e) {
      console.warn('[Database] Migration to v5 warning:', e);
    }
    await db.execAsync('PRAGMA user_version = 5');
  }

  if (dbVersion < 6) {
    try {
      await db.execAsync('ALTER TABLE transactions ADD COLUMN aiEnriched INTEGER DEFAULT 0');
    } catch (e) {
      console.warn('[Database] Migration to v6 warning:', e);
    }
    await db.execAsync('PRAGMA user_version = 6');
  }

  if (dbVersion < 7) {
    try {
      await db.execAsync(`CREATE TABLE IF NOT EXISTS salary_dates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurredAt TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL DEFAULT 'manual',
        createdAt TEXT NOT NULL
      )`);
      await db.execAsync(
        'CREATE INDEX IF NOT EXISTS idx_salary_dates_occurred ON salary_dates(occurredAt DESC)'
      );
    } catch (e) {
      console.warn('[Database] Migration to v7 warning:', e);
    }
    await db.execAsync('PRAGMA user_version = 7');
  }

  if (dbVersion < 8) {
    try {
      await db.execAsync(`CREATE TABLE IF NOT EXISTS card_statements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        accountId INTEGER NOT NULL,
        statementDate TEXT,
        dueDate TEXT NOT NULL,
        totalDue REAL NOT NULL,
        minimumDue REAL,
        paidAmount REAL NOT NULL DEFAULT 0,
        isPaid INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'sms',
        rawSms TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        UNIQUE(accountId, dueDate),
        FOREIGN KEY(accountId) REFERENCES accounts(id) ON DELETE CASCADE
      )`);
      await db.execAsync(
        'CREATE INDEX IF NOT EXISTS idx_card_statements_due ON card_statements(accountId, dueDate DESC)'
      );
    } catch (e) {
      console.warn('[Database] Migration to v8 warning:', e);
    }
    await db.execAsync('PRAGMA user_version = 8');
  }

  if (dbVersion < 9) {
    // ── Query performance ──────────────────────────────────────────────────
    // EFFECTIVE_DEBIT_AMOUNT is a correlated subquery over splits/split_members
    // embedded in 11 aggregate queries. Without these two indexes SQLite
    // rescanned both tables for EVERY transaction row — measured at ~682ms for a
    // single dashboard+budgets load over 8k transactions, vs ~19ms with them.
    try {
      await db.execAsync(
        'CREATE INDEX IF NOT EXISTS idx_splits_transaction ON splits(transactionId)'
      );
      await db.execAsync(
        'CREATE INDEX IF NOT EXISTS idx_split_members_split ON split_members(splitId)'
      );
      // 21 queries filter on accountId. idx_transactions_dedup could not serve
      // them: `amount` is its leading column, so those lookups fell back to a scan.
      await db.execAsync(
        'CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(accountId)'
      );
      await db.execAsync(
        'CREATE INDEX IF NOT EXISTS idx_transactions_to_account ON transactions(toAccountId)'
      );
      // Statement lookups and the salary-cycle resolver.
      await db.execAsync(
        'CREATE INDEX IF NOT EXISTS idx_sms_hashes_processed ON sms_hashes(processedAt)'
      );
    } catch (e) {
      console.warn('[Database] Migration to v9 index warning:', e);
    }

    // ── Storage ────────────────────────────────────────────────────────────
    // idx_transactions_rawsms indexed the FULL SMS body to serve one exact-match
    // query, duplicating every message into the index B-tree. A short hash gives
    // the same lookup for a fraction of the space.
    try {
      await db.execAsync('DROP INDEX IF EXISTS idx_transactions_rawsms');
      await db.execAsync('ALTER TABLE transactions ADD COLUMN rawSmsHash TEXT');
      await db.execAsync(
        'CREATE INDEX IF NOT EXISTS idx_transactions_rawsms_hash ON transactions(rawSmsHash)'
      );
    } catch (e) {
      console.warn('[Database] Migration to v9 rawSmsHash warning:', e);
    }

    // Backfill existing rows so the hashed lookup is correct from day one.
    try {
      const rows = await db.getAllAsync<{ id: number; rawSms: string }>(
        "SELECT id, rawSms FROM transactions WHERE rawSms IS NOT NULL AND rawSms != '' AND rawSmsHash IS NULL"
      );
      for (const r of rows) {
        await db.runAsync(
          'UPDATE transactions SET rawSmsHash = ? WHERE id = ?', hashSms(r.rawSms), r.id
        );
      }
      if (rows.length > 0) console.log(`[Database] Backfilled ${rows.length} rawSmsHash values.`);
    } catch (e) {
      console.warn('[Database] Migration to v9 backfill warning:', e);
    }

    await db.execAsync('PRAGMA user_version = 9');
  }

  if (dbVersion < 10) {
    // Transactions reference categories by NAME, so two categories sharing a name
    // under different parents are indistinguishable: analytics collapsed them and
    // attributed all the spend to whichever parent was found first (Shopping >
    // Groceries silently counted under Food & Dining, Housing > Maintenance under
    // Transport).
    //
    // The lowest-id duplicate KEEPS its name, so existing transactions keep
    // resolving exactly where they resolve today — this renames only the ones that
    // were already unreachable. Suffixed with the parent so it stays recognizable
    // and the user can rename it to taste.
    try {
      const dupes = await db.getAllAsync<{ name: string }>(
        `SELECT name FROM categories GROUP BY name HAVING COUNT(*) > 1`
      );
      for (const { name } of dupes) {
        const rows = await db.getAllAsync<{ id: number; parentId: number | null }>(
          'SELECT id, parentId FROM categories WHERE name = ? ORDER BY id ASC', name
        );
        // Skip the first (the one transactions currently resolve to).
        for (const row of rows.slice(1)) {
          const parent = row.parentId
            ? await db.getFirstAsync<{ name: string }>(
                'SELECT name FROM categories WHERE id = ?', row.parentId
              )
            : null;
          const newName = parent ? `${name} (${parent.name})` : `${name} (2)`;
          const clash = await db.getFirstAsync<{ id: number }>(
            'SELECT id FROM categories WHERE name = ?', newName
          );
          if (clash) continue;
          await db.runAsync('UPDATE categories SET name = ? WHERE id = ?', newName, row.id);
          console.log(`[Database] Disambiguated duplicate category "${name}" → "${newName}"`);
        }
      }
    } catch (e) {
      console.warn('[Database] Migration to v10 warning:', e);
    }
    await db.execAsync('PRAGMA user_version = 10');
  }

  if (dbVersion < 11) {
    // Card payments were only ever applied at SMS ingest, and only for shapes
    // recognisable at that moment — which excluded the common case, a bank debit
    // the user later marks as a transfer to their card. Every such payment ever
    // recorded left its statement untouched and still showing as due.
    //
    // Replayed through the ledger, oldest first, restricted to statements whose
    // billing period actually contains each payment. Statements already settled
    // are left alone: this can only ever pay a bill down, never re-open one.
    try {
      const cards = await db.getAllAsync<{ id: number }>(
        "SELECT id FROM accounts WHERE accountType = 'credit_card'"
      );
      for (const c of cards) await resyncCardPayments(c.id);
      const settled = await db.getFirstAsync<{ n: number }>(
        'SELECT COUNT(*) as n FROM card_payments'
      );
      console.log(`[Database] v11: matched ${settled?.n ?? 0} card payments to statements.`);
    } catch (e) {
      console.warn('[Database] Migration to v11 warning:', e);
    }
    await db.execAsync('PRAGMA user_version = 11');
  }

  if (dbVersion < 12) {
    // Balance adjustments were plain debits and credits, so every total, chart,
    // budget gauge and safe-to-spend figure counted the user's own bookkeeping
    // corrections as real money. Flagged retroactively by the merchant name the
    // adjust-balance flow has always written.
    try {
      const res = await db.runAsync(
        "UPDATE transactions SET isAdjustment = 1 WHERE merchant = 'Balance Adjustment'"
      );
      console.log(`[Database] v12: excluded ${res.changes} balance adjustments from spend.`);
    } catch (e) {
      console.warn('[Database] Migration to v12 warning:', e);
    }
    await db.execAsync('PRAGMA user_version = 12');
  }
};

// ─── Default-category tombstones ─────────────────────────────────────────────

/** Stable identity for a seed entry. Subcategory names are unique per parent. */
const defaultCategoryKey = (name: string, type: string, parentName: string | null): string =>
  JSON.stringify([name, type, parentName ?? '']);

const getDeletedDefaultCategoryKeys = async (): Promise<Set<string>> => {
  const rows = await db.getAllAsync<{ name: string; type: string; parentName: string | null }>(
    'SELECT name, type, parentName FROM deleted_default_categories'
  );
  return new Set(rows.map((r) => defaultCategoryKey(r.name, r.type, r.parentName)));
};

/**
 * Record that the user deleted a category so seeding never brings it back.
 *
 * Written for every deletion, not just ones currently in the seed list: a name
 * that is not a default today may become one in a later app version, and the
 * user's intent should still hold.
 */
const tombstoneDeletedCategory = async (
  name: string,
  type: string,
  parentName: string | null,
) => {
  await db.runAsync(
    `INSERT OR IGNORE INTO deleted_default_categories (name, type, parentName, deletedAt)
     VALUES (?, ?, ?, ?)`,
    name, type, parentName, new Date().toISOString(),
  );
};

/**
 * Clear a tombstone so the category can be seeded again — called when the user
 * re-creates a category by hand, which is an explicit reversal of the deletion.
 */
const clearCategoryTombstone = async (
  name: string,
  type: string,
  parentName: string | null,
) => {
  await db.runAsync(
    `DELETE FROM deleted_default_categories
     WHERE name = ? AND type = ? AND IFNULL(parentName, '') = IFNULL(?, '')`,
    name, type, parentName,
  );
};

export const seedDatabase = async () => {
  // Seed initial categories (ensure base defaults always exist)
  const seedCategories: [string, string, string, string][] = [
    ['Food & Dining', '🍽️', '#FF9500', 'expense'],
    ['Transport', '🚗', '#30D158', 'expense'],
    ['Shopping', '🛍️', '#BF5AF2', 'expense'],
    ['Housing', '🏠', '#0A84FF', 'expense'],
    ['Utilities', '💡', '#32ADE6', 'expense'],
    ['Health', '💊', '#FF375F', 'expense'],
    ['Entertainment', '🎬', '#FF453A', 'expense'],
    ['Education', '🎓', '#5856D6', 'expense'],
    ['Travel', '🌍', '#00C7BE', 'expense'],
    ['Family', '❤️', '#FF2D55', 'expense'],
    ['Subscriptions', '📡', '#AF52DE', 'expense'],
    ['Personal Care', '🧴', '#FFCC00', 'expense'],
    ['Other', '⭐', '#8E8E93', 'expense'],
    ['Debt', '🤝', '#FF5E3A', 'expense'],
    ['Salary', '💰', '#34C759', 'income'],
    ['Freelance', '💻', '#5AC8FA', 'income'],
    ['Investments', '📈', '#30D158', 'income'],
    ['Other Income', '⭐', '#8E8E93', 'income'],
    ['Debt', '🤝', '#FF5E3A', 'income'],
    ['Transfer', '🔄', '#FF9500', 'transfer'],
  ];

  // Everything the user has deliberately deleted, loaded once. Seeding must skip
  // these or it resurrects them on the next init (see the tombstone table).
  const tombstones = await getDeletedDefaultCategoryKeys();

  for (const [name, icon, color, type] of seedCategories) {
    if (tombstones.has(defaultCategoryKey(name, type, null))) continue;
    const exists = await db.getFirstAsync('SELECT id FROM categories WHERE name = ? AND type = ? AND parentId IS NULL', name, type);
    if (!exists) {
      await db.runAsync('INSERT INTO categories (name, icon, color, type, parentId) VALUES (?, ?, ?, ?, NULL)', name, icon, color, type);
    }
  }

  const seedSub = async (parentName: string, subs: [string, string][], color: string) => {
    const parent = await db.getFirstAsync<{ id: number }>('SELECT id FROM categories WHERE name = ? AND parentId IS NULL', parentName);
    if (parent) {
      for (const [n, i] of subs) {
        if (tombstones.has(defaultCategoryKey(n, 'expense', parentName))) continue;
        const exists = await db.getFirstAsync('SELECT id FROM categories WHERE name = ? AND parentId = ?', n, parent.id);
        if (!exists) await db.runAsync('INSERT INTO categories (name, icon, color, type, parentId) VALUES (?, ?, ?, ?, ?)', n, i, color, 'expense', parent.id);
      }
    }
  };

  await seedSub('Food & Dining', [['Coffee & Cafes', '☕'], ['Groceries', '🛒'], ['Fast Food', '🍔'], ['Restaurants', '🍜'], ['Takeout & Delivery', '🥡'], ['Drinks & Alcohol', '🍺']], '#FF9500');
  await seedSub('Transport', [['Fuel', '⛽'], ['Taxi & Rides', '🚕'], ['Public Transit', '🚌'], ['Parking', '🅿️'], ['Flight', '✈️'], ['Maintenance', '🔧']], '#30D158');
  await seedSub('Shopping', [['Clothing', '👗'], ['Electronics', '📱'], ['Groceries', '🛒'], ['Gifts', '🎁'], ['Online Orders', '📦']], '#BF5AF2');
  await seedSub('Health', [['Doctor / Clinic', '🩺'], ['Pharmacy', '💊'], ['Gym & Fitness', '💪'], ['Dental', '🦷'], ['Lab Tests', '🧬']], '#FF375F');
  await seedSub('Housing', [['Rent', '🏠'], ['Maintenance', '🔧'], ['Property Tax', '🏦'], ['Home Insurance', '🛡️'], ['Furniture', '🪑']], '#0A84FF');
  await seedSub('Utilities', [['Electricity', '⚡'], ['Water', '💧'], ['Gas', '🔥'], ['Internet', '🌐'], ['Phone', '📱']], '#32ADE6');
  await seedSub('Entertainment', [['Movies', '🎬'], ['Gaming', '🎮'], ['Streaming', '📺'], ['Events / Tickets', '🎫'], ['Hobbies', '🎨']], '#FF453A');
  await seedSub('Education', [['Tuition / Fees', '🎓'], ['Books', '📚'], ['Courses', '📖'], ['School Supplies', '✏️']], '#5856D6');
  await seedSub('Travel', [['Flights', '✈️'], ['Hotels', '🏨'], ['Activities', '🏄'], ['Visa Fees', '🛂']], '#00C7BE');
  await seedSub('Family', [['Kids', '👶'], ['Spouse', '❤️'], ['Parents', '👨‍🦳'], ['Gifts', '🎁']], '#FF2D55');
  await seedSub('Subscriptions', [['OTT Apps', '📡'], ['Magazines', '📰'], ['Software', '💻'], ['Gym Membership', '💪']], '#AF52DE');
  await seedSub('Personal Care', [['Salon', '💇'], ['Cosmetics', '💄'], ['Spa', '🧖'], ['Laundry', '🧺']], '#FFCC00');
};

/** 
 * Store a JSON string of app preferences into the DB so they are 
 * bundled with standard file-based backups.
 */
export const saveInternalPreferences = async (prefsJson: string) => {
  await db.runAsync('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', 'user_preferences', prefsJson);
};

/** Retrieve stored preferences from the DB */
export const getInternalPreferences = async (): Promise<string | null> => {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', 'user_preferences');
  return row?.value ?? null;
};

/**
 * Persistent last-sync timestamp stored in SQLite.
 * Unlike the Zustand store, this is always available in background task contexts
 * (headless JS) where SecureStore may not be hydrated yet.
 */
export const getLastSyncTimeFromDb = async (): Promise<string | null> => {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', 'last_sync_time');
  return row?.value ?? null;
};

export const setLastSyncTimeInDb = async (isoDate: string): Promise<void> => {
  await db.runAsync('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', 'last_sync_time', isoDate);
};

export interface SyncAttemptLog {
  timestamp: string;
  source: 'alarm' | 'background-fetch' | 'notification' | 'boot';
  outcome: 'success' | 'failure' | 'skipped';
  reason?: string;
}

/**
 * Records every automatic (non-manual) sync attempt, regardless of outcome.
 * Manual "Sync Now" always works per user reports, so the open question when
 * diagnosing background-sync failures is whether the OS ever invokes the
 * scheduled alarm/task at all. This log gives visibility into that from the
 * Settings screen without needing adb logcat.
 */
export const logSyncAttempt = async (entry: SyncAttemptLog): Promise<void> => {
  await db.runAsync('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', 'last_sync_attempt', JSON.stringify(entry));
};

export const getLastSyncAttempt = async (): Promise<SyncAttemptLog | null> => {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', 'last_sync_attempt');
  if (!row?.value) return null;
  try { return JSON.parse(row.value); } catch { return null; }
};


// ─── Transactions ────────────────────────────────────────────────────────────

const mapTransactionRow = (row: any): Transaction => {
  return {
    ...row,
    isConfirmed: !!row.isConfirmed,
    isRecurring: !!row.isRecurring,
    isAdjustment: !!row.isAdjustment,
    isTransfer: !!row.isTransfer,
    aiEnriched: !!row.aiEnriched,
    tags: row.tags ? (() => {
      try { return JSON.parse(row.tags); } catch { return []; }
    })() : [],
    balanceAfter: row.balanceAfter,
  };
};

export const getTransactions = async (opts?: {
  limit?: number;
  offset?: number;
  search?: string;
  category?: string;
  /**
   * Parent-inclusive category filter: matches the named parent category AND all
   * of its subcategories. Used by Analytics drill-downs where the tapped card is
   * a parent group. Ignored if `category` (exact match) is also provided.
   */
  categoryGroup?: string;
  /**
   * Multi-select variants used by the Transactions filter sheet. Any transaction
   * matching an exact name in `categories` OR falling under a parent named in
   * `categoryGroups` (parent itself + its subcategories) is included. When either
   * array is non-empty, the single `category`/`categoryGroup` options are ignored.
   */
  categories?: string[];
  categoryGroups?: string[];
  type?: 'credit' | 'debit' | 'transfer';
  tag?: string;
  minAmount?: number;
  maxAmount?: number;
  startDate?: string;
  endDate?: string;
  isRecurring?: boolean;
  confirmedOnly?: boolean;
  accountId?: number;
}): Promise<Transaction[]> => {
  const conditions: string[] = [];
  const params: any[] = [];

  if (opts?.search) {
    conditions.push('(LOWER(merchant) LIKE ? OR LOWER(category) LIKE ? OR LOWER(tags) LIKE ?)');
    params.push(`%${opts.search.toLowerCase()}%`, `%${opts.search.toLowerCase()}%`, `%${opts.search.toLowerCase()}%`);
  }
  const multiCats = opts?.categories ?? [];
  const multiGroups = opts?.categoryGroups ?? [];
  if (multiCats.length > 0 || multiGroups.length > 0) {
    // OR together exact names and parent-inclusive groups. Groups match the
    // group name itself (denormalized category text — see the single-group
    // comment below) as well as any current subcategory of that parent.
    const parts: string[] = [];
    if (multiCats.length > 0) {
      parts.push(`category IN (${multiCats.map(() => '?').join(',')})`);
      params.push(...multiCats);
    }
    if (multiGroups.length > 0) {
      const ph = multiGroups.map(() => '?').join(',');
      parts.push(`category IN (${ph})`);
      params.push(...multiGroups);
      parts.push(
        `category IN (SELECT name FROM categories WHERE parentId IN (SELECT id FROM categories WHERE name IN (${ph}) AND parentId IS NULL))`
      );
      params.push(...multiGroups);
    }
    conditions.push(`(${parts.join(' OR ')})`);
  } else if (opts?.category) {
    conditions.push('category = ?');
    params.push(opts.category);
  } else if (opts?.categoryGroup) {
    // Match the group name directly against the transaction's own (denormalized)
    // category text, OR any current subcategory of a live category with that name.
    // The direct match is required even though the group name is also looked up in
    // `categories` below: a category can be renamed/deleted after transactions were
    // recorded under its old name (categories.name isn't a FK target), so an
    // existing-category-only lookup would silently drop those older transactions.
    conditions.push(
      `(category = ? OR category IN (SELECT name FROM categories WHERE parentId = (SELECT id FROM categories WHERE name = ? AND parentId IS NULL)))`
    );
    params.push(opts.categoryGroup, opts.categoryGroup);
  }
  if (opts?.tag) { conditions.push('tags LIKE ?'); params.push(`%"${opts.tag}"%`); }
  if (opts?.type) { 
    if (opts.accountId !== undefined) {
      if (opts.type === 'debit') {
        conditions.push('((type = "debit" AND accountId = ?) OR (type = "transfer" AND accountId = ?))');
        params.push(opts.accountId, opts.accountId);
      } else if (opts.type === 'credit') {
        // When querying credits for an account, include incoming transfers!
        conditions.push('((type = "credit" AND (accountId = ? OR accountId IS NULL)) OR (type = "transfer" AND toAccountId = ?))');
        params.push(opts.accountId, opts.accountId);
      } else {
        conditions.push('type = ?');
        params.push(opts.type);
      }
    } else {
      conditions.push('type = ?'); 
      params.push(opts.type); 
    }
  }

  if (opts?.minAmount !== undefined) { conditions.push('amount >= ?'); params.push(opts.minAmount); }
  if (opts?.maxAmount !== undefined) { conditions.push('amount <= ?'); params.push(opts.maxAmount); }
  // Use ISO-aware date comparisons so all timestamps on a given day are included.
  // Stored dates are ISO strings (e.g. "2024-01-31T10:00:00.000Z"). A plain
  // "YYYY-MM-DD" end-date comparison with <= would miss any time after midnight,
  // so we convert to exclusive next-day on the upper bound.
  if (opts?.startDate) {
    const start = opts.startDate.length === 10
      ? opts.startDate + 'T00:00:00.000Z'
      : opts.startDate;
    conditions.push('date >= ?');
    params.push(start);
  }
  if (opts?.endDate) {
    const d = new Date(opts.endDate.length === 10 ? opts.endDate + 'T00:00:00.000Z' : opts.endDate);
    d.setDate(d.getDate() + 1);
    conditions.push('date < ?');
    params.push(d.toISOString().split('T')[0] + 'T00:00:00.000Z');
  }
  // "Recurring" now means "belongs to a subscription" — the subscription owns the
  // schedule, and the flag survives only for rows written before that was true.
  if (opts?.isRecurring !== undefined) {
    conditions.push(
      opts.isRecurring
        ? '(isRecurring = 1 OR subscriptionId IS NOT NULL)'
        : '(isRecurring = 0 AND subscriptionId IS NULL)',
    );
  }
  if (opts?.confirmedOnly) { conditions.push('isConfirmed = 1'); }
  if (opts?.accountId !== undefined) { 
    // If we didn't apply the special account-specific type filter, apply generic account filter
    if (!opts.type || opts.type === 'transfer') {
      conditions.push('(accountId = ? OR toAccountId = ?)'); 
      params.push(opts.accountId, opts.accountId); 
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const rows = await db.getAllAsync<any>(
    `SELECT * FROM transactions ${where} ORDER BY date DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset
  );
  return rows.map(mapTransactionRow);
};

export const addTransaction = async (transaction: Omit<Transaction, 'id'>) => {
  const result = await db.runAsync(
    `INSERT INTO transactions
      (amount, category, merchant, type, date, accountId, toAccountId, isConfirmed, rawSms, isRecurring, recurrenceRule, notes, subscriptionId, goalId, loanId, confidence, source, isTransfer, tags, balanceAfter, splitMemberId, aiEnriched, rawSmsHash, isAdjustment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    transaction.amount,
    transaction.category,
    transaction.merchant,
    transaction.type || 'debit',
    transaction.date,
    transaction.accountId ?? null,
    transaction.toAccountId ?? null,
    transaction.isConfirmed ? 1 : 0,
    transaction.rawSms ?? null,
    transaction.isRecurring ? 1 : 0,
    transaction.recurrenceRule ?? null,
    transaction.notes ?? null,
    transaction.subscriptionId ?? null,
    transaction.goalId ?? null,
    transaction.loanId ?? null,
    transaction.confidence ?? 'medium',
    transaction.source ?? 'manual',
    transaction.isTransfer ? 1 : 0,
    transaction.tags ? JSON.stringify(transaction.tags) : null,
    transaction.balanceAfter ?? null,
    (transaction as any).splitMemberId ?? null,
    transaction.aiEnriched ? 1 : 0,
    transaction.rawSms ? hashSms(transaction.rawSms) : null,
    transaction.isAdjustment ? 1 : 0,
  );

  const insertId = result.lastInsertRowId;

  // If already confirmed (manual entry), apply impact immediately
  if (transaction.isConfirmed) {
    await applyTransactionImpact(transaction);
  }

  return insertId;
};

/** Internal helper to apply impact of a transaction to linked entities */
const applyTransactionImpact = async (tx: Omit<Transaction, 'id'> | Transaction, isReapplying?: boolean) => {
  const amount = tx.amount;
  const type = tx.type;

  // 1. Account Balance
  if (tx.accountId) {
    await updateAccountBalance(tx.accountId, tx.amount, tx.type, (tx as any).balanceAfter);
    // If we anchored to a bank-reported balance, re-apply any newer confirmed
    // transactions that were already in the DB (e.g. manual entries added after
    // this SMS was parsed but before it was confirmed).
    if ((tx as any).balanceAfter !== undefined && (tx as any).balanceAfter !== null) {
      await syncAccountBalanceFromSms(tx.accountId);
    }
  }

  // 1b. Target Account Balance (for transfers)
  if (tx.type === 'transfer' && tx.toAccountId) {
    // A transfer deducts from accountId (handled above, since updateAccountBalance treats type='transfer' as subtraction)
    // and credits the toAccountId.
    await updateAccountBalance(tx.toAccountId, tx.amount, 'credit');
  }

  // 2. Goal Progress — any goal-linked transaction is a contribution; always add.
  // Transaction type reflects account cash-flow direction (debit = money left the account),
  // NOT the goal direction. A "debit" contribution still moves the goal forward.
  if (tx.goalId) {
    const goal = await db.getFirstAsync<{ currentAmount: number; targetAmount: number }>(
      'SELECT currentAmount, targetAmount FROM goals WHERE id = ?', tx.goalId
    );
    if (goal) {
      const newAmount = Math.min(goal.currentAmount + amount, goal.targetAmount);
      await db.runAsync('UPDATE goals SET currentAmount = ? WHERE id = ?', newAmount, tx.goalId);
    }
  }

  // 3. Loan Balance (Debt impact)
  if (tx.loanId) {
    const loan = await db.getFirstAsync<Loan>(
      'SELECT * FROM loans WHERE id = ?', tx.loanId
    );
    if (loan) {
      let newRemaining = loan.remainingAmount;
      if (loan.type === 'lent') {
        // Lending: spending (debit) increases debt owed to me, receiving (credit/transfer) decreases it
        newRemaining = type === 'debit' ? loan.remainingAmount + amount : loan.remainingAmount - amount;
      } else {
        // Borrowing: paying (debit/transfer) decreases my debt, receiving (credit) increases it
        newRemaining = (type === 'debit' || type === 'transfer') ? loan.remainingAmount - amount : loan.remainingAmount + amount;
      }
      await db.runAsync('UPDATE loans SET remainingAmount = ? WHERE id = ?', Math.max(0, newRemaining), tx.loanId);

      // Advance loan nextDueDate if this transaction is a debt reduction payment (credit/transfer for lent, debit/transfer for borrowed)
      const isRepayment = (loan.type === 'lent' && (type === 'credit' || type === 'transfer')) || 
                          (loan.type !== 'lent' && (type === 'debit' || type === 'transfer'));
      if (isRepayment && loan.nextDueDate) {
        const next = new Date(loan.nextDueDate);
        next.setMonth(next.getMonth() + 1);
        await db.runAsync('UPDATE loans SET nextDueDate = ? WHERE id = ?', next.toISOString(), tx.loanId);
      }
    }
  }

  // 4. Subscription cycles are NOT advanced here.
  //
  // This ran on every apply with no record of which payment caused it and no
  // counterpart in revertTransactionImpact, so an edit that re-applied a linked
  // charge skipped the schedule forward another month, and deleting the payment
  // left the subscription believing it was paid. advanceSubscriptionCycle owns
  // it now, keyed to the transaction id, and every write path calls it through
  // syncSubscriptionFromTransaction.

  // 5. Split Repayment — update split member status if linked
  if ((tx as any).splitMemberId) {
    const memberId = (tx as any).splitMemberId;
    const sumResult = await db.getFirstAsync<{ sum: number }>(
      'SELECT SUM(amount) AS sum FROM transactions WHERE splitMemberId = ?',
      memberId
    );
    const totalPaid = sumResult?.sum ?? 0;
    const member = await db.getFirstAsync<{ share: number }>('SELECT share FROM split_members WHERE id = ?', memberId);
    if (member) {
      const isPaid = totalPaid >= member.share ? 1 : 0;
      let paidDate: string | null = null;
      let repaidToAccountId: number | null = null;
      if (totalPaid > 0) {
        const latestTx = await db.getFirstAsync<any>(
          'SELECT date, accountId FROM transactions WHERE splitMemberId = ? ORDER BY date DESC, id DESC LIMIT 1',
          memberId
        );
        if (latestTx) {
          paidDate = latestTx.date.split('T')[0];
          repaidToAccountId = latestTx.accountId;
        }
      }
      await db.runAsync(
        'UPDATE split_members SET isPaid = ?, paidDate = ?, repaidToAccountId = ? WHERE id = ?',
        isPaid, paidDate, repaidToAccountId, memberId
      );
    }
  }
};

/** Internal helper to revert impact */
const revertTransactionImpact = async (tx: Transaction) => {
  const amount = tx.amount;
  const type = tx.type;

  if (tx.accountId) {
    const reverseType = type === 'credit' ? 'debit' : 'credit';
    await updateAccountBalance(tx.accountId, amount, reverseType);
  }

  if (tx.type === 'transfer' && tx.toAccountId) {
    // Revert the credit on the target account
    await updateAccountBalance(tx.toAccountId, amount, 'debit');
  }

  if ((tx as any).splitMemberId) {
    const memberId = (tx as any).splitMemberId;
    const sumResult = await db.getFirstAsync<{ sum: number }>(
      'SELECT SUM(amount) AS sum FROM transactions WHERE splitMemberId = ? AND id != ?',
      memberId, tx.id
    );
    const totalPaid = sumResult?.sum ?? 0;
    const member = await db.getFirstAsync<{ share: number }>('SELECT share FROM split_members WHERE id = ?', memberId);
    if (member) {
      const isPaid = totalPaid >= member.share ? 1 : 0;
      let paidDate: string | null = null;
      let repaidToAccountId: number | null = null;
      if (totalPaid > 0) {
        const latestTx = await db.getFirstAsync<any>(
          'SELECT date, accountId FROM transactions WHERE splitMemberId = ? AND id != ? ORDER BY date DESC, id DESC LIMIT 1',
          memberId, tx.id
        );
        if (latestTx) {
          paidDate = latestTx.date.split('T')[0];
          repaidToAccountId = latestTx.accountId;
        }
      }
      await db.runAsync(
        'UPDATE split_members SET isPaid = ?, paidDate = ?, repaidToAccountId = ? WHERE id = ?',
        isPaid, paidDate, repaidToAccountId, memberId
      );
    }
  }

  if (tx.goalId) {
    const goal = await db.getFirstAsync<{ currentAmount: number }>(
      'SELECT currentAmount FROM goals WHERE id = ?', tx.goalId
    );
    if (goal) {
      // Mirror of applyTransactionImpact: contributions always added, so revert always subtracts.
      const newAmount = Math.max(0, goal.currentAmount - amount);
      await db.runAsync('UPDATE goals SET currentAmount = ? WHERE id = ?', newAmount, tx.goalId);
    }
  }

  if (tx.loanId) {
    const loan = await db.getFirstAsync<Loan>(
      'SELECT * FROM loans WHERE id = ?', tx.loanId
    );
    if (loan) {
      let newRemaining = loan.remainingAmount;
      if (loan.type === 'lent') {
        newRemaining = type === 'debit' ? loan.remainingAmount - amount : loan.remainingAmount + amount;
      } else {
        newRemaining = (type === 'debit' || type === 'transfer') ? loan.remainingAmount + amount : loan.remainingAmount - amount;
      }
      await db.runAsync('UPDATE loans SET remainingAmount = ? WHERE id = ?', Math.max(0, newRemaining), tx.loanId);

      // Revert the next due date by 1 month
      const isRepayment = (loan.type === 'lent' && (type === 'credit' || type === 'transfer')) || 
                          (loan.type !== 'lent' && (type === 'debit' || type === 'transfer'));
      if (isRepayment && loan.nextDueDate) {
        const prev = new Date(loan.nextDueDate);
        prev.setMonth(prev.getMonth() - 1);
        await db.runAsync('UPDATE loans SET nextDueDate = ? WHERE id = ?', prev.toISOString(), tx.loanId);
      }
    }
  }

  // Revert subscription: roll nextDueDate back one cycle and clear lastPaidDate if it matches.
  // Without this, deleting or editing a subscription payment leaves the sub permanently advanced.
  if (tx.subscriptionId && type === 'debit') {
    const sub = await db.getFirstAsync<Subscription>(
      'SELECT * FROM subscriptions WHERE id = ?', tx.subscriptionId
    );
    if (sub) {
      const prev = new Date(sub.nextDueDate);
      if (sub.frequency === 'monthly') prev.setMonth(prev.getMonth() - 1);
      else if (sub.frequency === 'yearly') prev.setFullYear(prev.getFullYear() - 1);
      else if (sub.frequency === 'weekly') prev.setDate(prev.getDate() - 7);
      // Only roll back if the revert makes logical sense (new prev is before now)
      const txDate = (tx as any).date ?? new Date().toISOString();
      const clearLastPaid = sub.lastPaidDate && sub.lastPaidDate >= txDate;
      await db.runAsync(
        'UPDATE subscriptions SET nextDueDate = ?, lastPaidDate = ? WHERE id = ?',
        prev.toISOString(),
        clearLastPaid ? null : (sub.lastPaidDate ?? null),
        tx.subscriptionId
      );
    }
  }
};

export const updateTransaction = async (id: number, fields: Partial<Omit<Transaction, 'id'>>) => {
  // To update safely, we fetch the old tx, revert its impact, apply new fields, then apply new impact
  const oldTx = await db.getFirstAsync<Transaction>('SELECT * FROM transactions WHERE id = ?', id);
  if (oldTx && oldTx.isConfirmed) {
    await revertTransactionImpact(oldTx);
  }

  const keys = Object.keys(fields).filter(k => k !== 'id');
  if (keys.length === 0) {
    // If we only reverted, we should re-apply if no fields changed, 
    // but usually update is called with something.
    if (oldTx && oldTx.isConfirmed) await applyTransactionImpact(oldTx, true);
    return;
  }

  const setClauses = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => {
    let v = (fields as any)[k];
    if (k === 'tags' && Array.isArray(v)) return JSON.stringify(v);
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v ?? null;
  });
  await db.runAsync(`UPDATE transactions SET ${setClauses} WHERE id = ?`, ...values, id);

  const newTx = await db.getFirstAsync<Transaction>('SELECT * FROM transactions WHERE id = ?', id);
  if (newTx && newTx.isConfirmed) {
    await applyTransactionImpact(newTx, true);
  }
};

export const confirmTransaction = async (id: number) => {
  const tx = await db.getFirstAsync<Transaction>('SELECT * FROM transactions WHERE id = ?', id);
  if (tx && !tx.isConfirmed) {
    await db.runAsync('UPDATE transactions SET isConfirmed = 1 WHERE id = ?', id);
    await applyTransactionImpact({ ...tx, isConfirmed: true });
    // Confirming is what makes a linked charge count — an unconfirmed row must
    // never move a subscription's schedule.
    await syncSubscriptionFromTransaction(id);
  }
};

export const deleteTransaction = async (id: number) => {
  const tx = await db.getFirstAsync<Transaction>('SELECT * FROM transactions WHERE id = ?', id);
  if (tx && tx.isConfirmed) {
    await revertTransactionImpact(tx);
  }
  // Statements this transaction was settling go back to owing the money.
  await clearCardPaymentForTransaction(id);
  // Same for a subscription cycle this payment advanced: without this the
  // schedule keeps a lastPaidDate for a payment that no longer exists.
  await revertSubscriptionCycleFor(id);
  await db.runAsync('DELETE FROM transactions WHERE id = ?', id);
};

export const getTransactionById = async (id: number): Promise<Transaction | null> => {
  const row = await db.getFirstAsync<any>('SELECT * FROM transactions WHERE id = ?', id);
  return row ? mapTransactionRow(row) : null;
};

/**
 * SMS transactions that were saved by the fast regex path and are still awaiting
 * on-device AI enrichment. Limited to unconfirmed rows with a stored rawSms so the
 * AI has something to re-parse, newest first (most relevant to the user).
 */
export const getSmsTransactionsPendingEnrichment = async (limit = 20): Promise<Transaction[]> => {
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM transactions
     WHERE source = 'sms' AND isConfirmed = 0 AND (aiEnriched = 0 OR aiEnriched IS NULL)
       AND rawSms IS NOT NULL AND rawSms != ''
     ORDER BY date DESC LIMIT ?`,
    limit,
  );
  return rows.map(mapTransactionRow);
};

export const getUnconfirmedTransactions = async (): Promise<Transaction[]> => {
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM transactions WHERE isConfirmed = 0 ORDER BY date DESC'
  );
  return rows.map(mapTransactionRow);
};

// ─── Aggregations ────────────────────────────────────────────────────────────

/**
 * For a debit transaction that has a split, the user's actual spending is
 * their "Me" share — not the full transaction amount. Use this expression
 * anywhere we SUM debit amounts for analytics / trend / budget queries.
 * The outer table MUST be aliased as `t`.
 */
/**
 * Rows that are not real money moving in or out of the user's world.
 *
 * Transfers move money between the user's own accounts; a balance adjustment is
 * the user correcting a running balance. Both change balances and neither is
 * income or spending. Counted as spend, balance adjustments alone were
 * inflating every total, gauge and chart in the app.
 */
const NOT_CASHFLOW = `(t.isTransfer = 0 OR t.isTransfer IS NULL)
       AND (t.isAdjustment = 0 OR t.isAdjustment IS NULL)`;

const EFFECTIVE_DEBIT_AMOUNT = `COALESCE(
  (SELECT sm.share FROM splits s
   JOIN split_members sm ON sm.splitId = s.id
   WHERE s.transactionId = t.id AND sm.isMe = 1 LIMIT 1),
  t.amount
)`;

export const getSpendTrend = async (days = 7): Promise<SpendTrendPoint[]> => {
  const since = new Date();
  since.setDate(since.getDate() - days + 1);
  since.setHours(0, 0, 0, 0);

  const rows = await db.getAllAsync<{ date: string; total: number }>(
    `SELECT DATE(t.date, 'localtime') as date, SUM(${EFFECTIVE_DEBIT_AMOUNT}) as total
     FROM transactions t
     WHERE t.type = 'debit' AND t.isConfirmed = 1 AND ${NOT_CASHFLOW} AND t.date >= ?
     GROUP BY DATE(t.date, 'localtime')
     ORDER BY DATE(t.date, 'localtime') ASC`,
    since.toISOString()
  );

  // Fill in missing days with 0
  const map = new Map(rows.map(r => [r.date, r.total]));
  const result: SpendTrendPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().split('T')[0];
    result.push({ date: key, total: map.get(key) ?? 0 });
  }
  return result;
};

/** 'YYYY-MM' for the current LOCAL month. */
const localMonthKey = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * Category spend over an explicit window.
 *
 * The month-string variants below exist for callers that genuinely mean "this
 * calendar month". Anything driven by a range selector should use this instead,
 * so what is charted matches what the user asked for.
 */
export const getCategoryBreakdownForRange = async (
  start: Date,
  end: Date,
): Promise<CategoryBreakdown[]> => {
  const rows = await db.getAllAsync<{ category: string; total: number; count: number }>(
    `SELECT t.category, SUM(${EFFECTIVE_DEBIT_AMOUNT}) as total, COUNT(*) as count
     FROM transactions t
     WHERE t.type = 'debit' AND t.isConfirmed = 1
       AND ${NOT_CASHFLOW}
       AND t.date >= ? AND t.date < ?
     GROUP BY t.category
     ORDER BY total DESC`,
    start.toISOString(), end.toISOString(),
  );
  const grandTotal = rows.reduce((s, r) => s + r.total, 0) || 1;
  return rows.map(r => ({ ...r, percentage: Math.round((r.total / grandTotal) * 100) }));
};

/** Top merchants over an explicit window. */
export const getTopMerchantsForRange = async (
  start: Date,
  end: Date,
  limit = 6,
): Promise<{ merchant: string; total: number; count: number }[]> =>
  await db.getAllAsync<{ merchant: string; total: number; count: number }>(
    `SELECT t.merchant, SUM(${EFFECTIVE_DEBIT_AMOUNT}) as total, COUNT(*) as count
     FROM transactions t
     WHERE t.type = 'debit' AND t.isConfirmed = 1
       AND ${NOT_CASHFLOW}
       AND t.merchant IS NOT NULL AND t.merchant != ''
       AND t.date >= ? AND t.date < ?
     GROUP BY t.merchant ORDER BY total DESC LIMIT ?`,
    start.toISOString(), end.toISOString(), limit,
  );

export const getCategoryBreakdown = async (
  month?: string // 'YYYY-MM', defaults to current month
): Promise<CategoryBreakdown[]> => {
  // Local month. toISOString() is UTC, so in any zone ahead of UTC (IST included)
  // the first hours of a month resolved to the PREVIOUS month while the WHERE
  // clause below filtered by localtime — an empty or stale breakdown until ~05:30.
  const target = month ?? localMonthKey();
  const rows = await db.getAllAsync<{ category: string; total: number; count: number }>(
    `SELECT t.category, SUM(${EFFECTIVE_DEBIT_AMOUNT}) as total, COUNT(*) as count
     FROM transactions t
     WHERE t.type = 'debit' AND t.isConfirmed = 1 AND ${NOT_CASHFLOW} AND strftime('%Y-%m', t.date, 'localtime') = ?
     GROUP BY t.category
     ORDER BY total DESC`,
    target
  );
  const grandTotal = rows.reduce((s, r) => s + r.total, 0) || 1;
  return rows.map(r => ({
    ...r,
    percentage: Math.round((r.total / grandTotal) * 100),
  }));
};

export const getMonthlyTotals = async (): Promise<{ month: string; income: number; expense: number }[]> => {
  return await db.getAllAsync(
    `SELECT
       strftime('%Y-%m', t.date, 'localtime') as month,
       SUM(CASE WHEN t.type = 'credit' AND ${NOT_CASHFLOW} THEN t.amount ELSE 0 END) as income,
       SUM(CASE WHEN t.type = 'debit' AND ${NOT_CASHFLOW} THEN ${EFFECTIVE_DEBIT_AMOUNT} ELSE 0 END) as expense
     FROM transactions t WHERE t.isConfirmed = 1
     GROUP BY strftime('%Y-%m', t.date, 'localtime')
     ORDER BY month DESC
     LIMIT 6`
  );
};

/**
 * Income and expense per BUDGET CYCLE, newest first.
 *
 * The calendar-month version this replaces was the only place in the app still
 * measuring a month by the calendar. Everything the user compares it against —
 * the dashboard hero, budgets, safe-to-spend — runs on the salary cycle, so with
 * a salary landing on the 31st the two screens answered the same question
 * differently, by whatever the last day of the month happened to spend.
 *
 * `month` stays a "YYYY-MM" key so the bar chart reads unchanged; it names the
 * month the cycle mostly covers (the month its final day falls in).
 */
export const getCycleTotals = async (
  anchorLike: CycleAnchor | number = 1,
  count = 6,
): Promise<
  { month: string; start: string; income: number; expense: number; expenseToDate: number }[]
> => {
  const windows = await Promise.all(
    Array.from({ length: count }, (_, i) => getSalaryCycleWindowAsync(anchorLike, -i)),
  );

  // How far into the current cycle we are. Every cycle also reports its spend at
  // this same offset, so "vs last cycle" can compare six days against six days
  // instead of six days against a finished month.
  const current = windows[0];
  const elapsedMs = current
    ? Math.min(Date.now() - current.start.getTime(), current.end.getTime() - current.start.getTime())
    : 0;

  return await Promise.all(
    windows.map(async (win) => {
      const sameElapsed = new Date(
        Math.min(win.start.getTime() + elapsedMs, win.end.getTime()),
      );
      const row = await db.getFirstAsync<{
        income: number | null;
        expense: number | null;
        expenseToDate: number | null;
      }>(
        `SELECT
           SUM(CASE WHEN t.type = 'credit' AND ${NOT_CASHFLOW} THEN t.amount ELSE 0 END) as income,
           SUM(CASE WHEN t.type = 'debit'  AND ${NOT_CASHFLOW} THEN ${EFFECTIVE_DEBIT_AMOUNT} ELSE 0 END) as expense,
           SUM(CASE WHEN t.type = 'debit'  AND ${NOT_CASHFLOW} AND t.date < ? THEN ${EFFECTIVE_DEBIT_AMOUNT} ELSE 0 END) as expenseToDate
         FROM transactions t
         WHERE t.isConfirmed = 1 AND t.date >= ? AND t.date < ?`,
        sameElapsed.toISOString(), win.start.toISOString(), win.end.toISOString(),
      );
      // End is exclusive, so the last day inside the cycle names it.
      const lastDay = new Date(win.end.getTime() - 86_400_000);
      return {
        month: `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}`,
        start: win.start.toISOString(),
        income: row?.income ?? 0,
        expense: row?.expense ?? 0,
        expenseToDate: row?.expenseToDate ?? 0,
      };
    }),
  );
};

export const getAccountSpendTrend = async (accountId: number, days = 30): Promise<SpendTrendPoint[]> => {
  const since = new Date();
  since.setDate(since.getDate() - days + 1);
  since.setHours(0, 0, 0, 0);

  const rows = await db.getAllAsync<{ date: string; total: number }>(
    `SELECT DATE(t.date, 'localtime') as date, SUM(${EFFECTIVE_DEBIT_AMOUNT}) as total
     FROM transactions t
     WHERE (t.accountId = ?) AND (t.type = 'debit' OR t.type = 'transfer') AND t.isConfirmed = 1 AND t.date >= ?
     GROUP BY DATE(t.date, 'localtime')
     ORDER BY DATE(t.date, 'localtime') ASC`,
    accountId, since.toISOString()
  );

  const map = new Map(rows.map(r => [r.date, r.total]));
  const result: SpendTrendPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().split('T')[0];
    result.push({ date: key, total: map.get(key) ?? 0 });
  }
  return result;
};

export const getAccountCategoryBreakdown = async (
  accountId: number,
  type: 'debit' | 'credit' = 'debit',
  startDate?: string,
  endDate?: string,
): Promise<CategoryBreakdown[]> => {
  // For a specific account, include transfers that involve that account
  const conditions = [`(t.accountId = ? OR t.toAccountId = ?)`, `t.isConfirmed = 1`];
  const params: any[] = [accountId, accountId];

  if (type === 'debit') {
    // Expense: either a direct debit or a transfer OUT of this account
    conditions.push(`((t.type = 'debit' AND t.accountId = ?) OR (t.type = 'transfer' AND t.accountId = ?))`);
    params.push(accountId, accountId);
  } else {
    // Income: either a direct credit or a transfer INTO this account
    conditions.push(`((t.type = 'credit' AND t.accountId = ?) OR (t.type = 'transfer' AND t.toAccountId = ?))`);
    params.push(accountId, accountId);
  }

  if (startDate) { conditions.push('t.date >= ?'); params.push(startDate); }
  if (endDate) { conditions.push('t.date <= ?'); params.push(endDate); }

  // For debit, use the split-aware effective amount; income uses full amount
  const amountExpr = type === 'debit' ? EFFECTIVE_DEBIT_AMOUNT : 't.amount';

  const rows = await db.getAllAsync<{ category: string; total: number; count: number }>(
    `SELECT t.category, SUM(${amountExpr}) as total, COUNT(*) as count
     FROM transactions t
     WHERE ${conditions.join(' AND ')}
     GROUP BY t.category
     ORDER BY total DESC`,
    ...params
  );
  const grandTotal = rows.reduce((s, r) => s + r.total, 0) || 1;
  return rows.map(r => ({
    ...r,
    percentage: Math.round((r.total / grandTotal) * 100),
  }));
};

export const getAccountInsights = async (
  accountId: number,
  startDate?: string,
  endDate?: string,
): Promise<{ totalExpense: number; totalIncome: number; txCount: number; avgTxAmount: number }> => {
  const conditions = [`t.accountId = ?`, `t.isConfirmed = 1`];
  const params: any[] = [accountId];
  if (startDate) { conditions.push('t.date >= ?'); params.push(startDate); }
  if (endDate) { conditions.push('t.date <= ?'); params.push(endDate); }

  const row = await db.getFirstAsync<{ expense: number; income: number; count: number }>(
    `SELECT
       SUM(CASE 
         WHEN (t.type = 'debit' AND t.accountId = ?) OR (t.type = 'transfer' AND t.accountId = ?) 
         THEN ${EFFECTIVE_DEBIT_AMOUNT} ELSE 0 END) as expense,
       SUM(CASE 
         WHEN (t.type = 'credit' AND t.accountId = ?) OR (t.type = 'transfer' AND t.toAccountId = ?) 
         THEN t.amount ELSE 0 END) as income,
       COUNT(*) as count
     FROM transactions t 
     WHERE (t.accountId = ? OR t.toAccountId = ?) AND t.isConfirmed = 1`,
    accountId, accountId, accountId, accountId, accountId, accountId
  );
  const expense = row?.expense ?? 0;
  const income = row?.income ?? 0;
  const txCount = row?.count ?? 0;
  return {
    totalExpense: expense,
    totalIncome: income,
    txCount,
    avgTxAmount: txCount > 0 ? (expense + income) / txCount : 0,
  };
};

export const getAllUniqueTags = async (): Promise<string[]> => {
  const rows = await db.getAllAsync<{ tags: string }>("SELECT tags FROM transactions WHERE tags IS NOT NULL AND tags != '[]' AND tags != ''");
  const tagSet = new Set<string>();
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.tags);
      if (Array.isArray(parsed)) {
        for (const t of parsed) tagSet.add(t);
      }
    } catch {}
  }
  return Array.from(tagSet).sort();
};

export const getSpendingByTag = async (startDate: string, endDate: string): Promise<{ tag: string; total: number; count: number }[]> => {
  // Aggregate using JS to guarantee compatibility if json1 isn't available
  const txs = await db.getAllAsync<{ tags: string; amount: number }>(
    `SELECT tags, amount FROM transactions WHERE type = 'debit' AND isConfirmed = 1 AND date >= ? AND date <= ? AND tags IS NOT NULL`,
    startDate, endDate
  );
  const map = new Map<string, { total: number; count: number }>();
  for (const tx of txs) {
    try {
      const parsed = JSON.parse(tx.tags);
      if (Array.isArray(parsed)) {
        for (const t of parsed) {
          const cur = map.get(t) || { total: 0, count: 0 };
          map.set(t, { total: cur.total + tx.amount, count: cur.count + 1 });
        }
      }
    } catch {}
  }
  return Array.from(map.entries()).map(([tag, { total, count }]) => ({ tag, total, count })).sort((a, b) => b.total - a.total);
};

export const getHighSpendTransactions = async (threshold = 2000): Promise<Transaction[]> => {
  // "Biggest pulses" is an expense list: exclude income credits and transfers
  // (which are not spend) so a large salary/transfer never shows up here.
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM transactions
     WHERE amount >= ? AND isConfirmed = 1
       AND type = 'debit' AND (isTransfer = 0 OR isTransfer IS NULL)
       AND (isAdjustment = 0 OR isAdjustment IS NULL)
     ORDER BY date DESC LIMIT 20`,
    threshold
  );
  return rows.map(mapTransactionRow);
};

/**
 * Total confirmed debit spend grouped by weekday, over the last `days` window.
 * Returns exactly 7 entries (weekday 0=Sunday … 6=Saturday), zero-filled, so the
 * caller can render a stable Mon–Sun bar row. `count` is the number of debit
 * transactions on that weekday across the window (used to derive per-day averages).
 */
export const getWeekdaySpending = async (
  days = 84,
): Promise<{ weekday: number; total: number; count: number }[]> => {
  const since = new Date();
  since.setDate(since.getDate() - days + 1);
  since.setHours(0, 0, 0, 0);

  const rows = await db.getAllAsync<{ weekday: string; total: number; count: number }>(
    `SELECT strftime('%w', t.date, 'localtime') as weekday,
            SUM(${EFFECTIVE_DEBIT_AMOUNT}) as total,
            COUNT(*) as count
     FROM transactions t
     WHERE t.type = 'debit' AND t.isConfirmed = 1 AND ${NOT_CASHFLOW} AND t.date >= ?
     GROUP BY strftime('%w', t.date, 'localtime')`,
    since.toISOString(),
  );

  const map = new Map(rows.map(r => [Number(r.weekday), { total: r.total, count: r.count }]));
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    total: map.get(weekday)?.total ?? 0,
    count: map.get(weekday)?.count ?? 0,
  }));
};

/**
 * Top confirmed debit merchants for a given month ('YYYY-MM', defaults to the
 * current month), ordered by total spend. Powers the interactive "Top merchants"
 * bars on Analytics; tapping a row drills into the filtered transaction list.
 */
export const getTopMerchants = async (
  month?: string,
  limit = 6,
): Promise<{ merchant: string; total: number; count: number }[]> => {
  const target = month ?? localMonthKey();
  return await db.getAllAsync<{ merchant: string; total: number; count: number }>(
    `SELECT t.merchant, SUM(${EFFECTIVE_DEBIT_AMOUNT}) as total, COUNT(*) as count
     FROM transactions t
     WHERE t.type = 'debit' AND t.isConfirmed = 1 AND ${NOT_CASHFLOW}
       AND t.merchant IS NOT NULL AND t.merchant != ''
       AND strftime('%Y-%m', t.date, 'localtime') = ?
     GROUP BY t.merchant
     ORDER BY total DESC
     LIMIT ?`,
    target, limit,
  );
};

/**
 * Spend inside the current budget cycle.
 *
 * Accepts the anchor spec or a legacy numeric salaryDay. Window comes from the
 * shared helper, so this agrees with the budget gauges and the dashboard, and no
 * longer overflows for day 29/30/31.
 */
export const getCurrentMonthSpend = async (
  anchorLike: CycleAnchor | number = 1,
): Promise<number> => {
  const { start: startDate, end: endDate } = await getSalaryCycleWindowAsync(anchorLike);

  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT SUM(${EFFECTIVE_DEBIT_AMOUNT}) as total FROM transactions t
     WHERE t.type = 'debit' AND t.isConfirmed = 1 AND ${NOT_CASHFLOW} AND t.date >= ? AND t.date < ?`,
    startDate.toISOString(),
    endDate.toISOString()
  );
  return row?.total ?? 0;
};

export const getTransactionCount = async (): Promise<number> => {
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM transactions');
  return row?.count ?? 0;
};

// ─── Accounts ────────────────────────────────────────────────────────────────

export const getAccounts = async (): Promise<Account[]> => {
  return await db.getAllAsync<Account>('SELECT * FROM accounts ORDER BY displayOrder ASC, id ASC');
};

export const updateAccountsOrder = async (orderings: { id: number; displayOrder: number }[]) => {
  if (orderings.length === 0) return;
  await db.withTransactionAsync(async () => {
    for (const { id, displayOrder } of orderings) {
      await db.runAsync('UPDATE accounts SET displayOrder = ? WHERE id = ?', displayOrder, id);
    }
  });
};

export const addAccount = async (account: Omit<Account, 'id'>) => {
  const maxOrderRow = await db.getFirstAsync<{ maxOrder: number }>('SELECT MAX(displayOrder) as maxOrder FROM accounts');
  const nextOrder = (maxOrderRow?.maxOrder ?? -1) + 1;

  const result = await db.runAsync(
    `INSERT INTO accounts (name, balance, accountType, creditLimit, statementDay, billDueDay, startDate, lastScannedDate, last4Digits, displayOrder, startingBalance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    account.name,
    account.balance,
    account.accountType ?? 'bank',
    account.creditLimit ?? null,
    account.statementDay ?? null,
    account.billDueDay ?? null,
    account.startDate,
    account.lastScannedDate ?? null,
    account.last4Digits?.trim() || null,
    nextOrder,
    account.startingBalance ?? account.balance ?? 0,
  );
  return result.lastInsertRowId;
};

export const deleteAccount = async (id: number) => {
  await db.runAsync('DELETE FROM accounts WHERE id = ?', id);
};

export const updateAccount = async (id: number, fields: Partial<Omit<Account, 'id'>>) => {
  const keys = Object.keys(fields).filter(k => k !== 'id');
  if (keys.length === 0) return;

  // If the user modified any criteria used to match SMS (or the horizon date itself),
  // we must aggressively reset the date cursor to force a fresh re-scan.
  if (keys.includes('startDate') || keys.includes('last4Digits') || keys.includes('name')) {
    (fields as any).lastScannedDate = null;
    if (!keys.includes('lastScannedDate')) keys.push('lastScannedDate');
  }

  const setClauses = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => {
    const v = (fields as any)[k];
    return v === undefined ? null : v;
  });
  await db.runAsync(`UPDATE accounts SET ${setClauses} WHERE id = ?`, ...values, id);
};

export const updateAccountBalance = async (
  id: number,
  amount: number,
  type: 'credit' | 'debit' | 'transfer',
  balanceAfter?: number
) => {
  if (balanceAfter !== undefined && balanceAfter !== null) {
    await db.runAsync('UPDATE accounts SET balance = ? WHERE id = ?', balanceAfter, id);
    return;
  }
  const account = await db.getFirstAsync<{ balance: number; accountType: string }>(
    'SELECT balance, accountType FROM accounts WHERE id = ?', id
  );
  if (!account) return;

  const isCreditCard = account.accountType === 'credit_card';

  let newBalance: number;
  if (isCreditCard) {
    // CC balance = outstanding owed. Spending (debit) increases it; payment (credit) decreases it.
    newBalance = (type === 'credit')
      ? account.balance - amount   // payment received → outstanding goes down
      : account.balance + amount;  // purchase / debit → outstanding goes up
  } else {
    // Bank / cash / wallet: credit adds money, debit/transfer subtracts money.
    newBalance = (type === 'credit')
      ? account.balance + amount
      : account.balance - amount;
  }

  await db.runAsync('UPDATE accounts SET balance = ? WHERE id = ?', newBalance, id);
};

export const updateAccountLastScanned = async (id: number, date: string) => {
  await db.runAsync('UPDATE accounts SET lastScannedDate = ? WHERE id = ?', date, id);
};

/**
 * Uses the most recent transaction with a 'balanceAfter' (bank reported available balance)
 * to correct the account's current balance, accounting for any newer confirmed transactions.
 */
export const syncAccountBalanceFromSms = async (accountId: number) => {
  const lastWithBalance = await db.getFirstAsync<Transaction>(
    'SELECT * FROM transactions WHERE accountId = ? AND balanceAfter IS NOT NULL AND isConfirmed = 1 ORDER BY date DESC LIMIT 1',
    accountId
  );

  if (!lastWithBalance || lastWithBalance.balanceAfter === null || lastWithBalance.balanceAfter === undefined) {
    return false;
  }

  let currentBal = lastWithBalance.balanceAfter;
  
  // Find all confirmed transactions that happened AFTER this checkpoint (involving the account as sender or receiver)
  const newerTxs = await db.getAllAsync<Transaction>(
    'SELECT * FROM transactions WHERE (accountId = ? OR toAccountId = ?) AND isConfirmed = 1 AND date > ? ORDER BY date ASC',
    accountId,
    accountId,
    lastWithBalance.date
  );

  const account = await db.getFirstAsync<{ accountType: string }>(
    'SELECT accountType FROM accounts WHERE id = ?',
    accountId
  );
  if (!account) return false;

  const isCC = account.accountType === 'credit_card';

  for (const tx of newerTxs) {
    const isIncoming = tx.type === 'credit' || (tx.type === 'transfer' && tx.toAccountId === accountId);
    if (isCC) {
      // CC: credit/incoming reduces debt, debit/outgoing increases it
      currentBal = isIncoming ? currentBal - tx.amount : currentBal + tx.amount;
    } else {
      // Bank: credit/incoming adds, debit/outgoing/transfer-out subtracts
      currentBal = isIncoming ? currentBal + tx.amount : currentBal - tx.amount;
    }
  }

  await db.runAsync('UPDATE accounts SET balance = ? WHERE id = ?', currentBal, accountId);
  return true;
};

/**
 * Re-calculates current balance from scratch using startingBalance + all confirmed transactions.
 * This is the ultimate fix for any mathematical drifts.
 */
export const recalculateAccountBalance = async (accountId: number) => {
  const account = await db.getFirstAsync<Account>('SELECT * FROM accounts WHERE id = ?', accountId);
  if (!account) return false;

  const txs = await db.getAllAsync<Transaction>(
    'SELECT * FROM transactions WHERE (accountId = ? OR toAccountId = ?) AND isConfirmed = 1 ORDER BY date ASC',
    accountId,
    accountId
  );

  let currentBal = account.startingBalance;
  const isCC = account.accountType === 'credit_card';

  for (const tx of txs) {
    const isIncoming = tx.type === 'credit' || (tx.type === 'transfer' && tx.toAccountId === accountId);
    if (isCC) {
      currentBal = isIncoming ? currentBal - tx.amount : currentBal + tx.amount;
    } else {
      currentBal = isIncoming ? currentBal + tx.amount : currentBal - tx.amount;
    }
  }

  await db.runAsync('UPDATE accounts SET balance = ? WHERE id = ?', currentBal, accountId);
  return true;
};

/**
 * Get the effective scan cutoff — the date from which the next scan will read SMS.
 * Uses the same logic as getAccountScanRanges: max(lastConfirmedTxDate, lastScannedDate) > startDate.
 * Returns the earliest cutoff across all bank/credit_card accounts.
 */
export const getSmsScanCutoffDate = async (): Promise<{ date: string; isResume: boolean } | null> => {
  const accounts = await db.getAllAsync<{ id: number; startDate: string; lastScannedDate: string | null }>(
    `SELECT id, startDate, lastScannedDate FROM accounts WHERE accountType IN ('bank', 'credit_card')`
  );
  if (accounts.length === 0) return null;

  let earliestDate: string | null = null;
  let isResume = false;

  for (const a of accounts) {
    const lastConfirmed = await db.getFirstAsync<{ date: string }>(
      `SELECT date FROM transactions
       WHERE accountId = ? AND isConfirmed = 1 AND source IN ('sms', 'auto')
       ORDER BY date DESC LIMIT 1`,
      a.id,
    );

    // Use the MOST RECENT of lastConfirmed and lastScanned (same logic as getAccountScanRanges)
    const candidates: string[] = [];
    if (lastConfirmed?.date) candidates.push(lastConfirmed.date);
    if (a.lastScannedDate) candidates.push(a.lastScannedDate);
    const fromDate = candidates.length > 0
      ? candidates.reduce((a, b) => a > b ? a : b)
      : a.startDate;
    const hasHistory = candidates.length > 0;

    if (!earliestDate || fromDate < earliestDate) {
      earliestDate = fromDate;
      isResume = hasHistory;
    }
  }

  if (!earliestDate) return null;
  return { date: earliestDate, isResume };
};

/**
 * Update lastScannedDate on ALL accounts to the given date.
 * Called after a successful Smart Scan completes.
 */
export const updateAllAccountsLastScanned = async (date: string) => {
  await db.runAsync('UPDATE accounts SET lastScannedDate = ?', date);
};

/**
 * Returns the most recent lastScannedDate across all accounts, or null if never scanned.
 * Used to display "Last scanned: Today at 2:30 PM" in the UI.
 */
export const getLastScanTime = async (): Promise<string | null> => {
  const row = await db.getFirstAsync<{ lastScan: string | null }>(
    `SELECT MAX(lastScannedDate) as lastScan FROM accounts`
  );
  return row?.lastScan ?? null;
};

/**
 * Returns true if at least one account has a lastScannedDate set.
 */
export const hasAnyPreviousScan = async (): Promise<boolean> => {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM accounts WHERE lastScannedDate IS NOT NULL`
  );
  return (row?.count ?? 0) > 0;
};

/**
 * Returns each account paired with its individual scan start date.
 * • Never-scanned account → scanFrom = startDate (the "balance as of" date)
 * • Previously-scanned   → scanFrom = lastScannedDate
 *
 * This drives per-account SMS filtering so only SMS belonging to each account
 * are processed from the correct point in time.
 */
export interface AccountScanRange {
  account: Account;
  /** Epoch ms — only process SMS on or after this date for this account */
  fromMs: number;
}

export const getAccountScanRanges = async (): Promise<AccountScanRange[]> => {
  const accounts = await getAccounts();

  const ranges: AccountScanRange[] = [];
  for (const a of accounts) {
    // Query the last confirmed SMS/auto transaction for THIS account specifically.
    const lastConfirmed = await db.getFirstAsync<{ date: string }>(
      `SELECT date FROM transactions
       WHERE accountId = ? AND isConfirmed = 1 AND source IN ('sms', 'auto')
       ORDER BY date DESC LIMIT 1`,
      a.id,
    );

    // Use the MOST RECENT anchor — whichever is later:
    //  • lastConfirmedTxDate: The last confirmed SMS-sourced transaction date.
    //  • lastScannedDate: Updated when a scan completes (even if it found nothing new).
    //  • startDate: The "balance as of" date — fallback for brand-new accounts.
    //
    // Taking the MAX avoids re-scanning date ranges that were already processed
    // in a previous scan that found nothing new (lastScannedDate advanced past
    // lastConfirmedTxDate in that case).
    const candidates: number[] = [];
    if (lastConfirmed?.date) candidates.push(new Date(lastConfirmed.date).getTime());
    if (a.lastScannedDate) candidates.push(new Date(a.lastScannedDate).getTime());
    
    const fromMs = candidates.length > 0
      ? Math.max(...candidates)
      : new Date(a.startDate).getTime();

    // Safety overlap: re-scan the last 1 hour to catch delayed SMS or minor clock skews.
    // Our hash-based and semantic deduplication layers safely handle any overlapping results.
    const overlapMs = 60 * 60 * 1000; 
    ranges.push({ account: a, fromMs: Math.max(0, fromMs - overlapMs) });
  }
  return ranges;
};

// ─── Categories ──────────────────────────────────────────────────────────────

export const getCategories = async (): Promise<Category[]> => {
  return await db.getAllAsync<Category>('SELECT * FROM categories ORDER BY type, name');
};

export const addCategory = async (category: Omit<Category, 'id'>) => {
  await db.runAsync(
    'INSERT INTO categories (name, icon, color, type, parentId) VALUES (?, ?, ?, ?, ?)',
    category.name, category.icon, category.color, category.type, category.parentId || null
  );

  // Re-creating a category by hand reverses an earlier deletion, so drop any
  // tombstone — otherwise deleting it again later would be a no-op to seeding.
  const parentName = category.parentId
    ? (await db.getFirstAsync<{ name: string }>(
        'SELECT name FROM categories WHERE id = ?', category.parentId
      ))?.name ?? null
    : null;
  await clearCategoryTombstone(category.name, category.type, parentName);
};

export const updateCategory = async (category: Category) => {
  // Budgets reference categories by loose name text — follow a rename so the
  // budget doesn't silently orphan.
  const before = await db.getFirstAsync<{ name: string }>(
    'SELECT name FROM categories WHERE id = ?', category.id
  );
  await db.runAsync(
    'UPDATE categories SET name = ?, icon = ?, color = ?, type = ?, parentId = ? WHERE id = ?',
    category.name, category.icon, category.color, category.type, category.parentId || null, category.id
  );
  if (before && before.name !== category.name) {
    await renameCategoryNameInBudgets(before.name, category.name);
  }
};

export const deleteCategory = async (id: number) => {
  // Collect the category and its subcategories (they cascade-delete) so their
  // budgets don't linger as orphans, and so each one can be tombstoned.
  // Read everything BEFORE the delete — afterwards these rows are gone and a
  // subcategory tombstone could no longer be keyed to its parent's name.
  const doomed = await db.getAllAsync<{ id: number; name: string; type: string; parentId: number | null }>(
    'SELECT id, name, type, parentId FROM categories WHERE id = ? OR parentId = ?', id, id
  );
  const target = doomed.find((r) => r.id === id);
  // Only needed when the target is itself a subcategory.
  const targetParentName = target?.parentId
    ? (await db.getFirstAsync<{ name: string }>(
        'SELECT name FROM categories WHERE id = ?', target.parentId
      ))?.name ?? null
    : null;

  await db.runAsync('DELETE FROM categories WHERE id = ?', id);

  for (const row of doomed) {
    await removeCategoryNameFromBudgets(row.name);
    // Top-level: no parent. Cascade-deleted child: its parent is the target.
    // The target itself when it is a subcategory: its own parent's name.
    const parentName =
      row.parentId === null ? null : row.parentId === id ? target?.name ?? null : targetParentName;
    await tombstoneDeletedCategory(row.name, row.type, parentName);
  }
};

/** Rename a category inside every budget selection that references it. */
const renameCategoryNameInBudgets = async (oldName: string, newName: string) => {
  const budgets = await getBudgets();
  for (const b of budgets) {
    const sel = budgetSelections(b);
    if (!sel.includes(oldName)) continue;
    const next = [...new Set(sel.map((n) => (n === oldName ? newName : n)))];
    await db.runAsync(
      'UPDATE budgets SET categoryName = ?, categoryNames = ? WHERE id = ?',
      next[0], JSON.stringify(next), b.id
    );
  }
};

/**
 * Drop a deleted category from budget selections: multi-category budgets keep
 * their remaining selections; single-category budgets are removed entirely.
 */
const removeCategoryNameFromBudgets = async (name: string) => {
  const budgets = await getBudgets();
  for (const b of budgets) {
    const sel = budgetSelections(b);
    if (!sel.includes(name)) continue;
    const rest = sel.filter((n) => n !== name);
    if (rest.length === 0) {
      await db.runAsync('DELETE FROM budgets WHERE id = ?', b.id);
    } else {
      await db.runAsync(
        'UPDATE budgets SET categoryName = ?, categoryNames = ? WHERE id = ?',
        rest[0], JSON.stringify(rest), b.id
      );
    }
  }
};

// ─── Budgets ─────────────────────────────────────────────────────────────────

const mapBudgetRow = (row: any): Budget => {
  let categoryNames: string[] | undefined;
  try {
    categoryNames = row.categoryNames ? JSON.parse(row.categoryNames) : undefined;
  } catch {
    categoryNames = undefined;
  }
  return {
    ...row,
    categoryNames,
    name: row.name ? String(row.name) : undefined,
    rollover: !!row.rollover,
  };
};

/** The category names a budget explicitly targets (multi-select aware). */
export const budgetSelections = (b: Budget): string[] =>
  b.categoryNames && b.categoryNames.length > 0 ? b.categoryNames : [b.categoryName];

/**
 * Label derived from the selection: single name, or "First + N more" for
 * bundled budgets. Used to prefill the name field and as the fallback for
 * budgets saved before names existed.
 */
export const budgetAutoName = (selections: string[]): string => {
  if (selections.length === 0) return '';
  if (selections.length === 1) return selections[0];
  if (selections.length === 2) return `${selections[0]} + ${selections[1]}`;
  return `${selections[0]} + ${selections.length - 1} more`;
};

/** Human label: the user's own name when set, else the category-derived one. */
export const budgetDisplayName = (b: Budget): string =>
  b.name?.trim() || budgetAutoName(budgetSelections(b));

export const getBudgets = async (): Promise<Budget[]> => {
  const rows = await db.getAllAsync<any>('SELECT * FROM budgets ORDER BY categoryName');
  return rows.map(mapBudgetRow);
};

export const upsertBudget = async (budget: Omit<Budget, 'id'> & { id?: number }) => {
  const selections =
    budget.categoryNames && budget.categoryNames.length > 0
      ? budget.categoryNames
      : [budget.categoryName];
  const primary = selections[0];
  const namesJson = JSON.stringify(selections);
  // Blank (or the untouched auto-label) stays null so the row keeps tracking
  // its categories instead of freezing a stale name.
  const trimmed = budget.name?.trim();
  const name = trimmed && trimmed !== budgetAutoName(selections) ? trimmed : null;

  const update = (id: number) =>
    db.runAsync(
      'UPDATE budgets SET name = ?, categoryName = ?, categoryNames = ?, amount = ?, period = ?, startDate = ?, rollover = ? WHERE id = ?',
      name, primary, namesJson, budget.amount, budget.period, budget.startDate, budget.rollover ? 1 : 0, id
    );

  if (budget.id != null) {
    await update(budget.id);
    return;
  }
  // Same selection set + period → overwrite instead of duplicating. Legacy
  // rows (null categoryNames) compare as their own single-name selection.
  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM budgets WHERE period = ? AND IFNULL(categoryNames, '["' || categoryName || '"]') = ?`,
    budget.period, namesJson
  );
  if (existing) {
    await update(existing.id);
  } else {
    await db.runAsync(
      'INSERT INTO budgets (name, categoryName, categoryNames, amount, period, startDate, rollover) VALUES (?, ?, ?, ?, ?, ?, ?)',
      name, primary, namesJson, budget.amount, budget.period, budget.startDate, budget.rollover ? 1 : 0
    );
  }
};

export const deleteBudget = async (id: number) => {
  await db.runAsync('DELETE FROM budgets WHERE id = ?', id);
};

// ── Budget windows ───────────────────────────────────────────────────────────

/**
 * Salary billing cycle, shifted by `shift` cycles (0 = current, -1 = previous).
 *
 * Delegates to services/salaryCycle so every consumer agrees. The old inline
 * `new Date(y, m, salaryDay)` here overflowed short months — day 31 in February
 * produced a Jan 31 → Mar 3 window and then drifted off month-end for good.
 */

// ─── Credit card statements ──────────────────────────────────────────────────

export interface CardStatement {
  id: number;
  accountId: number;
  /** When the bank generated the statement. Null when only a reminder was seen. */
  statementDate: string | null;
  dueDate: string;
  /** Frozen at generation — what the bank billed. Never raised by a reminder. */
  totalDue: number;
  minimumDue: number | null;
  /** Reconciled total: the greater of what the bank reported and our ledger. */
  paidAmount: number;
  /** What the BANK implied was paid, independent of transactions we matched. */
  reportedPaid: number;
  isPaid: boolean;
  source: 'sms' | 'manual';
  rawSms: string | null;
  createdAt: string;
  updatedAt: string;
}

const mapStatement = (row: any): CardStatement => ({
  ...row,
  isPaid: !!row.isPaid,
  reportedPaid: row.reportedPaid ?? 0,
  minimumDue: row.minimumDue ?? null,
  statementDate: row.statementDate ?? null,
  rawSms: row.rawSms ?? null,
});

/** What is still owed on a statement. Never negative. */
export const statementRemaining = (st: CardStatement): number =>
  Math.max(st.totalDue - st.paidAmount, 0);

/**
 * Record a statement or reminder parsed from SMS.
 *
 * Banks re-send the same reminder repeatedly until the due date — and often once
 * more after payment — so this must be idempotent. Dedup is on
 * (accountId, dueDate):
 *
 *  - First sighting creates the statement.
 *  - A later message NEVER raises totalDue; a higher figure would mean a
 *    different billing period, which needs its own row and its own due date.
 *  - A later message showing LESS outstanding is treated as authoritative: the
 *    bank knows about payments we may not have matched to a transaction, so
 *    paidAmount is reconciled up to match. This is what makes repeated
 *    post-payment reminders settle correctly instead of re-opening a paid bill.
 */
export const upsertCardStatement = async (input: {
  accountId: number;
  dueDate: string;
  totalDue: number;
  minimumDue?: number | null;
  statementDate?: string | null;
  source?: 'sms' | 'manual';
  rawSms?: string | null;
}): Promise<CardStatement | null> => {
  const now = new Date().toISOString();
  const existing = await db.getFirstAsync<any>(
    'SELECT * FROM card_statements WHERE accountId = ? AND dueDate = ?',
    input.accountId, input.dueDate,
  );

  if (!existing) {
    await db.runAsync(
      `INSERT INTO card_statements
        (accountId, statementDate, dueDate, totalDue, minimumDue, paidAmount, isPaid, source, rawSms, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
      input.accountId,
      input.statementDate ?? null,
      input.dueDate,
      input.totalDue,
      input.minimumDue ?? null,
      input.source ?? 'sms',
      input.rawSms ?? null,
      now, now,
    );
    // A statement can land after the payment that settles it — reconcile now
    // rather than waiting for the transaction to be touched again.
    await resyncCardPayments(input.accountId);
    return await getStatementById(input.accountId, input.dueDate);
  }

  const st = mapStatement(existing);
  const reported = input.totalDue;

  // A reminder quoting less than the original bill implies payments we haven't
  // matched. Trust the bank and reconcile — but only ever upward, so a stale
  // duplicate can't un-pay a settled statement. Stored as the bank's own figure;
  // recompute then reconciles it against the ledger with max(), so a payment
  // counted in both places is not counted twice.
  const reportedPaid =
    reported < st.totalDue
      ? Math.max(st.reportedPaid, st.totalDue - reported)
      : st.reportedPaid;

  await db.runAsync(
    `UPDATE card_statements
        SET minimumDue = COALESCE(?, minimumDue),
            statementDate = COALESCE(?, statementDate),
            reportedPaid = ?,
            updatedAt = ?
      WHERE id = ?`,
    input.minimumDue ?? null,
    input.statementDate ?? null,
    reportedPaid,
    now,
    st.id,
  );
  await recomputeStatementPaid(st.id);
  await resyncCardPayments(input.accountId);
  return await getStatementById(input.accountId, input.dueDate);
};

export const getStatementById = async (
  accountId: number,
  dueDate: string,
): Promise<CardStatement | null> => {
  const row = await db.getFirstAsync<any>(
    'SELECT * FROM card_statements WHERE accountId = ? AND dueDate = ?', accountId, dueDate,
  );
  return row ? mapStatement(row) : null;
};

/** Unpaid statements, oldest due first — the order payments are applied in. */
export const getOpenStatements = async (accountId?: number): Promise<CardStatement[]> => {
  const rows = accountId
    ? await db.getAllAsync<any>(
        'SELECT * FROM card_statements WHERE isPaid = 0 AND accountId = ? ORDER BY dueDate ASC', accountId)
    : await db.getAllAsync<any>(
        'SELECT * FROM card_statements WHERE isPaid = 0 ORDER BY dueDate ASC');
  return rows.map(mapStatement);
};

/** The statement a card bill should quote: the oldest still-open one. */
export const getCurrentStatement = async (accountId: number): Promise<CardStatement | null> => {
  const open = await getOpenStatements(accountId);
  return open[0] ?? null;
};

export const getStatementsForAccount = async (
  accountId: number,
  limit = 12,
): Promise<CardStatement[]> => {
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM card_statements WHERE accountId = ? ORDER BY dueDate DESC LIMIT ?',
    accountId, limit,
  );
  return rows.map(mapStatement);
};

/** Manual override for "I paid this outside the app". */
export const markStatementPaid = async (id: number): Promise<void> => {
  const row = await db.getFirstAsync<any>('SELECT * FROM card_statements WHERE id = ?', id);
  if (!row) return;
  // Recorded as a bank-reported figure so a later ledger recompute can't undo it.
  await db.runAsync(
    'UPDATE card_statements SET reportedPaid = totalDue, updatedAt = ? WHERE id = ?',
    new Date().toISOString(), id,
  );
  await recomputeStatementPaid(id);
};

// ─── Card payments ledger ────────────────────────────────────────────────────

/**
 * Longest plausible gap between a statement being generated and its due date,
 * used only when the bank's SMS never told us the statement date. Payments older
 * than this before the due date belong to an earlier billing period.
 */
const STATEMENT_WINDOW_DAYS = 35;

/** Start of the period a payment must fall in to count toward this statement. */
const statementOpensAt = (st: CardStatement): number =>
  st.statementDate
    ? new Date(st.statementDate).getTime()
    : new Date(st.dueDate).getTime() - STATEMENT_WINDOW_DAYS * 86_400_000;

/**
 * Rewrite a statement's paidAmount from its two independent sources.
 *
 * `reportedPaid` is what the bank implied (a reminder quoting less than it
 * billed, or a manual "already paid"); the ledger is what we matched to real
 * transactions. The bank's figure already includes anything we also matched, so
 * these are reconciled with max(), never a sum.
 */
const recomputeStatementPaid = async (statementId: number): Promise<void> => {
  const st = await db.getFirstAsync<any>(
    'SELECT * FROM card_statements WHERE id = ?', statementId,
  );
  if (!st) return;

  const row = await db.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(amount) as total FROM card_payments WHERE statementId = ?', statementId,
  );
  const ledger = row?.total ?? 0;
  const paidAmount = Math.max(st.reportedPaid ?? 0, ledger);
  const isPaid = paidAmount >= st.totalDue - 0.01;

  await db.runAsync(
    'UPDATE card_statements SET paidAmount = ?, isPaid = ?, updatedAt = ? WHERE id = ?',
    paidAmount, isPaid ? 1 : 0, new Date().toISOString(), statementId,
  );
};

/**
 * Is this transaction money arriving at one of the user's credit cards, and is
 * it a payment rather than a refund?
 *
 * Two shapes count, and the distinction matters:
 *
 *  - A TRANSFER whose destination is a card. Always a payment: the user moved
 *    their own money to the card. The amount is irrelevant — paying ₹500 against
 *    a ₹5,000 bill is an ordinary partial payment, and three transfers in one day
 *    are three payments.
 *  - A CREDIT on the card account, but only when it reads as a payment. A
 *    merchant refund, a cashback posting and a manual balance adjustment all
 *    credit the card without paying a bill; applying them to a statement would
 *    settle a bill the user never paid. (A balance adjustment is the user
 *    correcting the running balance — counting it twice is exactly wrong.)
 */
const NON_PAYMENT_CREDIT = /refund|cashback|reversal|balance adjustment|interest reversal/i;

export const cardPaymentTarget = (
  tx: { type?: string; amount?: number; accountId?: number; toAccountId?: number; merchant?: string; category?: string },
  cardIds: Set<number>,
): { cardId: number; amount: number } | null => {
  const amount = tx.amount ?? 0;
  if (!(amount > 0)) return null;

  if (tx.type === 'transfer' && tx.toAccountId && cardIds.has(tx.toAccountId)) {
    return { cardId: tx.toAccountId, amount };
  }

  if (tx.type === 'credit' && tx.accountId && cardIds.has(tx.accountId)) {
    const text = `${tx.merchant ?? ''} ${tx.category ?? ''}`;
    if (NON_PAYMENT_CREDIT.test(text)) return null;
    return { cardId: tx.accountId, amount };
  }

  return null;
};

/** Drop a transaction's allocations and re-settle whatever it had been paying. */
export const clearCardPaymentForTransaction = async (transactionId: number): Promise<void> => {
  const rows = await db.getAllAsync<{ statementId: number }>(
    'SELECT DISTINCT statementId FROM card_payments WHERE transactionId = ?', transactionId,
  );
  if (rows.length === 0) return;
  await db.runAsync('DELETE FROM card_payments WHERE transactionId = ?', transactionId);
  for (const r of rows) await recomputeStatementPaid(r.statementId);
};

/**
 * Re-settle one transaction against the card statements it can pay.
 *
 * Safe to call as often as you like, on any transaction — that is the point.
 * The salary-credit hook learned the same lesson: the signal that makes a row a
 * card payment (its destination account) is set by the user in review, long
 * after ingest, so every write path re-runs this and the ledger absorbs the
 * repeats. A row that stops being a payment gives its allocation back.
 *
 * Allocation is the bank's own waterfall — oldest open statement first, spilling
 * into the next — restricted to statements whose billing period actually
 * contains the payment. Without that check a payment made before a statement
 * existed would settle it, which is how a naive backfill wipes out real debt.
 */
export const syncCardPaymentForTransaction = async (transactionId: number): Promise<number> => {
  const tx = await getTransactionById(transactionId);
  if (!tx) {
    await clearCardPaymentForTransaction(transactionId);
    return 0;
  }

  const accounts = await getAccounts();
  const cardIds = new Set(
    accounts.filter((a) => a.accountType === 'credit_card').map((a) => a.id),
  );
  const target = cardPaymentTarget(tx, cardIds);

  // Always start from a clean slate for this transaction: an edit may have
  // changed the amount, the destination card, or made it not a payment at all.
  await clearCardPaymentForTransaction(transactionId);
  if (!target) return 0;

  const paidAt = new Date(tx.date).getTime();
  if (Number.isNaN(paidAt)) return 0;

  const open = (await getOpenStatements(target.cardId)).filter(
    (st) => paidAt >= statementOpensAt(st),
  );

  let left = target.amount;
  const now = new Date().toISOString();
  for (const st of open) {
    if (left <= 0.01) break;
    const due = statementRemaining(st);
    if (due <= 0) continue;

    const applied = Math.min(due, left);
    await db.runAsync(
      `INSERT INTO card_payments (transactionId, statementId, accountId, amount, appliedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(transactionId, statementId) DO UPDATE SET amount = excluded.amount, appliedAt = excluded.appliedAt`,
      transactionId, st.id, target.cardId, applied, now,
    );
    await recomputeStatementPaid(st.id);
    left -= applied;
  }

  // Anything left over is advance credit on the card, not a statement payment.
  return target.amount - left;
};

/**
 * Re-settle every payment a card's open statements could plausibly be waiting on.
 *
 * The other direction of the same problem: statements often arrive AFTER the
 * payment. A bank re-sends a reminder days later, or the statement SMS is only
 * read on the next scan — by then the payment transaction is long saved and
 * nothing would ever revisit it. Called whenever a statement is written, so the
 * two can meet in either order.
 */
export const resyncCardPayments = async (accountId: number): Promise<void> => {
  const open = await getOpenStatements(accountId);
  if (open.length === 0) return;

  const since = Math.min(...open.map(statementOpensAt));
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM transactions
      WHERE (type = 'transfer' AND toAccountId = ?)
         OR (type = 'credit' AND accountId = ?)
      ORDER BY date ASC`,
    accountId, accountId,
  );

  // Chronological, so the oldest payment claims the oldest statement — the same
  // order the waterfall assumes.
  for (const row of rows) {
    const tx = mapTransactionRow(row);
    if (new Date(tx.date).getTime() < since) continue;
    await syncCardPaymentForTransaction(tx.id);
  }
};

// ─── Salary dates ────────────────────────────────────────────────────────────

export interface SalaryDate {
  id: number;
  /** ISO timestamp of the actual salary arrival. */
  occurredAt: string;
  source: 'manual' | 'detected';
  createdAt: string;
}

const PENDING_SALARY_KEY = 'pending_salary_date';

/** Recorded salary arrivals, newest first. */
export const getSalaryDates = async (limit = 24): Promise<SalaryDate[]> =>
  await db.getAllAsync<SalaryDate>(
    'SELECT * FROM salary_dates ORDER BY occurredAt DESC LIMIT ?', limit,
  );

/**
 * Record a salary arrival. `INSERT OR REPLACE` on the UNIQUE instant so
 * confirming a detected salary that the user already entered by hand is a no-op
 * rather than a duplicate cycle boundary.
 */
export const addSalaryDate = async (
  occurredAt: string,
  source: SalaryDate['source'] = 'manual',
): Promise<void> => {
  await db.runAsync(
    `INSERT OR REPLACE INTO salary_dates (occurredAt, source, createdAt) VALUES (?, ?, ?)`,
    occurredAt, source, new Date().toISOString(),
  );
  invalidateCycleCache();
};

/** Is this exact instant already a recorded cycle boundary? */
export const salaryDateExists = async (occurredAt: string): Promise<boolean> => {
  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM salary_dates WHERE occurredAt = ?', occurredAt,
  );
  return !!row;
};

/** Move an existing record — the "salary actually came on the 30th, not the 31st" fix. */
export const updateSalaryDate = async (id: number, occurredAt: string): Promise<void> => {
  // occurredAt is UNIQUE. Correcting a record onto an instant another row
  // already holds (the previous cycle's entry, or a detected duplicate) would
  // throw a constraint error and silently abandon the edit — the cycle would
  // stay where it was with nothing to show for the save. Absorb that row
  // instead: two records for one instant were never meaningful anyway.
  await db.runAsync(
    'DELETE FROM salary_dates WHERE occurredAt = ? AND id != ?', occurredAt, id,
  );
  await db.runAsync('UPDATE salary_dates SET occurredAt = ? WHERE id = ?', occurredAt, id);
  invalidateCycleCache();
};

export const deleteSalaryDate = async (id: number): Promise<void> => {
  await db.runAsync('DELETE FROM salary_dates WHERE id = ?', id);
  invalidateCycleCache();
};

/**
 * A detected salary credit awaiting the user's confirmation. Held in
 * app_settings rather than salary_dates so it can never move the budget cycle
 * until the user accepts it.
 */
export const setPendingSalaryDate = async (occurredAt: string): Promise<void> => {
  await db.runAsync(
    'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
    PENDING_SALARY_KEY, occurredAt,
  );
};

export const getPendingSalaryDate = async (): Promise<string | null> => {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?', PENDING_SALARY_KEY,
  );
  return row?.value ?? null;
};

export const clearPendingSalaryDate = async (): Promise<void> => {
  await db.runAsync('DELETE FROM app_settings WHERE key = ?', PENDING_SALARY_KEY);
};

// ─── Echo Pro lifecycle stamps ──────────────────────────────────────────────
// Two timestamps the entitlement resolver (services/entitlements) needs and
// nothing else does. Both live in app_settings — not zustand/SecureStore —
// specifically so they travel with a Google Drive restore: a device that
// reinstalls and restores a backup must not get a second free trial, and a
// device that restores an old backup must not lose its founder grant.
const FIRST_SEEN_AT_KEY = 'first_seen_at';
const TRIAL_STARTED_AT_KEY = 'trial_started_at';

export const getFirstSeenAt = async (): Promise<string | null> => {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?', FIRST_SEEN_AT_KEY,
  );
  return row?.value ?? null;
};

/**
 * Oldest real evidence already in this database — the earliest transaction,
 * account, or recorded salary date. Existing users have months of this by the
 * time Echo Pro ships; a genuinely fresh install has none.
 *
 * The only reason this exists: ensureFirstSeenAt() runs for the first time on
 * every install the moment this code ships, including installs that have been
 * in daily use for months. Stamping "now" for all of them would make an
 * existing user indistinguishable from someone installing today, which is
 * exactly the distinction the founder grant depends on. Backdating to the
 * oldest evidence already on record fixes that without needing an OS-level
 * install date (which does not survive a restore to a new device anyway).
 */
export const getEarliestActivityDate = async (): Promise<string | null> => {
  const row = await db.getFirstAsync<{ earliest: string | null }>(`
    SELECT MIN(d) as earliest FROM (
      SELECT MIN(date) as d FROM transactions
      UNION ALL SELECT MIN(startDate) FROM accounts
      UNION ALL SELECT MIN(occurredAt) FROM salary_dates
    )
  `);
  return row?.earliest ?? null;
};

/**
 * The first moment this install's data existed, stamped once and never again.
 * A no-op once the row exists, so a restored backup keeps whatever it already
 * has rather than being overwritten by this device's "now".
 */
export const ensureFirstSeenAt = async (nowIso: string): Promise<string> => {
  const existing = await getFirstSeenAt();
  if (existing) return existing;

  const earliest = await getEarliestActivityDate();
  const stamp = earliest && earliest < nowIso ? earliest : nowIso;

  await db.runAsync(
    'INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)',
    FIRST_SEEN_AT_KEY, stamp,
  );
  return stamp;
};

export const getTrialStartedAt = async (): Promise<string | null> => {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?', TRIAL_STARTED_AT_KEY,
  );
  return row?.value ?? null;
};

/**
 * Starts the local trial clock, once. `INSERT OR IGNORE` for the same reason
 * as ensureFirstSeenAt: a restored backup must not restart a trial that was
 * already running or already spent on the device it came from.
 *
 * Callers are expected to only invoke this for installs that are not on the
 * founder grant — see services/entitlements — so a founder's app_settings
 * table does not accumulate a trial stamp that will never be read.
 */
export const ensureTrialStarted = async (nowIso: string): Promise<string> => {
  await db.runAsync(
    'INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)',
    TRIAL_STARTED_AT_KEY, nowIso,
  );
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?', TRIAL_STARTED_AT_KEY,
  );
  return row?.value ?? nowIso;
};

/**
 * The budget cycle window, resolved from recorded salary dates (falling back to
 * the recurring anchor until the first one is recorded).
 *
 * Async because the boundaries now live in the database. Callers that already
 * hold the recorded list should use resolveCycle directly to avoid re-querying.
 */
/**
 * Short-lived memo for the resolved cycle.
 *
 * getSalaryCycleWindowAsync re-read salary_dates on every call, and a single
 * dashboard load calls it four times (getCurrentMonthSpend, twice inside
 * getBudgetUtilization, and once directly) for identical data. A 5s TTL collapses
 * those into one query while staying far too short to serve stale boundaries
 * after the user edits their salary date.
 */
let _cycleCache: { key: string; at: number; window: CycleWindow } | null = null;
const CYCLE_CACHE_MS = 5000;

/** Called whenever recorded salary dates change, so the next read is fresh. */
export const invalidateCycleCache = () => { _cycleCache = null; };

export const getSalaryCycleWindowAsync = async (
  anchorLike: CycleAnchor | number,
  shift = 0,
): Promise<CycleWindow> => {
  const anchor = toAnchor(anchorLike);
  const key = `${anchor.day}|${anchor.time}|${shift}`;
  const now = Date.now();
  if (_cycleCache && _cycleCache.key === key && now - _cycleCache.at < CYCLE_CACHE_MS) {
    return _cycleCache.window;
  }

  const recorded = await getSalaryDates();
  const window = resolveCycle(
    recorded.map((r) => r.occurredAt),
    anchor,
    new Date(),
    shift,
  );
  _cycleCache = { key, at: now, window };
  return window;
};

const toAnchor = (anchorLike: CycleAnchor | number | undefined): CycleAnchor =>
  typeof anchorLike === 'number'
    ? cycleAnchorFrom({ salaryDay: anchorLike })
    : anchorLike ?? cycleAnchorFrom({});


/** Monday-start local calendar week, shifted by `shift` weeks. */
const getWeekWindow = (shift = 0) => {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // Mon=0 … Sun=6
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + shift * 7);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { start, end };
};

/** One grouped query: spend per category text within [start, end). */
const getSpendByCategory = async (start: Date, end: Date): Promise<Map<string, number>> => {
  const rows = await db.getAllAsync<{ category: string; total: number }>(
    `SELECT t.category as category, SUM(${EFFECTIVE_DEBIT_AMOUNT}) as total FROM transactions t
     WHERE t.type = 'debit' AND t.isConfirmed = 1
       AND ${NOT_CASHFLOW}
       AND t.date >= ? AND t.date < ?
     GROUP BY t.category`,
    start.toISOString(), end.toISOString()
  );
  return new Map(rows.map((r) => [r.category, r.total ?? 0]));
};

/**
 * Names a set of selections covers: each selected name, plus — when a name is
 * a live parent category — all of its subcategory names. Keeps budgets
 * consistent with the hierarchy-aware Transactions filter and Analytics.
 */
const coveredCategoryNames = (
  selections: string[],
  categories: Category[],
): string[] => {
  const out = new Set<string>();
  for (const name of selections) {
    out.add(name);
    const parent = categories.find((c) => c.name === name && !c.parentId);
    if (parent) {
      categories
        .filter((c) => c.parentId === parent.id)
        .forEach((c) => out.add(c.name));
    }
  }
  return [...out];
};

const sumCovered = (names: string[], byCategory: Map<string, number>): number =>
  names.reduce((acc, n) => acc + (byCategory.get(n) ?? 0), 0);

/**
 * `reached` sits deliberately between `risk` and `over`: spending exactly the
 * limit is not overspending. It earns a warning, not the red an actual breach
 * gets — the last rupee of a budget is still inside it.
 */
export type BudgetPace = 'under' | 'on_track' | 'risk' | 'reached' | 'over';

export interface BudgetUtilization {
  budget: Budget;
  /** label for UI: single name or "First + N more" */
  displayName: string;
  /** how many category names this budget's spend matching covers */
  coveredCount: number;
  spent: number;
  /** % of effective limit used (rounded) */
  percentage: number;
  /** amount + rollover carry from last window (never below 0) */
  effectiveLimit: number;
  /** carried from previous window when rollover enabled (may be negative) */
  rolloverCarry: number;
  remaining: number;
  prevSpent: number;
  daysTotal: number;
  daysLeft: number;
  /** % of the budget window elapsed (rounded) */
  elapsedPct: number;
  /** run-rate projection of spend at window end */
  projectedSpend: number;
  pace: BudgetPace;
  /** true when the budget's category no longer exists */
  orphaned: boolean;
  /**
   * The exact window this row was measured over — the salary cycle for monthly
   * budgets, a Monday-start week for weekly ones. Exposed so a "view
   * transactions" drill-down can filter to the SAME window; without it the list
   * defaulted to all-time and showed far more than the budget counted.
   */
  windowStart: string;
  /** Exclusive end of the measured window. */
  windowEnd: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const getBudgetUtilization = async (
  anchorLike: CycleAnchor | number = 1,
): Promise<BudgetUtilization[]> => {
  // Budget cycle mirrors getCurrentMonthSpend so gauges and month totals agree.
  // Weekly budgets get a real Monday-start week instead.
  const [budgets, categories] = await Promise.all([getBudgets(), getCategories()]);
  if (budgets.length === 0) return [];

  const now = new Date();
  const hasWeekly = budgets.some((b) => b.period === 'weekly');

  const [monthWin, prevMonthWin] = await Promise.all([
    getSalaryCycleWindowAsync(anchorLike),
    getSalaryCycleWindowAsync(anchorLike, -1),
  ]);
  const weekWin = getWeekWindow();
  const prevWeekWin = getWeekWindow(-1);

  const [monthSpendMap, prevMonthSpendMap, weekSpendMap, prevWeekSpendMap] = await Promise.all([
    getSpendByCategory(monthWin.start, monthWin.end),
    getSpendByCategory(prevMonthWin.start, prevMonthWin.end),
    hasWeekly ? getSpendByCategory(weekWin.start, weekWin.end) : Promise.resolve(new Map<string, number>()),
    hasWeekly ? getSpendByCategory(prevWeekWin.start, prevWeekWin.end) : Promise.resolve(new Map<string, number>()),
  ]);

  const liveNames = new Set(categories.map((c) => c.name));

  const results: BudgetUtilization[] = budgets.map((b) => {
    const weekly = b.period === 'weekly';
    const win = weekly ? weekWin : monthWin;
    const selections = budgetSelections(b);
    const names = coveredCategoryNames(selections, categories);
    const spent = sumCovered(names, weekly ? weekSpendMap : monthSpendMap);
    const prevSpent = sumCovered(names, weekly ? prevWeekSpendMap : prevMonthSpendMap);

    const rolloverCarry = b.rollover ? b.amount - prevSpent : 0;
    const effectiveLimit = Math.max(b.amount + rolloverCarry, 0);

    const daysTotal = Math.round((win.end.getTime() - win.start.getTime()) / DAY_MS);
    // Fractional elapsed days (min ¼ day) keep early-window projections sane.
    const elapsedDays = Math.min(
      Math.max((now.getTime() - win.start.getTime()) / DAY_MS, 0.25),
      daysTotal,
    );
    const daysLeft = Math.max(Math.ceil((win.end.getTime() - now.getTime()) / DAY_MS), 0);
    const elapsedPct = Math.round((elapsedDays / daysTotal) * 100);
    const projectedSpend = Math.round((spent / elapsedDays) * daysTotal);

    // Floored, not rounded: a displayed 100% has to mean the limit is genuinely
    // gone. Rounding showed 100% (and, downstream, red and an "exceeded" alert)
    // from 99.5% — with money still left in the budget.
    const percentage =
      effectiveLimit > 0 ? Math.floor((spent / effectiveLimit) * 100) : spent > 0 ? 100 : 0;

    // A rupee of tolerance: spend that lands on the limit to within a minor
    // unit is "reached", not "over". Only a real breach is over.
    const overspend = spent - effectiveLimit;
    let pace: BudgetPace;
    if (overspend >= 1) pace = 'over';
    else if (spent > 0 && overspend >= 0) pace = 'reached';
    else if (projectedSpend > effectiveLimit) pace = 'risk';
    else if (percentage + 10 <= elapsedPct) pace = 'under';
    else pace = 'on_track';

    return {
      budget: b,
      displayName: budgetDisplayName(b),
      coveredCount: names.length,
      spent,
      percentage,
      effectiveLimit,
      rolloverCarry,
      remaining: effectiveLimit - spent,
      prevSpent,
      daysTotal,
      daysLeft,
      elapsedPct,
      projectedSpend,
      pace,
      windowStart: win.start.toISOString(),
      windowEnd: win.end.toISOString(),
      // Orphaned only when every selected category is gone — partial losses
      // still match remaining names.
      orphaned: selections.every((n) => !liveNames.has(n)),
    };
  });

  // Urgency first: blown budgets, then at-risk pace, then the rest by usage.
  // Orphaned budgets sink to the bottom for cleanup.
  // Urgency order: a budget with nothing left outranks one merely pacing badly.
  const paceRank: Record<BudgetPace, number> = {
    over: 0, reached: 1, risk: 2, on_track: 3, under: 4,
  };
  return results.sort((a, b) => {
    if (a.orphaned !== b.orphaned) return a.orphaned ? 1 : -1;
    if (paceRank[a.pace] !== paceRank[b.pace]) return paceRank[a.pace] - paceRank[b.pace];
    return b.percentage - a.percentage;
  });
};

export interface BudgetSummary {
  /** sum of effective limits of monthly category budgets */
  totalBudgeted: number;
  /** cycle spend inside categories covered by a monthly budget (deduped) */
  budgetedSpent: number;
  /** total cycle spend (same number the dashboard hero uses) */
  cycleSpend: number;
  /** spend in categories no budget covers */
  unbudgetedSpend: number;
}

/** Reconciles category budgets against the overall cycle spend. */
export const getBudgetSummary = async (
  anchorLike: CycleAnchor | number = 1,
): Promise<BudgetSummary> => {
  const [util, categories] = await Promise.all([
    getBudgetUtilization(anchorLike),
    getCategories(),
  ]);
  const monthWin = await getSalaryCycleWindowAsync(anchorLike);
  const spendMap = await getSpendByCategory(monthWin.start, monthWin.end);
  const cycleSpend = [...spendMap.values()].reduce((a, v) => a + v, 0);

  const monthly = util.filter((u) => u.budget.period === 'monthly' && !u.orphaned);
  const covered = new Set<string>();
  monthly.forEach((u) =>
    coveredCategoryNames(budgetSelections(u.budget), categories).forEach((n) =>
      covered.add(n),
    ),
  );
  const budgetedSpent = sumCovered([...covered], spendMap);

  return {
    totalBudgeted: monthly.reduce((a, u) => a + u.effectiveLimit, 0),
    budgetedSpent,
    cycleSpend,
    unbudgetedSpend: Math.max(cycleSpend - budgetedSpent, 0),
  };
};

/**
 * Average spend for a category (hierarchy-aware) over the last 3 completed
 * windows — used to suggest a realistic amount when creating/editing a budget.
 */
export const getSuggestedBudgetAmount = async (
  selections: string[],
  period: 'monthly' | 'weekly',
  // Historical windows only (shift -1/-2/-3), so the rule is used without any
  // detection snap — past cycles must stay stable.
  anchorLike: CycleAnchor | number = 1,
): Promise<number | null> => {
  if (selections.length === 0) return null;
  const categories = await getCategories();
  const names = coveredCategoryNames(selections, categories);
  // Three independent windows — resolve and query them in parallel rather than
  // six sequential round-trips.
  const windows = await Promise.all(
    [-1, -2, -3].map((shift) =>
      period === 'weekly'
        ? Promise.resolve(getWeekWindow(shift))
        : getSalaryCycleWindowAsync(anchorLike, shift),
    ),
  );
  const maps = await Promise.all(
    windows.map((win) => getSpendByCategory(win.start, win.end)),
  );
  const sums = maps.map((map) => sumCovered(names, map));
  const active = sums.filter((s) => s > 0);
  if (active.length === 0) return null;
  return Math.round(active.reduce((a, v) => a + v, 0) / active.length);
};

/**
 * The budget affected by spend in `categoryName`: an exact budget on the
 * category wins, otherwise a budget on its parent. Used for the post-save
 * "budget impact" toast.
 */
export const getBudgetImpactForCategory = async (
  categoryName: string,
  anchorLike: CycleAnchor | number = 1,
): Promise<BudgetUtilization | null> => {
  const [util, categories] = await Promise.all([
    getBudgetUtilization(anchorLike),
    getCategories(),
  ]);
  // A budget explicitly selecting this category wins; otherwise any budget
  // whose expanded coverage (parent → subs) includes it. `util` is urgency-
  // sorted, so ties resolve to the most pressing budget.
  const explicit = util.find(
    (u) => !u.orphaned && budgetSelections(u.budget).includes(categoryName),
  );
  if (explicit) return explicit;
  return (
    util.find(
      (u) =>
        !u.orphaned &&
        coveredCategoryNames(budgetSelections(u.budget), categories).includes(
          categoryName,
        ),
    ) ?? null
  );
};

// ─── Insights ────────────────────────────────────────────────────────────────

export const getActiveInsights = async (): Promise<Insight[]> => {
  return await db.getAllAsync<Insight>(
    'SELECT * FROM insights WHERE dismissedAt IS NULL ORDER BY generatedAt DESC LIMIT 10'
  );
};

/**
 * When insights were last generated, dismissed rows included.
 *
 * Deliberately NOT filtered by dismissedAt: the daily-freshness check must ask
 * "did we already generate today?", not "are any still on screen?". Using
 * getActiveInsights() for this meant dismissing every card made the dashboard
 * think none had ever been generated, so it immediately regenerated the same
 * set — the user's dismissals appeared to undo themselves on every revisit.
 */
export const getLastInsightGenerationDate = async (): Promise<string | null> => {
  const row = await db.getFirstAsync<{ latest: string | null }>(
    'SELECT MAX(generatedAt) as latest FROM insights'
  );
  return row?.latest ?? null;
};

export const saveInsight = async (insight: Omit<Insight, 'id'>) => {
  await db.runAsync(
    'INSERT INTO insights (type, title, body, generatedAt) VALUES (?, ?, ?, ?)',
    insight.type, insight.title, insight.body, insight.generatedAt,
  );
};

export const dismissInsight = async (id: number) => {
  await db.runAsync(
    'UPDATE insights SET dismissedAt = ? WHERE id = ?',
    new Date().toISOString(), id
  );
};

export const pruneOldInsights = async () => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  await db.runAsync('DELETE FROM insights WHERE generatedAt < ?', cutoff.toISOString());
};

// ─── Merchant Mappings ───────────────────────────────────────────────────────

export const getMerchantMapping = async (merchantRaw: string): Promise<MerchantMapping | null> => {
  return await db.getFirstAsync<MerchantMapping>(
    'SELECT * FROM merchant_mappings WHERE LOWER(merchantRaw) = LOWER(?)',
    merchantRaw
  ) ?? null;
};

export const upsertMerchantMapping = async (
  merchantRaw: string,
  merchantClean: string,
  categoryName: string
) => {
  await db.runAsync(
    `INSERT INTO merchant_mappings (merchantRaw, merchantClean, categoryName, usageCount)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(merchantRaw) DO UPDATE SET
       merchantClean = excluded.merchantClean,
       categoryName = excluded.categoryName,
       usageCount = usageCount + 1`,
    merchantRaw, merchantClean, categoryName
  );
};

export const getTopMerchantMappings = async (limit = 20): Promise<MerchantMapping[]> => {
  return await db.getAllAsync<MerchantMapping>(
    'SELECT * FROM merchant_mappings ORDER BY usageCount DESC LIMIT ?',
    limit
  );
};

// ─── SMS Deduplication ───────────────────────────────────────────────────────

export const isSmsAlreadyProcessed = async (hash: string): Promise<boolean> => {
  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM sms_hashes WHERE hash = ?', hash
  );
  return !!row;
};

export const markSmsProcessed = async (hash: string) => {
  await db.runAsync(
    'INSERT OR IGNORE INTO sms_hashes (hash, processedAt) VALUES (?, ?)',
    hash, new Date().toISOString()
  );
};

export const markSmsBatchProcessed = async (hashes: string[]) => {
  if (hashes.length === 0) return;
  const chunked = [];
  for (let i = 0; i < hashes.length; i += 100) {
    chunked.push(hashes.slice(i, i + 100));
  }
  for (const chunk of chunked) {
    const placeholders = chunk.map(() => '(?, ?)').join(',');
    const values = chunk.flatMap(h => [h, new Date().toISOString()]);
    await db.runAsync(
      `INSERT OR IGNORE INTO sms_hashes (hash, processedAt) VALUES ${placeholders}`,
      ...values
    );
  }
};

/**
 * Only the hashes among `candidates` that have already been processed.
 *
 * Replaces loading the entire sms_hashes table into memory: that grew without
 * bound (one row per SMS ever seen) and was re-read on every scan. Chunked
 * because SQLite caps host parameters per statement.
 */
export const getProcessedHashesFor = async (candidates: string[]): Promise<Set<string>> => {
  const found = new Set<string>();
  if (candidates.length === 0) return found;

  const CHUNK = 400;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    const rows = await db.getAllAsync<{ hash: string }>(
      `SELECT hash FROM sms_hashes WHERE hash IN (${chunk.map(() => '?').join(',')})`,
      ...chunk,
    );
    for (const r of rows) found.add(r.hash);
  }
  return found;
};

/**
 * Drop SMS hashes older than `days`.
 *
 * Safe because scans never re-read that far back — account scan ranges are
 * bounded by lastScannedDate — and anything that did become a transaction is
 * still caught by the rawSmsHash dedup. Without this the table grows forever.
 */
/**
 * Drop stored SMS bodies once they can no longer be useful.
 *
 * rawSms exists so the deferred AI pass can re-parse a regex-only transaction,
 * and so the user can audit what a row came from. Once a transaction is both
 * confirmed and AI-enriched neither applies, and the text is dead weight — it is
 * the largest per-row column in the database. The indexed rawSmsHash is kept, so
 * duplicate detection still works after the body is gone.
 */
export const pruneStoredSmsBodies = async (olderThanDays = 60): Promise<number> => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  const res = await db.runAsync(
    `UPDATE transactions SET rawSms = NULL
      WHERE rawSms IS NOT NULL
        AND isConfirmed = 1
        AND aiEnriched = 1
        AND date < ?`,
    cutoff.toISOString(),
  );
  return res.changes ?? 0;
};

export const pruneOldSmsHashes = async (days = 90): Promise<void> => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  await db.runAsync('DELETE FROM sms_hashes WHERE processedAt < ?', cutoff.toISOString());
};

/** @deprecated Loads the whole table. Use getProcessedHashesFor or isSmsAlreadyProcessed. */
export const getAllSmsHashes = async (): Promise<Set<string>> => {
  const rows = await db.getAllAsync<{ hash: string }>('SELECT hash FROM sms_hashes');
  return new Set(rows.map(r => r.hash));
};

/**
 * Returns true if ANY transaction (confirmed OR unconfirmed) already exists with
 * this exact SMS body. This prevents re-importing the same SMS text that is
 * already sitting in the review queue or was previously confirmed.
 */
export const isRawSmsAlreadyExists = async (rawSms: string): Promise<boolean> => {
  // Matches on the indexed hash, not the full text. hashSms normalizes
  // whitespace and case, so this is also slightly more tolerant than the old
  // exact-string compare — two copies of the same SMS that differ only in
  // spacing now correctly dedupe.
  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM transactions WHERE rawSmsHash = ? LIMIT 1',
    hashSms(rawSms),
  );
  return !!row;
};

/** @deprecated Use isRawSmsAlreadyExists — kept for backward compat */
export const isRawSmsAlreadyConfirmed = isRawSmsAlreadyExists;

/**
 * Smart semantic deduplication: returns true if a transaction with the same
 * amount, type, and account already exists within a ±2-hour window of the
 * given date. This catches duplicates even when:
 *  - SMS body has trivial whitespace/encoding differences
 *  - Hash table was cleared (migration v1)
 *  - A manual entry was added before the SMS was scanned
 *
 * The 2-hour window is narrow enough to avoid blocking genuinely separate
 * transactions at the same merchant on different days, but wide enough to
 * handle timezone drift and value-date vs. transaction-date differences
 * within a single day.
 */
export const isSmsDuplicateTransaction = async (
  amount: number,
  type: 'credit' | 'debit' | 'transfer',
  date: string,
  accountId?: number,
): Promise<boolean> => {
  const ts = new Date(date).getTime();
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const minDate = new Date(ts - TWO_HOURS_MS).toISOString();
  const maxDate = new Date(ts + TWO_HOURS_MS).toISOString();

  // When accountId is available, scope to same account for precision.
  // When unavailable, check globally but require exact amount + type + tight window.
  if (accountId) {
    const row = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM transactions
       WHERE amount = ? AND type = ? AND accountId = ?
         AND date BETWEEN ? AND ?
       LIMIT 1`,
      amount, type, accountId, minDate, maxDate,
    );
    return !!row;
  }

  const row = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM transactions
     WHERE amount = ? AND type = ?
       AND date BETWEEN ? AND ?
     LIMIT 1`,
    amount, type, minDate, maxDate,
  );
  return !!row;
};

/**
 * Returns the date of the most recent confirmed transaction that came from an SMS
 * (source = 'sms' or 'auto'). Used by the rescan flow to automatically determine
 * how far back to re-read SMS.
 */
export const getLastConfirmedSmsTransactionDate = async (): Promise<string | null> => {
  const row = await db.getFirstAsync<{ date: string }>(
    `SELECT date FROM transactions
     WHERE isConfirmed = 1 AND source IN ('sms', 'auto')
     ORDER BY date DESC LIMIT 1`,
  );
  return row?.date ?? null;
};

/**
 * Remove all SMS hashes that were recorded on or after the given ISO date string.
 * This unblocks SMS that were incorrectly hash-locked during a previous scan so
 * they can be re-processed when the user rescans from that date.
 */
export const clearSmsHashesSince = async (isoDate: string): Promise<void> => {
  await db.runAsync('DELETE FROM sms_hashes WHERE processedAt >= ?', isoDate);
};

/**
 * Roll back the scan cursor for all bank and credit-card accounts to the given ISO
 * date string. Combined with clearSmsHashesSince(), this lets the user re-scan any
 * window of time.
 */
export const resetAllAccountScanDates = async (isoDate: string): Promise<void> => {
  await db.runAsync(
    "UPDATE accounts SET lastScannedDate = ? WHERE accountType IN ('bank', 'credit_card')",
    isoDate,
  );
};

// ─── Subscriptions ──────────────────────────────────────────────────────────

export const getSubscriptions = async (activeOnly = false): Promise<Subscription[]> => {
  const where = activeOnly ? 'WHERE isActive = 1' : '';
  return await db.getAllAsync<Subscription>(`SELECT * FROM subscriptions ${where} ORDER BY nextDueDate ASC`);
};

export const getSubscriptionById = async (id: number): Promise<Subscription | null> => {
  return await db.getFirstAsync<Subscription>('SELECT * FROM subscriptions WHERE id = ?', id) ?? null;
};

export const getGoalById = async (id: number): Promise<Goal | null> => {
  return await db.getFirstAsync<Goal>('SELECT * FROM goals WHERE id = ?', id) ?? null;
};

export const getLoanById = async (id: number): Promise<Loan | null> => {
  return await db.getFirstAsync<Loan>('SELECT * FROM loans WHERE id = ?', id) ?? null;
};

export const addSubscription = async (sub: Omit<Subscription, 'id'>) => {
  await db.runAsync(
    `INSERT INTO subscriptions
       (name, amount, category, frequency, nextDueDate, lastPaidDate, isActive,
        debitAccountId, splitEnabled, splitMembers, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sub.name, sub.amount, sub.category, sub.frequency, sub.nextDueDate,
    sub.lastPaidDate ?? null, sub.isActive ? 1 : 0,
    sub.debitAccountId ?? null,
    sub.splitEnabled ? 1 : 0,
    sub.splitMembers ?? null,
    sub.notes ?? null,
    // The chosen due date defines the billing day.
    sub.billingDay ?? new Date(sub.nextDueDate).getDate(),
  );
};

/**
 * Advance an ISO date by one billing cycle.
 *
 * `anchorDay` is the day of the month the bill really falls on. Without it a
 * 31st bill clamps to the 28th in February and then chains from 28 forever —
 * the same compounding drift salaryCycle's addMonthsClamped exists to prevent.
 * Passing the anchor restores the 31st in every month long enough to have one.
 */
export const nextBillingDate = (
  from: string,
  frequency: Subscription['frequency'],
  anchorDay?: number,
): string => {
  const d = new Date(from);
  if (frequency === 'weekly') {
    d.setDate(d.getDate() + 7);
    return d.toISOString();
  }
  const months = frequency === 'yearly' ? 12 : 1;
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const daysInTarget = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  const day = Math.min(anchorDay ?? d.getDate(), daysInTarget);
  return new Date(
    target.getFullYear(), target.getMonth(), day,
    d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds(),
  ).toISOString();
};

/** One billing cycle earlier — the start of the period `from` closes. */
const previousBillingDate = (from: string, frequency: Subscription['frequency']): string => {
  const d = new Date(from);
  if (frequency === 'weekly') d.setDate(d.getDate() - 7);
  else if (frequency === 'yearly') d.setFullYear(d.getFullYear() - 1);
  else d.setMonth(d.getMonth() - 1);
  return d.toISOString();
};

/**
 * Record a subscription payment: creates a confirmed debit transaction from the
 * linked account, auto-creates a split if the subscription is shared, and
 * advances the nextDueDate by one billing cycle.
 *
 * `amount` and `date` are honoured when given — the pay sheet lets the user edit
 * the amount, and it used to be validated and then thrown away, so a changed
 * subscription price was silently recorded at the old one.
 */
export const paySubscription = async (
  id: number,
  opts?: { amount?: number; date?: string },
): Promise<{ txId: number; splitId?: number }> => {
  const sub = await db.getFirstAsync<Subscription>('SELECT * FROM subscriptions WHERE id = ?', id);
  if (!sub) throw new Error('Subscription not found');

  const now = opts?.date ?? new Date().toISOString();
  const amount = opts?.amount && opts.amount > 0 ? opts.amount : sub.amount;

  // The bank's own SMS for this charge may already be in the ledger — an autopaid
  // subscription always is. Recording a second transaction for the same charge
  // double-counts the spend, so adopt the existing row instead and just settle
  // the cycle. Matched on the link plus the current period.
  // Window: since the last settled payment, or one cycle back when nothing has
  // been recorded yet. An open-ended search would adopt a charge from months ago.
  const cycleStart = sub.lastPaidDate ?? previousBillingDate(sub.nextDueDate, sub.frequency);
  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM transactions
      WHERE subscriptionId = ? AND type = 'debit' AND isConfirmed = 1 AND date > ?
      ORDER BY date DESC LIMIT 1`,
    id, cycleStart,
  );
  if (existing) {
    await advanceSubscriptionCycle(id, now, existing.id);
    return { txId: existing.id };
  }

  const txId = await addTransaction({
    amount,
    category: sub.category,
    merchant: sub.name,
    type: 'debit',
    date: now,
    accountId: sub.debitAccountId ?? undefined,
    isConfirmed: true,
    isRecurring: true,
    subscriptionId: id,
    source: 'manual',
    confidence: 'high',
    notes: sub.notes ?? `${sub.name} — ${sub.frequency} subscription`,
  });

  let splitId: number | undefined;
  if (sub.splitEnabled && sub.splitMembers) {
    try {
      const members = JSON.parse(sub.splitMembers) as { name: string }[];
      if (members.length > 0) {
        const totalPeople = members.length + 1; // +1 for me
        const perShare = Math.round((amount / totalPeople) * 100) / 100;
        const myShare = Math.round((amount - perShare * members.length) * 100) / 100;
        splitId = await createSplit(
          {
            transactionId: txId,
            title: sub.name,
            totalAmount: amount,
            paidByAccountId: sub.debitAccountId ?? undefined,
            receiveToAccountId: sub.debitAccountId ?? undefined,
            date: now,
            notes: `Split for ${sub.name}`,
          },
          [
            { name: 'Me', share: myShare, isMe: true, isPaid: true },
            ...members.map(m => ({ name: m.name, share: perShare, isMe: false, isPaid: false })),
          ],
        );
      }
    } catch (_) { /* ignore JSON parse errors */ }
  }

  await advanceSubscriptionCycle(id, now, txId);
  return { txId, splitId };
};

/**
 * Move a subscription on by one cycle, recording which transaction did it.
 *
 * `lastPaidTxId` is what makes this safe to call from every write path: the same
 * payment re-examined on a later edit is recognised and ignored, instead of
 * skipping the schedule forward another month each time.
 *
 * The next due date is computed from the date already scheduled, not from the
 * payment — paying rent three days late must not move rent to the 4th forever.
 * It rolls forward until it is in the future, so a subscription that went unpaid
 * for months catches up in one step rather than staying stuck in the past.
 */
export const advanceSubscriptionCycle = async (
  id: number,
  paidAt: string,
  transactionId: number,
): Promise<void> => {
  const sub = await db.getFirstAsync<Subscription>('SELECT * FROM subscriptions WHERE id = ?', id);
  if (!sub) return;
  if (sub.lastPaidTxId === transactionId) return;

  // The day the bill truly falls on, so months shorter than it don't move it
  // permanently. Older rows have no stored anchor and keep their current day.
  const anchor = sub.billingDay ?? new Date(sub.nextDueDate).getDate();

  let next = nextBillingDate(sub.nextDueDate, sub.frequency, anchor);
  const paidMs = new Date(paidAt).getTime();
  // Guard against a runaway loop on a corrupt date.
  for (let i = 0; i < 60 && new Date(next).getTime() <= paidMs; i++) {
    next = nextBillingDate(next, sub.frequency, anchor);
  }

  await updateSubscription(id, {
    lastPaidDate: paidAt,
    nextDueDate: next,
    lastPaidTxId: transactionId,
  });
};

/**
 * Undo the advance a now-deleted transaction caused.
 *
 * Steps the due date back one cycle and clears the marker, so the subscription
 * is owed again rather than silently skipping a month.
 */
export const revertSubscriptionCycleFor = async (transactionId: number): Promise<void> => {
  const sub = await db.getFirstAsync<Subscription>(
    'SELECT * FROM subscriptions WHERE lastPaidTxId = ?', transactionId,
  );
  if (!sub) return;

  const back = new Date(sub.nextDueDate);
  if (sub.frequency === 'weekly') back.setDate(back.getDate() - 7);
  else if (sub.frequency === 'yearly') back.setFullYear(back.getFullYear() - 1);
  else back.setMonth(back.getMonth() - 1);

  await db.runAsync(
    'UPDATE subscriptions SET nextDueDate = ?, lastPaidDate = NULL, lastPaidTxId = NULL WHERE id = ?',
    back.toISOString(), sub.id,
  );
};

/**
 * Settle a subscription from a transaction linked to it.
 *
 * The link is usually made long after the charge is saved — the SMS parser or
 * the user picks the subscription in review — and until now nothing acted on it,
 * so the only way to advance an autopaid subscription was the Pay button, which
 * duplicated the charge. Safe to call on any transaction, as often as you like.
 */
export const syncSubscriptionFromTransaction = async (transactionId: number): Promise<void> => {
  const tx = await getTransactionById(transactionId);
  if (!tx?.subscriptionId || tx.type !== 'debit' || !tx.isConfirmed) return;

  const sub = await db.getFirstAsync<Subscription>(
    'SELECT * FROM subscriptions WHERE id = ?', tx.subscriptionId,
  );
  if (!sub || !sub.isActive) return;

  // Only a charge at or after the period we are waiting on settles it. An older
  // transaction being edited is history, not a new payment.
  const paidMs = new Date(tx.date).getTime();
  if (sub.lastPaidDate && paidMs <= new Date(sub.lastPaidDate).getTime()) return;

  await advanceSubscriptionCycle(sub.id, tx.date, transactionId);
};

export const updateSubscription = async (id: number, fields: Partial<Omit<Subscription, 'id'>>) => {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setClauses = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => {
    const v = (fields as any)[k];
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v ?? null;
  });
  await db.runAsync(`UPDATE subscriptions SET ${setClauses} WHERE id = ?`, ...values, id);
};

export const deleteSubscription = async (id: number) => {
  await db.runAsync('DELETE FROM subscriptions WHERE id = ?', id);
};

// ─── Goals ───────────────────────────────────────────────────────────────────

export const getGoals = async (activeOnly = false): Promise<Goal[]> => {
  const where = activeOnly ? 'WHERE isActive = 1' : '';
  return await db.getAllAsync<Goal>(`SELECT * FROM goals ${where} ORDER BY deadline ASC`);
};

export const addGoal = async (goal: Omit<Goal, 'id'>) => {
  await db.runAsync(
    `INSERT INTO goals
       (name, targetAmount, currentAmount, deadline, category, isActive,
        linkedAccountId, monthlyContribution, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    goal.name, goal.targetAmount, goal.currentAmount, goal.deadline ?? null,
    goal.category, goal.isActive ? 1 : 0,
    goal.linkedAccountId ?? null,
    goal.monthlyContribution ?? null,
    goal.notes ?? null,
  );
};

/**
 * Add a contribution to a goal: creates a confirmed debit transaction from the
 * linked account and updates the goal's currentAmount.
 */
export const contributeToGoal = async (
  goalId: number,
  amount: number,
  accountId?: number,
): Promise<number> => {
  const goal = await db.getFirstAsync<Goal>('SELECT * FROM goals WHERE id = ?', goalId);
  if (!goal) throw new Error('Goal not found');

  const txId = await addTransaction({
    amount,
    category: goal.category,
    merchant: goal.name,
    type: 'debit',
    date: new Date().toISOString(),
    accountId: accountId ?? goal.linkedAccountId ?? undefined,
    isConfirmed: true,
    goalId,
    source: 'manual',
    confidence: 'high',
    notes: `Contribution to "${goal.name}"`,
  });
  return txId;
};

export const updateGoalCurrentAmount = async (id: number, contribution: number) => {
  await db.runAsync('UPDATE goals SET currentAmount = currentAmount + ? WHERE id = ?', contribution, id);
};

export const updateGoal = async (id: number, fields: Partial<Omit<Goal, 'id'>>) => {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setClauses = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => {
    const v = (fields as any)[k];
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v ?? null;
  });
  await db.runAsync(`UPDATE goals SET ${setClauses} WHERE id = ?`, ...values, id);
};

export const deleteGoal = async (id: number) => {
  await db.runAsync('DELETE FROM goals WHERE id = ?', id);
};

// ─── Loans ───────────────────────────────────────────────────────────────────

export const getLoans = async (activeOnly = false): Promise<Loan[]> => {
  const where = activeOnly ? 'WHERE isActive = 1 AND remainingAmount > 0' : '';
  return await db.getAllAsync<Loan>(`SELECT * FROM loans ${where} ORDER BY nextDueDate ASC`);
};

export const addLoan = async (loan: Omit<Loan, 'id'>) => {
  const result = await db.runAsync(
    `INSERT INTO loans
       (lender, totalAmount, remainingAmount, emiAmount, nextDueDate, interestRate, isActive, type,
        linkedAccountId, tenure, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    loan.lender, loan.totalAmount, loan.remainingAmount, loan.emiAmount,
    loan.nextDueDate, loan.interestRate ?? null, loan.isActive ? 1 : 0, loan.type,
    loan.linkedAccountId ?? null,
    loan.tenure ?? null,
    loan.notes ?? null,
  );
  return result.lastInsertRowId;
};

/**
 * Record a loan EMI/repayment:
 * - Borrowed: creates a debit tx from linked account, reduces remainingAmount, advances nextDueDate.
 * - Lent: creates a credit tx to linked account, reduces remainingAmount, advances nextDueDate.
 */
export const recordLoanPayment = async (
  loanId: number,
  amount: number,
  accountId?: number,
): Promise<number> => {
  const loan = await db.getFirstAsync<Loan>('SELECT * FROM loans WHERE id = ?', loanId);
  if (!loan) throw new Error('Loan not found');

  const txType = loan.type === 'lent' ? 'credit' : 'debit';
  const resolvedAccountId = accountId ?? loan.linkedAccountId ?? undefined;

  const txId = await addTransaction({
    amount,
    category: 'Bills',
    merchant: loan.lender,
    type: txType,
    date: new Date().toISOString(),
    accountId: resolvedAccountId,
    isConfirmed: true,
    loanId,
    source: 'manual',
    confidence: 'high',
    notes: loan.type === 'lent'
      ? `Repayment received from ${loan.lender}`
      : `EMI payment to ${loan.lender}`,
  });

  return txId;
};

export const updateLoanRemainingAmount = async (id: number, payment: number) => {
  await db.runAsync('UPDATE loans SET remainingAmount = remainingAmount - ? WHERE id = ?', payment, id);
};

export const updateLoan = async (id: number, fields: Partial<Omit<Loan, 'id'>>) => {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setClauses = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => {
    const v = (fields as any)[k];
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v ?? null;
  });
  await db.runAsync(`UPDATE loans SET ${setClauses} WHERE id = ?`, ...values, id);
};

export const deleteLoan = async (id: number) => {
  await db.runAsync('DELETE FROM loans WHERE id = ?', id);
};

// ─── Data Management ─────────────────────────────────────────────────────────

export const getAllTransactionsForExport = async (): Promise<Transaction[]> => {
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM transactions WHERE isConfirmed = 1 ORDER BY date DESC'
  );
  return rows.map(mapTransactionRow);
};

export const isTransactionDuplicate = async (
  amount: number,
  type: 'credit' | 'debit' | 'transfer',
  date: string,
  /** Number of days tolerance on either side (default 1 — handles value-date vs transaction-date drift) */
  toleranceDays = 1
): Promise<boolean> => {
  const ts = new Date(date).getTime();
  const msPerDay = 86_400_000;
  const minDate = new Date(ts - toleranceDays * msPerDay).toISOString().slice(0, 10);
  const maxDate = new Date(ts + toleranceDays * msPerDay).toISOString().slice(0, 10);

  const row = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM transactions
     WHERE amount = ? AND type = ? AND isConfirmed = 1
       AND substr(date, 1, 10) BETWEEN ? AND ?`,
    amount,
    type,
    minDate,
    maxDate,
  );
  return !!row;
};

export const deleteTransactionsBySource = async (source: string) => {
  const txs = await db.getAllAsync<any>(
    'SELECT * FROM transactions WHERE source = ?', source
  );
  const mappedTxs = txs.map(mapTransactionRow);
  for (const tx of mappedTxs) {
    if (tx.isConfirmed) {
      await revertTransactionImpact(tx);
    }
  }
  await db.runAsync('DELETE FROM transactions WHERE source = ?', source);
};

export const debugDump = async (): Promise<string> => {
  const accounts = await db.getAllAsync<any>('SELECT id, name, accountType, balance FROM accounts ORDER BY id');
  const txStats = await db.getAllAsync<any>(`
    SELECT
      accountId,
      isTransfer,
      type,
      COUNT(*) as cnt,
      SUM(amount) as total
    FROM transactions
    WHERE isConfirmed = 1
    GROUP BY accountId, isTransfer, type
    ORDER BY accountId, isTransfer, type
  `);
  const txCount = await db.getFirstAsync<{count:number}>('SELECT COUNT(*) as count FROM transactions WHERE isConfirmed=1');
  const transferCount = await db.getFirstAsync<{count:number}>('SELECT COUNT(*) as count FROM transactions WHERE isTransfer=1 AND isConfirmed=1');
  const lines: string[] = ['=== ECHO SPEND DEBUG DUMP ==='];
  lines.push(`Total confirmed txns: ${txCount?.count}, transfers: ${transferCount?.count}`);
  lines.push('--- ACCOUNTS ---');
  for (const a of accounts) {
    lines.push(`[${a.id}] ${a.name} (${a.accountType}): balance=${a.balance}`);
    const rows = txStats.filter((r: any) => r.accountId === a.id);
    for (const r of rows) {
      lines.push(`  isTransfer=${r.isTransfer} type=${r.type}: count=${r.cnt} total=${r.total?.toFixed(2)}`);
    }
  }
  return lines.join('\n');
};

export const resetAllData = async () => {
  // Delete in dependency order to satisfy FK constraints (children before parents).
  // We use DELETE instead of DROP to maintain a stable connection and avoid NullPointerExceptions in SQLite v2.
  await db.execAsync('DELETE FROM split_members;');
  await db.execAsync('DELETE FROM splits;');
  await db.execAsync('DELETE FROM transactions;');
  await db.execAsync('DELETE FROM subscriptions;');
  await db.execAsync('DELETE FROM goals;');
  await db.execAsync('DELETE FROM loans;');
  await db.execAsync('DELETE FROM accounts;');
  await db.execAsync('DELETE FROM budgets;');
  await db.execAsync('DELETE FROM insights;');
  await db.execAsync('DELETE FROM merchant_mappings;');
  await db.execAsync('DELETE FROM sms_hashes;');
  await db.execAsync('DELETE FROM app_settings;');
  await db.execAsync('DELETE FROM categories;');
  // Clear tombstones too — a factory reset must restore the full default set,
  // and without this the re-seed below would skip every category the user had
  // ever deleted, leaving them permanently missing.
  await db.execAsync('DELETE FROM deleted_default_categories;');

  // Re-seed default categories so the app isn't empty after reset
  await seedDatabase();
};


// ─── Splits ───────────────────────────────────────────────────────────────────

export const createSplit = async (
  split: Omit<Split, 'id'>,
  members: Omit<SplitMember, 'id' | 'splitId'>[],
): Promise<number> => {
  const result = await db.runAsync(
    `INSERT INTO splits (transactionId, title, totalAmount, paidByAccountId, receiveToAccountId, date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    split.transactionId ?? null,
    split.title,
    split.totalAmount,
    split.paidByAccountId ?? null,
    split.receiveToAccountId ?? null,
    split.date,
    split.notes ?? null,
  );
  const splitId = result.lastInsertRowId as number;

  for (const m of members) {
    await db.runAsync(
      `INSERT INTO split_members (splitId, name, share, isMe, isPaid, paidDate, repaidToAccountId)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      splitId, m.name, m.share,
      m.isMe ? 1 : 0,
      m.isPaid ? 1 : 0,
      m.paidDate ?? null,
      m.repaidToAccountId ?? null,
    );
  }
  return splitId;
};

export const getSplits = async (): Promise<SplitWithStats[]> => {
  const rows = await db.getAllAsync<any>(
    `SELECT s.*,
       COUNT(sm.id) AS memberCount,
       SUM(CASE WHEN sm.isMe=0 AND sm.isPaid=0 THEN 1 ELSE 0 END) AS pendingCount,
       SUM(CASE WHEN sm.isMe=0 THEN (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t WHERE t.splitMemberId = sm.id) ELSE 0 END) AS collectedAmount,
       SUM(CASE WHEN sm.isMe=0 THEN MAX(0, sm.share - (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t WHERE t.splitMemberId = sm.id)) ELSE 0 END) AS pendingAmount
     FROM splits s
     LEFT JOIN split_members sm ON sm.splitId = s.id
     GROUP BY s.id
     ORDER BY s.date DESC`,
  );
  return rows.map(r => ({
    ...r,
    memberCount: r.memberCount ?? 0,
    pendingCount: r.pendingCount ?? 0,
    collectedAmount: r.collectedAmount ?? 0,
    pendingAmount: r.pendingAmount ?? 0,
  }));
};

export const getSplitById = async (id: number): Promise<{ split: Split; members: (SplitMember & { paidAmount: number })[] } | null> => {
  const split = await db.getFirstAsync<Split>('SELECT * FROM splits WHERE id = ?', id);
  if (!split) return null;
  const rawMembers = await db.getAllAsync<any>(
    `SELECT sm.*,
            COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.splitMemberId = sm.id), 0) AS paidAmount
     FROM split_members sm
     WHERE sm.splitId = ?
     ORDER BY sm.isMe DESC, sm.id ASC`,
    id,
  );
  const members = rawMembers.map(m => ({
    ...m,
    isMe: m.isMe === 1,
    isPaid: m.isPaid === 1,
    paidAmount: m.paidAmount ?? 0,
  }));
  return { split, members };
};

export const getTransactionSplit = async (transactionId: number): Promise<SplitWithStats | null> => {
  const splits = await getSplits();
  return splits.find(s => s.transactionId === transactionId) ?? null;
};

export const receiveSplitPayment = async (
  memberId: number,
  accountId: number,
  splitTitle: string,
  memberName: string,
  amount?: number,
): Promise<number> => {
  const member = await db.getFirstAsync<any>(
    'SELECT * FROM split_members WHERE id = ?', memberId,
  );
  if (!member) throw new Error('Member not found');

  const today = new Date().toISOString().split('T')[0];

  // Calculate remaining balance to default the amount if not provided
  let paymentAmount = amount;
  if (paymentAmount === undefined) {
    const sumResult = await db.getFirstAsync<{ sum: number }>(
      'SELECT SUM(amount) AS sum FROM transactions WHERE splitMemberId = ?', memberId
    );
    const totalPaidBefore = sumResult?.sum ?? 0;
    paymentAmount = Math.max(0, member.share - totalPaidBefore);
  }

  if (paymentAmount <= 0) {
    throw new Error('Repayment amount must be greater than 0');
  }

  // Create credit transaction that increases the account balance.
  // Marked as isTransfer=1 so it is excluded from income analytics
  // (split repayments are cost-sharing, not real income).
  const txId = await addTransaction({
    amount: paymentAmount,
    category: 'Split',
    merchant: `${memberName} — ${splitTitle}`,
    type: 'credit',
    date: today,
    accountId,
    isConfirmed: true,
    isTransfer: true,
    source: 'manual',
    notes: `Split repayment from ${memberName}`,
    splitMemberId: memberId,
  } as any);

  // Recalculate total paid
  const sumResultAfter = await db.getFirstAsync<{ sum: number }>(
    'SELECT SUM(amount) AS sum FROM transactions WHERE splitMemberId = ?', memberId
  );
  const totalPaidAfter = sumResultAfter?.sum ?? 0;

  // Mark member as paid if they have fully paid
  const isPaid = totalPaidAfter >= member.share ? 1 : 0;
  await db.runAsync(
    `UPDATE split_members SET isPaid=?, paidDate=?, repaidToAccountId=? WHERE id=?`,
    isPaid, today, accountId, memberId,
  );

  return txId;
};

export const updateSplit = async (
  id: number,
  split: Partial<Omit<Split, 'id'>>,
  members?: (Omit<SplitMember, 'id' | 'splitId'> & { id?: number })[]
): Promise<void> => {
  // Update split record
  const keys = Object.keys(split);
  if (keys.length > 0) {
    const setClauses = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => (split as any)[k] ?? null);
    await db.runAsync(`UPDATE splits SET ${setClauses} WHERE id = ?`, ...values, id);
  }

  // If members provided, update them intelligently to preserve IDs
  if (members) {
    const keptIds = members.map(m => m.id).filter((memberId): memberId is number => typeof memberId === 'number');
    
    // Delete members not in keptIds
    if (keptIds.length > 0) {
      const placeholders = keptIds.map(() => '?').join(', ');
      await db.runAsync(
        `DELETE FROM split_members WHERE splitId = ? AND id NOT IN (${placeholders})`,
        id,
        ...keptIds
      );
    } else {
      await db.runAsync('DELETE FROM split_members WHERE splitId = ?', id);
    }

    // Insert or update members
    for (const m of members) {
      if (typeof m.id === 'number') {
        // Update existing member
        await db.runAsync(
          `UPDATE split_members 
           SET name = ?, share = ?, isMe = ?, isPaid = ?, paidDate = ?, repaidToAccountId = ? 
           WHERE id = ?`,
          m.name,
          m.share,
          m.isMe ? 1 : 0,
          m.isPaid ? 1 : 0,
          m.paidDate ?? null,
          m.repaidToAccountId ?? null,
          m.id
        );
      } else {
        // Insert new member
        await db.runAsync(
          `INSERT INTO split_members (splitId, name, share, isMe, isPaid, paidDate, repaidToAccountId)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          id,
          m.name,
          m.share,
          m.isMe ? 1 : 0,
          m.isPaid ? 1 : 0,
          m.paidDate ?? null,
          m.repaidToAccountId ?? null
        );
      }
    }
  }
};

export const deleteSplit = async (id: number): Promise<void> => {
  await db.runAsync('DELETE FROM splits WHERE id = ?', id);
};

export const updateSplitReceiveAccount = async (splitId: number, accountId: number): Promise<void> => {
  await db.runAsync('UPDATE splits SET receiveToAccountId=? WHERE id=?', accountId, splitId);
};

export const revertLatestRepayment = async (memberId: number): Promise<void> => {
  const latestTx = await db.getFirstAsync<any>(
    'SELECT id FROM transactions WHERE splitMemberId = ? ORDER BY date DESC, id DESC LIMIT 1',
    memberId
  );
  if (latestTx) {
    await deleteTransaction(latestTx.id);
  } else {
    throw new Error('No repayment transactions found');
  }
};

export const getSplitByTransactionId = async (transactionId: number): Promise<{ split: Split; members: (SplitMember & { paidAmount: number })[] } | null> => {
  const split = await db.getFirstAsync<Split>('SELECT * FROM splits WHERE transactionId = ?', transactionId);
  if (!split) return null;
  return getSplitById(split.id);
};

export interface PendingSplitMember {
  memberId: number;
  memberName: string;
  memberShare: number;
  memberPaidAmount: number;
  splitId: number;
  splitTitle: string;
  splitDate: string;
}

export const getPendingSplitMembers = async (excludeTxId?: number): Promise<PendingSplitMember[]> => {
  let query = `
    SELECT sm.id AS memberId, sm.name AS memberName, sm.share AS memberShare,
           s.id AS splitId, s.title AS splitTitle, s.date AS splitDate,
           COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.splitMemberId = sm.id), 0) AS memberPaidAmount
    FROM split_members sm
    JOIN splits s ON sm.splitId = s.id
    WHERE sm.isMe = 0 AND (sm.isPaid = 0
  `;
  const params: any[] = [];
  if (excludeTxId !== undefined) {
    query += ` OR sm.id = (SELECT splitMemberId FROM transactions WHERE id = ?)`;
    params.push(excludeTxId);
  }
  query += `) ORDER BY s.date DESC, sm.id ASC`;
  
  const rows = await db.getAllAsync<any>(query, ...params);
  return rows.map(r => ({
    memberId: r.memberId,
    memberName: r.memberName,
    memberShare: r.memberShare,
    memberPaidAmount: r.memberPaidAmount ?? 0,
    splitId: r.splitId,
    splitTitle: r.splitTitle,
    splitDate: r.splitDate,
  }));
};

// export const seedMockData = async () => {
//   if (!db) return;

//   try {
//     // 1. Clear existing table data to guarantee clean totals
//     await db.execAsync('DELETE FROM split_members;');
//     await db.execAsync('DELETE FROM splits;');
//     await db.execAsync('DELETE FROM transactions;');
//     await db.execAsync('DELETE FROM subscriptions;');
//     await db.execAsync('DELETE FROM goals;');
//     await db.execAsync('DELETE FROM loans;');
//     await db.execAsync('DELETE FROM budgets;');
//     await db.execAsync('DELETE FROM accounts;');

//     // 2. Insert Accounts (Indian context: Bank, Credit Card, Cash)
//     await db.runAsync(
//       `INSERT INTO accounts (id, name, balance, accountType, creditLimit, statementDay, billDueDay, startDate, last4Digits, displayOrder, startingBalance)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       1, 'HDFC Salary Account', 142500.00, 'bank', null, null, null, '2026-07-01', '4092', 1, 142500.00
//     );

//     await db.runAsync(
//       `INSERT INTO accounts (id, name, balance, accountType, creditLimit, statementDay, billDueDay, startDate, last4Digits, displayOrder, startingBalance)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       2, 'ICICI Sapphiro Credit Card', -18450.00, 'credit_card', 250000.00, 15, 5, '2026-07-01', '8821', 2, 0.00
//     );

//     await db.runAsync(
//       `INSERT INTO accounts (id, name, balance, accountType, creditLimit, statementDay, billDueDay, startDate, last4Digits, displayOrder, startingBalance)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       3, 'Cash Wallet', 3500.00, 'cash', null, null, null, '2026-07-01', null, 3, 3500.00
//     );

//     // 3. Inject Confirmed Transactions (For Analytics & Dashboard)
//     const confirmedTxs = [
//       {
//         amount: 175000.00,
//         category: 'Salary',
//         merchant: 'Tech Corp Inc',
//         type: 'credit',
//         date: '2026-07-01T09:00:00.000Z',
//         accountId: 1,
//         isConfirmed: 1,
//         source: 'auto',
//         isTransfer: 0
//       },
//       {
//         amount: 28000.00,
//         category: 'Rent',
//         merchant: 'Equity Residential',
//         type: 'debit',
//         date: '2026-07-02T10:00:00.000Z',
//         accountId: 1,
//         isConfirmed: 1,
//         source: 'manual',
//         isTransfer: 0
//       },
//       {
//         amount: 25000.00,
//         category: 'Transfer',
//         merchant: 'Zerodha Mutual Fund',
//         type: 'transfer',
//         date: '2026-07-05T11:00:00.000Z',
//         accountId: 1,
//         toAccountId: null,
//         isConfirmed: 1,
//         source: 'manual',
//         isTransfer: 1
//       },
//       {
//         amount: 4250.00,
//         category: 'Groceries',
//         merchant: 'Blinkit Quick Commerce',
//         type: 'debit',
//         date: '2026-07-08T16:30:00.000Z',
//         accountId: 2,
//         isConfirmed: 1,
//         source: 'sms',
//         isTransfer: 0
//       },
//       {
//         amount: 1450.00,
//         category: 'Movies',
//         merchant: 'PVR INOX Cinemas',
//         type: 'debit',
//         date: '2026-07-12T20:00:00.000Z',
//         accountId: 2,
//         isConfirmed: 1,
//         source: 'sms',
//         isTransfer: 0
//       },
//       {
//         amount: 2850.00,
//         category: 'Restaurants',
//         merchant: 'Rameshwaram Cafe',
//         type: 'debit',
//         date: '2026-07-15T21:10:00.000Z',
//         accountId: 2,
//         isConfirmed: 1,
//         source: 'sms',
//         isTransfer: 0
//       }
//     ];

//     for (const tx of confirmedTxs) {
//       await db.runAsync(
//         `INSERT INTO transactions (amount, category, merchant, type, date, accountId, toAccountId, isConfirmed, source, isTransfer)
//          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//         tx.amount, tx.category, tx.merchant, tx.type, tx.date, tx.accountId, tx.toAccountId ?? null, tx.isConfirmed, tx.source, tx.isTransfer
//       );
//     }

//     // 4. Trigger Unconfirmed SMS Logs (For Smart Inbox swipe deck)
//     const unconfirmedTxs = [
//       {
//         amount: 489.00,
//         category: 'Takeout & Delivery',
//         merchant: 'Swiggy',
//         type: 'debit',
//         date: '2026-07-19T13:45:00.000Z',
//         accountId: 1,
//         isConfirmed: 0,
//         rawSms: 'Alert: You spent Rs 489.00 on HDFC card ending in 4092 at Swiggy on 19-Jul.',
//         confidence: 'high',
//         source: 'sms'
//       },
//       {
//         amount: 340.00,
//         category: 'Taxi & Rides',
//         merchant: 'Uber Eats',
//         type: 'debit',
//         date: '2026-07-19T16:20:00.000Z',
//         accountId: 1,
//         isConfirmed: 0,
//         rawSms: 'HDFC: Rs 340.00 debited at UBER EATS on 19-Jul.',
//         confidence: 'high',
//         source: 'sms'
//       },
//       {
//         amount: 1250.00,
//         category: 'Groceries',
//         merchant: 'Zepto',
//         type: 'debit',
//         date: '2026-07-19T18:10:00.000Z',
//         accountId: 2,
//         isConfirmed: 0,
//         rawSms: 'Alert: ICICI Bank Card ending 8821 spent Rs 1250.00 at Zepto Quick Grocery on 19-Jul.',
//         confidence: 'medium',
//         source: 'sms'
//       }
//     ];

//     for (const tx of unconfirmedTxs) {
//       await db.runAsync(
//         `INSERT INTO transactions (amount, category, merchant, type, date, accountId, isConfirmed, rawSms, confidence, source)
//          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//         tx.amount, tx.category, tx.merchant, tx.type, tx.date, tx.accountId, tx.isConfirmed, tx.rawSms, tx.confidence, tx.source
//       );
//     }

//     // 5. Populate Budgets
//     await db.runAsync(
//       `INSERT INTO budgets (categoryName, amount, period, startDate) VALUES (?, ?, ?, ?)`,
//       'Food & Dining', 15000.00, 'monthly', '2026-07-01'
//     );
//     await db.runAsync(
//       `INSERT INTO budgets (categoryName, amount, period, startDate) VALUES (?, ?, ?, ?)`,
//       'Shopping', 10000.00, 'monthly', '2026-07-01'
//     );

//     // 6. Populate Subscriptions
//     await db.runAsync(
//       `INSERT INTO subscriptions (name, amount, category, frequency, nextDueDate, lastPaidDate, isActive, debitAccountId)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
//       'Netflix India', 649.00, 'Subscriptions', 'monthly', '2026-08-01', '2026-07-01', 1, 1
//     );
//     await db.runAsync(
//       `INSERT INTO subscriptions (name, amount, category, frequency, nextDueDate, lastPaidDate, isActive, debitAccountId)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
//       'Cult.fit Gym', 1499.00, 'Health', 'monthly', '2026-08-05', '2026-07-05', 1, 1
//     );

//     // 7. Populate Split Expenses
//     const splitRes = await db.runAsync(
//       `INSERT INTO splits (title, totalAmount, paidByAccountId, date, notes) VALUES (?, ?, ?, ?, ?)`,
//       'Dinner at Rameshwaram Cafe', 3600.00, 1, '2026-07-15T21:10:00.000Z', 'Team weekend dinner'
//     );
//     const splitId = splitRes.lastInsertRowId;

//     await db.runAsync(
//       `INSERT INTO split_members (splitId, name, share, isMe, isPaid, paidDate) VALUES (?, ?, ?, ?, ?, ?)`,
//       splitId, 'Me (You)', 1200.00, 1, 1, '2026-07-15T21:10:00.000Z'
//     );
//     await db.runAsync(
//       `INSERT INTO split_members (splitId, name, share, isMe, isPaid, paidDate) VALUES (?, ?, ?, ?, ?, ?)`,
//       splitId, 'Sarah', 1200.00, 0, 0, null
//     );
//     await db.runAsync(
//       `INSERT INTO split_members (splitId, name, share, isMe, isPaid, paidDate) VALUES (?, ?, ?, ?, ?, ?)`,
//       splitId, 'Mike', 1200.00, 0, 1, '2026-07-16T12:00:00.000Z'
//     );

//     // 8. Populate Goals & Loans
//     await db.runAsync(
//       `INSERT INTO goals (name, targetAmount, currentAmount, deadline, category, isActive, linkedAccountId, monthlyContribution, notes)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       'Vacation to Japan', 250000.00, 100000.00, '2026-12-31', 'Travel', 1, 1, 25000.00, 'Savings for Tokyo flight and hotels'
//     );

//     await db.runAsync(
//       `INSERT INTO loans (lender, totalAmount, remainingAmount, emiAmount, nextDueDate, interestRate, isActive, type, linkedAccountId, tenure, notes)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       'John', 15000.00, 5000.00, 2500.00, '2026-08-01', 0, 1, 'lent', 1, 6, 'Lent to John for laptop repair'
//     );

//     await db.runAsync(
//       'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
//       'mock_data_seeded', 'true'
//     );
//     console.log('[Database] Mock data successfully seeded for Play Store screenshots.');
//   } catch (err) {
//     console.error('[Database] Failed to seed mock data:', err);
//   }
// };

