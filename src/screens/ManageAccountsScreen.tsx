import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import {
  LucideX,
  LucidePlus,
  LucideChevronLeft,
  LucidePencil,
  LucideTrash2,
  LucideGripVertical,
  LucideArrowUp,
  LucideArrowDown,
  LucideSettings2,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { notify } from '../utils/notify';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import {
  getAccounts,
  deleteAccount,
  updateAccountsOrder,
  Account,
} from '../services/database';
import { useTheme } from '../theme/ThemeProvider';
import { MotiView, AnimatePresence } from 'moti';
import { useStore } from '../store/useStore';

export const ManageAccountsScreen = () => {
  const { colors, isDark } = useTheme();
  const { preferences } = useStore();
  const currency = preferences?.currency ?? '₹';
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAccounts = useCallback(async () => {
    try {
      const data = await getAccounts();
      setAccounts(data);
    } catch (err) {
      notify.error('Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isFocused) {
      loadAccounts();
    }
  }, [isFocused, loadAccounts]);

  const handleDelete = (account: Account) => {
    Alert.alert(
      'Delete Account',
      `Are you sure you want to delete "${account.name}"? This will unlink all transactions associated with it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount(account.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              notify.success('Account deleted');
              loadAccounts();
            } catch {
              notify.error('Failed to delete account');
            }
          },
        },
      ]
    );
  };

  const moveAccount = async (index: number, direction: 'up' | 'down') => {
    const newAccounts = [...accounts];
    const item = newAccounts[index];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= newAccounts.length) return;

    newAccounts.splice(index, 1);
    newAccounts.splice(targetIndex, 0, item);

    // Optimistic update
    setAccounts(newAccounts);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Save to DB
    const orderings = newAccounts.map((acc, idx) => ({
      id: acc.id,
      displayOrder: idx,
    }));
    try {
      await updateAccountsOrder(orderings);
    } catch (err) {
      notify.error('Failed to save sort order');
      loadAccounts(); // rollback
    }
  };

  const getAccountEmoji = (type: string) => {
    switch (type) {
      case 'credit_card': return '💳';
      case 'cash': return '💵';
      case 'wallet': return '👛';
      default: return '🏦';
    }
  };

  return (
    <ThemedSafeAreaView edges={['top', 'bottom']}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <LucideChevronLeft color={colors.primary} size={28} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <ThemedText className="text-2xl font-bold">Manage Accounts</ThemedText>
            <ThemedText type="secondary" className="text-xs">Edit, delete or reorder items</ThemedText>
          </View>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {accounts.map((acc, index) => (
            <MotiView
              key={acc.id}
              layout={(Platform.OS !== 'android') as any} // Smooth layout transitions
              from={{ opacity: 0, translateX: -10 }}
              animate={{ opacity: 1, translateX: 0 }}
              transition={{ delay: index * 50 }}
              style={[
                styles.accountCard,
                { backgroundColor: colors.surface, borderColor: colors.border }
              ]}
            >
              <View style={styles.cardMain}>
                {/* Reorder controls on the left */}
                <View style={[styles.reorderColumn, { borderRightColor: colors.border }]}>
                  <TouchableOpacity
                    onPress={() => moveAccount(index, 'up')}
                    disabled={index === 0}
                    style={[styles.miniReorderBtn, index === 0 && { opacity: 0.2 }]}
                  >
                    <LucideArrowUp color={colors.primary} size={14} />
                  </TouchableOpacity>
                  
                  <LucideGripVertical color={colors.muted} size={14} style={{ marginVertical: 4 }} />

                  <TouchableOpacity
                    onPress={() => moveAccount(index, 'down')}
                    disabled={index === accounts.length - 1}
                    style={[styles.miniReorderBtn, index === accounts.length - 1 && { opacity: 0.2 }]}
                  >
                    <LucideArrowDown color={colors.primary} size={14} />
                  </TouchableOpacity>
                </View>

                {/* Content */}
                <View style={styles.cardContent}>
                  <View style={[styles.emojiCircle, { backgroundColor: colors.translucent }]}>
                    <ThemedText style={{ fontSize: 18 }}>{getAccountEmoji(acc.accountType)}</ThemedText>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <ThemedText className="font-bold text-base" numberOfLines={1}>{acc.name}</ThemedText>
                    <ThemedText type="secondary" className="text-[10px]" numberOfLines={1}>
                      {acc.accountType.charAt(0).toUpperCase() + acc.accountType.slice(1)} {acc.last4Digits ? `· ****${acc.last4Digits}` : ''}
                    </ThemedText>
                  </View>
                  <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
                    <ThemedText className="font-bold text-sm">{acc.accountType === 'credit_card' ? '-' : ''}{currency}{acc.balance.toLocaleString('en-IN')}</ThemedText>
                    <TouchableOpacity
                      onPress={() => navigation.navigate('BankAccountDetail', { accountId: acc.id })}
                      activeOpacity={0.6}
                    >
                      <ThemedText style={{ color: colors.accent, fontWeight: 'bold', fontSize: 10, marginTop: 2 }}>Details</ThemedText>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Trailing actions */}
                <View style={styles.trailingActions}>
                  <TouchableOpacity
                    onPress={() => navigation.navigate('AddAccount', { accountToEdit: acc })}
                    style={styles.circleBtn}
                  >
                    <LucidePencil color={colors.secondary} size={16} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDelete(acc)}
                    style={[styles.circleBtn, { marginTop: 8 }]}
                  >
                    <LucideTrash2 color={colors.danger} size={16} />
                  </TouchableOpacity>
                </View>
              </View>
            </MotiView>
          ))}

          <TouchableOpacity
            onPress={() => navigation.navigate('AddAccount')}
            style={[styles.addCard, { borderColor: colors.accent, backgroundColor: `${colors.accent}05` }]}
          >
            <View style={[styles.plusCircle, { backgroundColor: colors.accent }]}>
              <LucidePlus color="#fff" size={20} />
            </View>
            <ThemedText className="font-bold text-base" style={{ color: colors.accent }}>Add New Account</ThemedText>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </ThemedSafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20 },
  header: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  accountCard: { borderRadius: 16, borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  cardMain: { flexDirection: 'row', alignItems: 'center' },
  
  reorderColumn: { 
    paddingVertical: 12, 
    paddingHorizontal: 10, 
    alignItems: 'center', 
    justifyContent: 'center',
    borderRightWidth: 1,
    minHeight: 80
  },
  miniReorderBtn: { padding: 4 },
  
  cardContent: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingLeft: 12 },
  emojiCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  
  trailingActions: { paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  circleBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  
  addCard: { height: 64, borderRadius: 16, borderStyle: 'dashed', borderWidth: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 12 },
  plusCircle: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});

export default ManageAccountsScreen;
