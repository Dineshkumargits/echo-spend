import * as SQLite from 'expo-sqlite';

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
  recurrenceRule?: string;
  notes?: string;
  subscriptionId?: number;
  goalId?: number;
  loanId?: number;
  confidence?: 'high' | 'medium' | 'low';
  source?: 'sms' | 'csv' | 'manual' | 'auto';
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
  categoryName: string;
  amount: number;
  period: 'monthly' | 'weekly';
  startDate: string;
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

      // Run Migrations & Seeding
      await runMigrations();
      await seedDatabase();
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
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_transactions_rawsms ON transactions(rawSms);');

  // Legacy migrations (catch failures if columns already exist)
  const migrations = [
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

  for (const [name, icon, color, type] of seedCategories) {
    const exists = await db.getFirstAsync('SELECT id FROM categories WHERE name = ? AND type = ? AND parentId IS NULL', name, type);
    if (!exists) {
      await db.runAsync('INSERT INTO categories (name, icon, color, type, parentId) VALUES (?, ?, ?, ?, NULL)', name, icon, color, type);
    }
  }

  const seedSub = async (parentName: string, subs: [string, string][], color: string) => {
    const parent = await db.getFirstAsync<{ id: number }>('SELECT id FROM categories WHERE name = ? AND parentId IS NULL', parentName);
    if (parent) {
      for (const [n, i] of subs) {
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
    isTransfer: !!row.isTransfer,
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
  if (opts?.category) { conditions.push('category = ?'); params.push(opts.category); }
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
  if (opts?.isRecurring !== undefined) { conditions.push('isRecurring = ?'); params.push(opts.isRecurring ? 1 : 0); }
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
      (amount, category, merchant, type, date, accountId, toAccountId, isConfirmed, rawSms, isRecurring, recurrenceRule, notes, subscriptionId, goalId, loanId, confidence, source, isTransfer, tags, balanceAfter, splitMemberId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  // 4. Subscription — record payment and advance next due date
  if (tx.subscriptionId && type === 'debit') {
    const sub = await db.getFirstAsync<Subscription>(
      'SELECT * FROM subscriptions WHERE id = ?', tx.subscriptionId
    );
    if (sub) {
      const paidAt = (tx as any).date ?? new Date().toISOString();
      const next = new Date(sub.nextDueDate);
      if (sub.frequency === 'monthly') next.setMonth(next.getMonth() + 1);
      else if (sub.frequency === 'yearly') next.setFullYear(next.getFullYear() + 1);
      else if (sub.frequency === 'weekly') next.setDate(next.getDate() + 7);
      await db.runAsync(
        'UPDATE subscriptions SET lastPaidDate = ?, nextDueDate = ? WHERE id = ?',
        paidAt, next.toISOString(), tx.subscriptionId
      );
    }
  }

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
  }
};

export const deleteTransaction = async (id: number) => {
  const tx = await db.getFirstAsync<Transaction>('SELECT * FROM transactions WHERE id = ?', id);
  if (tx && tx.isConfirmed) {
    await revertTransactionImpact(tx);
  }
  await db.runAsync('DELETE FROM transactions WHERE id = ?', id);
};

export const getTransactionById = async (id: number): Promise<Transaction | null> => {
  const row = await db.getFirstAsync<any>('SELECT * FROM transactions WHERE id = ?', id);
  return row ? mapTransactionRow(row) : null;
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
     WHERE t.type = 'debit' AND t.isConfirmed = 1 AND (t.isTransfer = 0 OR t.isTransfer IS NULL) AND t.date >= ?
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

export const getCategoryBreakdown = async (
  month?: string // 'YYYY-MM', defaults to current month
): Promise<CategoryBreakdown[]> => {
  const target = month ?? new Date().toISOString().slice(0, 7);
  const rows = await db.getAllAsync<{ category: string; total: number; count: number }>(
    `SELECT t.category, SUM(${EFFECTIVE_DEBIT_AMOUNT}) as total, COUNT(*) as count
     FROM transactions t
     WHERE t.type = 'debit' AND t.isConfirmed = 1 AND (t.isTransfer = 0 OR t.isTransfer IS NULL) AND strftime('%Y-%m', t.date, 'localtime') = ?
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
       SUM(CASE WHEN t.type = 'credit' AND (t.isTransfer = 0 OR t.isTransfer IS NULL) THEN t.amount ELSE 0 END) as income,
       SUM(CASE WHEN t.type = 'debit' AND (t.isTransfer = 0 OR t.isTransfer IS NULL) THEN ${EFFECTIVE_DEBIT_AMOUNT} ELSE 0 END) as expense
     FROM transactions t WHERE t.isConfirmed = 1
     GROUP BY strftime('%Y-%m', t.date, 'localtime')
     ORDER BY month DESC
     LIMIT 6`
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
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM transactions WHERE amount >= ? AND isConfirmed = 1 ORDER BY date DESC LIMIT 20`,
    threshold
  );
  return rows.map(mapTransactionRow);
};

export const getCurrentMonthSpend = async (salaryDay = 1): Promise<number> => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentDay = now.getDate();

  let startDate: Date;
  let endDate: Date;

  if (currentDay >= salaryDay) {
    // Cycle started this month on salaryDay; ends exclusively at salaryDay next month.
    startDate = new Date(currentYear, currentMonth, salaryDay);
    endDate = new Date(currentYear, currentMonth + 1, salaryDay); // midnight, exclusive
  } else {
    // Cycle started last month on salaryDay; ends exclusively at salaryDay this month.
    startDate = new Date(currentYear, currentMonth - 1, salaryDay);
    endDate = new Date(currentYear, currentMonth, salaryDay); // midnight, exclusive
  }

  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT SUM(${EFFECTIVE_DEBIT_AMOUNT}) as total FROM transactions t
     WHERE t.type = 'debit' AND t.isConfirmed = 1 AND (t.isTransfer = 0 OR t.isTransfer IS NULL) AND t.date >= ? AND t.date < ?`,
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
};

export const updateCategory = async (category: Category) => {
  await db.runAsync(
    'UPDATE categories SET name = ?, icon = ?, color = ?, type = ?, parentId = ? WHERE id = ?',
    category.name, category.icon, category.color, category.type, category.parentId || null, category.id
  );
};

export const deleteCategory = async (id: number) => {
  await db.runAsync('DELETE FROM categories WHERE id = ?', id);
};

// ─── Budgets ─────────────────────────────────────────────────────────────────

export const getBudgets = async (): Promise<Budget[]> => {
  return await db.getAllAsync<Budget>('SELECT * FROM budgets ORDER BY categoryName');
};

export const upsertBudget = async (budget: Omit<Budget, 'id'>) => {
  const existing = await db.getFirstAsync<Budget>(
    'SELECT id FROM budgets WHERE categoryName = ? AND period = ?',
    budget.categoryName, budget.period
  );
  if (existing) {
    await db.runAsync(
      'UPDATE budgets SET amount = ?, startDate = ? WHERE id = ?',
      budget.amount, budget.startDate, existing.id
    );
  } else {
    await db.runAsync(
      'INSERT INTO budgets (categoryName, amount, period, startDate) VALUES (?, ?, ?, ?)',
      budget.categoryName, budget.amount, budget.period, budget.startDate
    );
  }
};

export const deleteBudget = async (id: number) => {
  await db.runAsync('DELETE FROM budgets WHERE id = ?', id);
};

export const getBudgetUtilization = async (salaryDay = 1): Promise<{
  budget: Budget;
  spent: number;
  percentage: number;
}[]> => {
  // Mirror the same salary-day billing cycle used by getCurrentMonthSpend so
  // that budget gauges and month-spend totals always agree.
  const now = new Date();
  const currentDay = now.getDate();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  let cycleStart: Date;
  let cycleEnd: Date;

  if (currentDay >= salaryDay) {
    cycleStart = new Date(currentYear, currentMonth, salaryDay);
    cycleEnd = new Date(currentYear, currentMonth + 1, salaryDay);
  } else {
    cycleStart = new Date(currentYear, currentMonth - 1, salaryDay);
    cycleEnd = new Date(currentYear, currentMonth, salaryDay);
  }

  const startStr = cycleStart.toISOString();
  const endStr = cycleEnd.toISOString();

  const budgets = await getBudgets();
  const results = [];
  for (const b of budgets) {
    const row = await db.getFirstAsync<{ total: number }>(
      `SELECT SUM(${EFFECTIVE_DEBIT_AMOUNT}) as total FROM transactions t
       WHERE t.category = ? AND t.type = 'debit' AND t.isConfirmed = 1
         AND (t.isTransfer = 0 OR t.isTransfer IS NULL)
         AND t.date >= ? AND t.date < ?`,
      b.categoryName, startStr, endStr
    );
    const spent = row?.total ?? 0;
    results.push({ budget: b, spent, percentage: b.amount > 0 ? Math.round((spent / b.amount) * 100) : 0 });
  }
  return results;
};

// ─── Insights ────────────────────────────────────────────────────────────────

export const getActiveInsights = async (): Promise<Insight[]> => {
  return await db.getAllAsync<Insight>(
    'SELECT * FROM insights WHERE dismissedAt IS NULL ORDER BY generatedAt DESC LIMIT 10'
  );
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
  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM transactions WHERE rawSms = ? LIMIT 1',
    rawSms,
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
  );
};

/**
 * Record a subscription payment: creates a confirmed debit transaction from the
 * linked account, auto-creates a split if the subscription is shared, and
 * advances the nextDueDate by one billing cycle.
 */
export const paySubscription = async (id: number): Promise<{ txId: number; splitId?: number }> => {
  const sub = await db.getFirstAsync<Subscription>('SELECT * FROM subscriptions WHERE id = ?', id);
  if (!sub) throw new Error('Subscription not found');

  const now = new Date().toISOString();

  const txId = await addTransaction({
    amount: sub.amount,
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
        const perShare = Math.round((sub.amount / totalPeople) * 100) / 100;
        const myShare = Math.round((sub.amount - perShare * members.length) * 100) / 100;
        splitId = await createSplit(
          {
            transactionId: txId,
            title: sub.name,
            totalAmount: sub.amount,
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

  // Advance next due date
  const next = new Date(sub.nextDueDate);
  if (sub.frequency === 'monthly') next.setMonth(next.getMonth() + 1);
  else if (sub.frequency === 'yearly') next.setFullYear(next.getFullYear() + 1);
  else if (sub.frequency === 'weekly') next.setDate(next.getDate() + 7);

  await updateSubscription(id, { lastPaidDate: now, nextDueDate: next.toISOString() });
  return { txId, splitId };
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
