import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import { ReviewTransactionCard } from '../components/ReviewTransactionCard';
import React, { useState, useEffect, useCallback } from 'react';
import { View, TouchableOpacity, Alert } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { MotiView } from 'moti';
import {
  LucideCheck,
  LucidePencil,
  LucideChevronLeft,
  LucideMessageSquare,
  LucideTrash2,
  LucideRotateCw,
  LucideTarget,
  LucideCreditCard,
  LucideSparkles,
} from 'lucide-react-native';
import * as LucideIcons from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { notify } from '../utils/notify';
import {
  getUnconfirmedTransactions,
  confirmTransaction,
  deleteTransaction,
  Transaction,
  Account,
  Category,
  getAccounts,
  getCategories,
  updateTransaction,
} from '../services/database';
import { useIsFocused } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeProvider';
import { useStore } from '../store/useStore';

const SmartInboxScreen = ({ navigation }: any) => {
  const { colors, theme } = useTheme();
  const { preferences } = useStore();
  const [queue, setQueue] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accountOverrides, setAccountOverrides] = useState<Record<number, number>>({});
  const isFocused = useIsFocused();

  const loadQueue = useCallback(async () => {
    const [data, accs, cats] = await Promise.all([
      getUnconfirmedTransactions(),
      getAccounts(),
      getCategories()
    ]);
    setQueue(data);
    setAccounts(accs);
    setCategories(cats);
  }, []);

  useEffect(() => {
    if (isFocused) {
      loadQueue();
    }
  }, [loadQueue, isFocused]);

  const handleConfirm = async (tx: Transaction) => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const effectiveId = accountOverrides[tx.id] ?? tx.accountId;
      if (effectiveId && effectiveId !== tx.accountId) {
        await updateTransaction(tx.id, { accountId: effectiveId });
      }
      await confirmTransaction(tx.id);
      setQueue(prev => prev.filter(t => t.id !== tx.id));
      notify.success('Transaction confirmed');
    } catch (err) {
      notify.error('Failed to confirm transaction');
    }
  };

  const changeAccount = (txId: number, accountId: number) => {
    setAccountOverrides(prev => ({ ...prev, [txId]: accountId }));
  };

  const handleDelete = (tx: Transaction) => {
    Alert.alert(
      'Delete Transaction',
      `Delete ${preferences.currency}${tx.amount} at ${tx.merchant}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTransaction(tx.id);
              setQueue(prev => prev.filter(t => t.id !== tx.id));
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            } catch {
              notify.error('Failed to delete transaction');
            }
          },
        },
      ]
    );
  };

  const handleConfirmAll = () => {
    if (queue.length === 0) return;
    Alert.alert(
      'Confirm All',
      `Confirm all ${queue.length} pending transactions?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm All',
          onPress: async () => {
            const count = queue.length;
            let failed = 0;
            for (const tx of queue) {
              try {
                // Apply account override (if the user reassigned this tx) before confirming.
                const effectiveAccountId = accountOverrides[tx.id] ?? tx.accountId;
                if (effectiveAccountId && effectiveAccountId !== tx.accountId) {
                  await updateTransaction(tx.id, { accountId: effectiveAccountId });
                }
                await confirmTransaction(tx.id);
              } catch {
                failed++;
              }
            }
            setQueue([]);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            if (failed > 0) {
              notify.error(`${count - failed} confirmed, ${failed} failed`);
            } else {
              notify.success(`${count} transactions confirmed`);
            }
          },
        },
      ]
    );
  };

  const handleDeleteAll = () => {
    if (queue.length === 0) return;
    Alert.alert(
      'Delete All Pending',
      `Permanently delete all ${queue.length} pending transaction${queue.length > 1 ? 's' : ''}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            const count = queue.length;
            for (const tx of queue) {
              try {
                await deleteTransaction(tx.id);
              } catch {}
            }
            setQueue([]);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            notify.success(`${count} transactions deleted`);
          },
        },
      ]
    );
  };

  return (
    <ThemedSafeAreaView>
      {/* Header */}
      <View className="px-6 py-4 flex-row items-center justify-between border-b" style={{ borderBottomColor: colors.border }}>
        <View className="flex-row items-center">
          <TouchableOpacity onPress={() => navigation.goBack()} className="mr-4">
            <LucideChevronLeft color={colors.primary} size={28} />
          </TouchableOpacity>
          <View>
            <ThemedText className="text-2xl font-bold">Smart Inbox</ThemedText>
            <ThemedText type="secondary" className="text-xs">{queue.length} pending item{queue.length !== 1 ? 's' : ''}</ThemedText>
          </View>
        </View>

        {queue.length > 1 && (
          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={handleDeleteAll}
              className="px-4 py-2 rounded-full mr-2"
              style={{ backgroundColor: `${colors.danger}15` }}
            >
              <ThemedText className="text-xs font-bold" style={{ color: colors.danger }}>Delete All</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleConfirmAll}
              className="px-4 py-2 rounded-full"
              style={{ backgroundColor: `${colors.accent}20` }}
            >
              <ThemedText className="text-xs font-bold" style={{ color: colors.accent }}>Confirm All</ThemedText>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {queue.length === 0 ? (
        <View className="flex-1 items-center justify-center px-10">
          <LucideMessageSquare color={colors.muted} size={64} />
          <ThemedText className="text-center font-bold text-lg mt-6">Inbox Zero!</ThemedText>
          <ThemedText type="secondary" className="text-center mt-2">
            All transactions are categorized and confirmed.
          </ThemedText>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            className="mt-8 px-8 py-3 rounded-full border"
            style={{ backgroundColor: colors.surface, borderColor: colors.border }}
          >
            <ThemedText className="font-bold">Go Back</ThemedText>
          </TouchableOpacity>
        </View>
      ) : (
        <FlashList
          data={queue}
          estimatedItemSize={120}
          keyExtractor={item => item.id.toString()}
          renderItem={({ item }) => (
            <View className="px-6 mb-1">
              <ReviewTransactionCard
                tx={item}
                accounts={accounts}
                categories={categories}
                accountOverride={accountOverrides[item.id]}
                onConfirm={(txToConfirm) => handleConfirm(txToConfirm)}
                onDelete={handleDelete}
                onEditPress={(txToEdit) => navigation.navigate('EditTransaction', { transaction: txToEdit })}
                onTransactionUpdated={(updatedTx) => {
                  setQueue(prev => prev.map(t => t.id === updatedTx.id ? updatedTx : t));
                }}
                onChangeAccount={changeAccount}
              />
            </View>
          )}
        />
      )}

    </ThemedSafeAreaView>
  );
};

export default SmartInboxScreen;
