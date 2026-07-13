import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, Pressable, ScrollView, Alert, useWindowDimensions } from 'react-native';
// Gesture-handler ScrollView: on the New Architecture a core ScrollView won't
// hand a finger-drag off to scroll when the drag starts on a Pressable child
// (rows only scroll from non-pressable gaps). RNGH's ScrollView fixes that for
// the in-sheet selection lists. Must live under a GestureHandlerRootView (the
// BottomSheet shell provides one).
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import {
  LucideCheckCheck,
  LucideTrash2,
  LucideSearch,
  LucideX,
  LucideInbox,
  LucideRotateCcw,
} from 'lucide-react-native';
import { useIsFocused } from '@react-navigation/native';

import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import {
  ScreenHeader,
  HeaderIconButton,
  Segmented,
  BottomSheet,
  EmptyState,
  PrimaryButton,
  TextField,
} from '../components/Kit';
import { SectionLabel } from '../components/Signal';
import { InboxDeck, CardHandlers } from '../components/InboxDeck';
import { renderCategoryIcon } from '../components/CategoryManager';
import { TagInput } from '../components/TagInput';
import { notify } from '../utils/notify';
import { useTheme } from '../theme/ThemeProvider';
import { useStore } from '../store/useStore';
import { fonts, radius } from '../theme/tokens';
import {
  getUnconfirmedTransactions,
  confirmTransaction,
  deleteTransaction,
  updateTransaction,
  getAccounts,
  getCategories,
  Transaction,
  Account,
  Category,
} from '../services/database';

type SheetKind = null | 'category' | 'account' | 'toAccount' | 'rename' | 'tags';
type CatType = 'expense' | 'income' | 'transfer';

const SmartInboxScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const { preferences } = useStore();
  const currency = preferences?.currency ?? '₹';
  const isFocused = useIsFocused();
  const { width } = useWindowDimensions();

  const [queue, setQueue] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accountOverrides, setAccountOverrides] = useState<Record<number, number>>({});
  const [cleared, setCleared] = useState(0);

  // Sheet state — every editor acts on the top card (queue[0]).
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [catType, setCatType] = useState<CatType>('expense');
  const [catSearch, setCatSearch] = useState('');
  const [tempName, setTempName] = useState('');

  // Pending soft-dismiss (swipe left) awaiting the undo window before real delete.
  const [pending, setPending] = useState<Transaction | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of `pending` readable synchronously (for the unmount flush + dedupe).
  const pendingRef = useRef<Transaction | null>(null);
  pendingRef.current = pending;

  const activeTx = queue[0];

  const loadQueue = useCallback(async () => {
    const [data, accs, cats] = await Promise.all([
      getUnconfirmedTransactions(),
      getAccounts(),
      getCategories(),
    ]);
    setQueue(data);
    setAccounts(accs);
    setCategories(cats);
    setCleared(0);
  }, []);

  useEffect(() => {
    if (isFocused) loadQueue();
  }, [loadQueue, isFocused]);

  // On unmount only: cancel the timer and commit any still-pending delete.
  useEffect(() => {
    return () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      if (pendingRef.current) deleteTransaction(pendingRef.current.id).catch(() => {});
    };
  }, []);

  const total = queue.length + cleared;
  const pct = total > 0 ? cleared / total : 0;

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const patchTx = useCallback((id: number, updates: Partial<Transaction>) => {
    setQueue(prev => prev.map(t => (t.id === id ? { ...t, ...updates } : t)));
  }, []);

  const handleConfirm = useCallback(async (tx: Transaction) => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const effectiveId = accountOverrides[tx.id] ?? tx.accountId;
      if (effectiveId && effectiveId !== tx.accountId) {
        await updateTransaction(tx.id, { accountId: effectiveId });
      }
      await confirmTransaction(tx.id);
      setQueue(prev => prev.filter(t => t.id !== tx.id));
      setCleared(c => c + 1);
    } catch {
      notify.error('Failed to confirm transaction');
    }
  }, [accountOverrides]);

  const finalizePending = useCallback((tx: Transaction) => {
    deleteTransaction(tx.id).catch(() => {});
  }, []);

  // Swipe-left / dismiss button: remove now, delete after the undo window.
  const handleDismiss = useCallback((tx: Transaction) => {
    // Flush any earlier pending dismissal immediately (only one undo at a time).
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    const prev = pendingRef.current;
    if (prev && prev.id !== tx.id) finalizePending(prev);
    setPending(tx);
    setQueue(q => q.filter(t => t.id !== tx.id));
    setCleared(c => c + 1);
    pendingTimer.current = setTimeout(() => {
      finalizePending(tx);
      setPending(null);
    }, 4200);
  }, [finalizePending]);

  const handleUndo = useCallback(() => {
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    const p = pendingRef.current;
    if (p) {
      setQueue(q => [p, ...q]);
      setCleared(c => Math.max(0, c - 1));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    setPending(null);
  }, []);

  const handleTypeChange = useCallback(async (tx: Transaction, type: 'debit' | 'credit' | 'transfer') => {
    if (type === tx.type) return;
    const updates: Partial<Transaction> = { type, isTransfer: type === 'transfer' };
    if (type === 'transfer' && tx.category !== 'Transfer') updates.category = 'Transfer';
    Haptics.selectionAsync().catch(() => {});
    await updateTransaction(tx.id, updates as any);
    patchTx(tx.id, updates);
    setCatType(type === 'credit' ? 'income' : type === 'transfer' ? 'transfer' : 'expense');
  }, [patchTx]);

  const changeCategory = useCallback(async (name: string) => {
    if (!activeTx) return;
    await updateTransaction(activeTx.id, { category: name });
    patchTx(activeTx.id, { category: name });
    Haptics.selectionAsync().catch(() => {});
    setSheet(null);
    setCatSearch('');
  }, [activeTx, patchTx]);

  const changeAccount = useCallback((accId: number) => {
    if (!activeTx) return;
    setAccountOverrides(prev => ({ ...prev, [activeTx.id]: accId }));
    Haptics.selectionAsync().catch(() => {});
    setSheet(null);
  }, [activeTx]);

  const changeToAccount = useCallback(async (accId: number) => {
    if (!activeTx) return;
    await updateTransaction(activeTx.id, { toAccountId: accId });
    patchTx(activeTx.id, { toAccountId: accId });
    Haptics.selectionAsync().catch(() => {});
    setSheet(null);
  }, [activeTx, patchTx]);

  const changeTags = useCallback(async (tags: string[]) => {
    if (!activeTx) return;
    await updateTransaction(activeTx.id, { tags });
    patchTx(activeTx.id, { tags });
  }, [activeTx, patchTx]);

  const saveName = useCallback(async () => {
    if (!activeTx) return;
    const name = tempName.trim();
    if (name && name !== activeTx.merchant) {
      await updateTransaction(activeTx.id, { merchant: name });
      patchTx(activeTx.id, { merchant: name });
    }
    setSheet(null);
  }, [activeTx, tempName, patchTx]);

  // ─── Sheet openers wired into the deck's card chips ─────────────────────────

  const handlers: CardHandlers = useMemo(() => ({
    onEditCategory: (tx) => {
      setCatType(tx.type === 'credit' ? 'income' : tx.type === 'transfer' ? 'transfer' : 'expense');
      setCatSearch('');
      setSheet('category');
    },
    onEditAccount: () => setSheet('account'),
    onEditToAccount: () => setSheet('toAccount'),
    onEditTags: () => setSheet('tags'),
    onRename: (tx) => { setTempName(tx.merchant); setSheet('rename'); },
    onTypeChange: handleTypeChange,
  }), [handleTypeChange]);

  // ─── Bulk actions ───────────────────────────────────────────────────────────

  const confirmAll = () => {
    if (queue.length === 0) return;
    Alert.alert('Confirm all', `Confirm all ${queue.length} pending transactions?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm all',
        onPress: async () => {
          const items = [...queue];
          for (const tx of items) {
            try {
              const eff = accountOverrides[tx.id] ?? tx.accountId;
              if (eff && eff !== tx.accountId) await updateTransaction(tx.id, { accountId: eff });
              await confirmTransaction(tx.id);
            } catch {}
          }
          setCleared(c => c + items.length);
          setQueue([]);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          notify.success(`${items.length} transactions confirmed`);
        },
      },
    ]);
  };

  const deleteAll = () => {
    if (queue.length === 0) return;
    Alert.alert(
      'Delete all pending',
      `Permanently delete all ${queue.length} pending transaction${queue.length > 1 ? 's' : ''}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete all',
          style: 'destructive',
          onPress: async () => {
            const items = [...queue];
            for (const tx of items) { try { await deleteTransaction(tx.id); } catch {} }
            setCleared(c => c + items.length);
            setQueue([]);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
            notify.success(`${items.length} transactions deleted`);
          },
        },
      ]
    );
  };

  // ─── Category grid (for the sheet) ──────────────────────────────────────────

  const catTileW = (width - 40 - 30) / 4; // 4 columns, 20px side padding, ~10px gaps

  const CatTile: React.FC<{ cat: Category; breadcrumb?: string }> = ({ cat, breadcrumb }) => {
    const selected = activeTx?.category === cat.name;
    return (
      <Pressable
        onPress={() => changeCategory(cat.name)}
        style={{ width: catTileW, alignItems: 'center', marginBottom: 16 }}
      >
        <View
          style={{
            width: 54,
            height: 54,
            borderRadius: 17,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: selected ? colors.accent : colors.translucent,
            borderWidth: selected ? 0 : 1,
            borderColor: colors.border,
          }}
        >
          {renderCategoryIcon(cat.icon, selected ? colors.onAccent : cat.color, 24)}
        </View>
        <ThemedText
          style={{ fontSize: 10, marginTop: 6, textAlign: 'center', color: selected ? colors.primary : colors.secondary, fontFamily: selected ? fonts.textSemibold : fonts.text }}
          numberOfLines={1}
        >
          {breadcrumb ?? cat.name}
        </ThemedText>
      </Pressable>
    );
  };

  const categorySheetBody = () => {
    const list = categories.filter(c => c.type === catType);
    const q = catSearch.trim().toLowerCase();

    if (q) {
      const matches = list.filter(c => c.name.toLowerCase().includes(q));
      return matches.length === 0 ? (
        <ThemedText type="secondary" style={{ fontSize: 13, fontStyle: 'italic', paddingHorizontal: 20, paddingVertical: 12 }}>
          No categories match “{catSearch}”.
        </ThemedText>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, gap: 10 }}>
          {matches.map(cat => {
            const parent = cat.parentId ? categories.find(p => p.id === cat.parentId) : null;
            return <CatTile key={cat.id} cat={cat} breadcrumb={parent ? `${parent.name} · ${cat.name}` : cat.name} />;
          })}
        </View>
      );
    }

    const parents = list.filter(c => !c.parentId);
    const childrenOf = (pid: number) => list.filter(c => c.parentId === pid);

    return parents.map(parent => {
      const kids = childrenOf(parent.id);
      return (
        <View key={parent.id} style={{ marginBottom: 4 }}>
          <SectionLabel style={{ paddingHorizontal: 20, marginBottom: 12, marginTop: 4 }}>{parent.name}</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, gap: 10 }}>
            <CatTile cat={parent} />
            {kids.map(child => <CatTile key={child.id} cat={child} />)}
          </View>
        </View>
      );
    });
  };

  // ─── Account rows (for the sheet) ───────────────────────────────────────────

  const AccountRows: React.FC<{ mode: 'from' | 'to' }> = ({ mode }) => {
    const selectedId =
      mode === 'from' ? (activeTx ? accountOverrides[activeTx.id] ?? activeTx.accountId : undefined) : activeTx?.toAccountId;
    const blockedId = mode === 'to' ? (activeTx ? accountOverrides[activeTx.id] ?? activeTx.accountId : undefined) : undefined;
    return (
      <View style={{ paddingHorizontal: 20 }}>
        {accounts.map(acc => {
          const active = selectedId === acc.id;
          const blocked = blockedId === acc.id;
          const tone = mode === 'to' ? colors.credit : colors.accent;
          return (
            <Pressable
              key={acc.id}
              disabled={blocked}
              onPress={() => (mode === 'from' ? changeAccount(acc.id) : changeToAccount(acc.id))}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 14,
                paddingHorizontal: 16,
                borderRadius: radius.md,
                marginBottom: 10,
                backgroundColor: active ? `${tone}16` : colors.translucent,
                borderWidth: 1,
                borderColor: active ? tone : colors.border,
                opacity: blocked ? 0.35 : 1,
              }}
            >
              <View>
                <ThemedText style={{ fontFamily: fonts.textSemibold, fontSize: 15 }}>{acc.name}</ThemedText>
                <ThemedText font="signal" type="secondary" style={{ fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 3 }}>
                  {acc.accountType.replace('_', ' ')}
                </ThemedText>
              </View>
              {active && <ThemedText font="signal" style={{ fontSize: 10, letterSpacing: 1, color: tone }}>SELECTED</ThemedText>}
            </Pressable>
          );
        })}
      </View>
    );
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <ThemedSafeAreaView>
      <ScreenHeader
        eyebrow="SMART INBOX"
        title="Review signals"
        compact
        onBack={() => navigation.goBack()}
        right={
          queue.length > 1 ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <HeaderIconButton onPress={deleteAll} tint={colors.danger}>
                <LucideTrash2 color={colors.danger} size={17} />
              </HeaderIconButton>
              <HeaderIconButton onPress={confirmAll} tint={colors.credit}>
                <LucideCheckCheck color={colors.credit} size={17} />
              </HeaderIconButton>
            </View>
          ) : undefined
        }
      />

      {/* Progress ribbon */}
      {total > 0 && (
        <View style={{ paddingHorizontal: 24, paddingBottom: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <SectionLabel>{queue.length > 0 ? `${queue.length} to review` : 'All reviewed'}</SectionLabel>
            <ThemedText font="signal" style={{ fontSize: 9.5, letterSpacing: 1, color: colors.secondary }}>
              {cleared}/{total} CLEARED
            </ThemedText>
          </View>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.surfaceElevated, overflow: 'hidden' }}>
            <MotiView
              animate={{ width: `${Math.round(pct * 100)}%` }}
              transition={{ type: 'timing', duration: 260 }}
              style={{ height: '100%', borderRadius: 2, backgroundColor: colors.credit }}
            />
          </View>
        </View>
      )}

      {queue.length === 0 ? (
        <EmptyState
          icon={<LucideInbox color={colors.muted} size={56} />}
          title="All quiet."
          subtitle="Every signal has been reviewed. New transactions land here as they arrive."
          action={<PrimaryButton label="Back home" onPress={() => navigation.goBack()} tone="pulse" />}
        />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, paddingBottom: 14 }}>
            <View style={{ width: 34, height: 1, backgroundColor: colors.border }} />
            <ThemedText font="signal" style={{ fontSize: 9, letterSpacing: 2, color: colors.muted }}>
              SWIPE TO TRIAGE
            </ThemedText>
            <View style={{ width: 34, height: 1, backgroundColor: colors.border }} />
          </View>

          <InboxDeck
            queue={queue}
            accounts={accounts}
            categories={categories}
            currency={currency}
            accountOverrides={accountOverrides}
            onConfirm={handleConfirm}
            onDismiss={handleDismiss}
            onEdit={(tx) => navigation.navigate('EditTransaction', { transaction: tx })}
            handlers={handlers}
          />

          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 30, marginTop: 18 }}>
            <ThemedText font="signal" style={{ fontSize: 8.5, letterSpacing: 1, color: colors.danger }}>← DISMISS</ThemedText>
            <ThemedText font="signal" style={{ fontSize: 8.5, letterSpacing: 1, color: colors.credit }}>CONFIRM →</ThemedText>
          </View>
        </ScrollView>
      )}

      {/* Undo snackbar */}
      {pending && (
        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          exit={{ opacity: 0, translateY: 20 }}
          style={{
            position: 'absolute',
            left: 20,
            right: 20,
            bottom: 24,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingLeft: 18,
            paddingRight: 8,
            paddingVertical: 8,
            borderRadius: radius.pill,
            backgroundColor: colors.surfaceElevated,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <ThemedText style={{ fontSize: 13, fontFamily: fonts.textMedium }} numberOfLines={1}>
            Dismissed “{pending.merchant}”
          </ThemedText>
          <Pressable
            onPress={handleUndo}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: `${colors.accent}18` }}
          >
            <LucideRotateCcw color={colors.accent} size={14} />
            <ThemedText font="signal" style={{ fontSize: 11, letterSpacing: 1, color: colors.accent }}>UNDO</ThemedText>
          </Pressable>
        </MotiView>
      )}

      {/* ─── Sheets ─── */}

      <BottomSheet visible={sheet === 'category'} onClose={() => setSheet(null)} title="Categorize">
        <View style={{ paddingBottom: 4 }}>
          <Segmented
            options={[
              { key: 'expense', label: 'Expense', color: colors.debit },
              { key: 'income', label: 'Income', color: colors.credit },
              { key: 'transfer', label: 'Transfer', color: colors.secondary },
            ]}
            value={catType}
            onChange={(v) => {
              setCatType(v);
              if (activeTx) handleTypeChange(activeTx, v === 'income' ? 'credit' : v === 'transfer' ? 'transfer' : 'debit');
            }}
            style={{ marginBottom: 14 }}
          />
          <View style={{ paddingHorizontal: 20, marginBottom: 14 }}>
            <TextField
              value={catSearch}
              onChangeText={setCatSearch}
              placeholder="Search categories…"
              autoCapitalize="none"
              autoCorrect={false}
              leading={<LucideSearch color={colors.secondary} size={16} />}
              trailing={catSearch ? (
                <Pressable onPress={() => setCatSearch('')}><LucideX color={colors.secondary} size={16} /></Pressable>
              ) : undefined}
            />
          </View>
          <GHScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            {categorySheetBody()}
          </GHScrollView>
        </View>
      </BottomSheet>

      <BottomSheet visible={sheet === 'account'} onClose={() => setSheet(null)} title={activeTx?.type === 'transfer' ? 'Source account' : 'Assign account'}>
        <GHScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 6 }}>
          <AccountRows mode="from" />
        </GHScrollView>
      </BottomSheet>

      <BottomSheet visible={sheet === 'toAccount'} onClose={() => setSheet(null)} title="Destination account">
        <GHScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 6 }}>
          <AccountRows mode="to" />
        </GHScrollView>
      </BottomSheet>

      <BottomSheet visible={sheet === 'tags'} onClose={() => setSheet(null)} title="Tags">
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          <TagInput tags={activeTx?.tags || []} onChangeTags={changeTags} placeholder="e.g. vacation" />
        </View>
      </BottomSheet>

      <BottomSheet visible={sheet === 'rename'} onClose={() => setSheet(null)} title="Rename merchant">
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          <TextField value={tempName} onChangeText={setTempName} placeholder="Merchant name" autoFocus onSubmitEditing={saveName} />
          <PrimaryButton label="Save" onPress={saveName} tone="pulse" style={{ marginTop: 16 }} />
        </View>
      </BottomSheet>
    </ThemedSafeAreaView>
  );
};

export default SmartInboxScreen;
