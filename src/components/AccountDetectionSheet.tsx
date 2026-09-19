import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
  StyleSheet,
} from 'react-native';
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';
import {
  LucideSparkles,
  LucideCheck,
  LucideShieldCheck,
  LucideRefreshCw,
  LucideCreditCard,
  LucideLandmark,
  LucideChevronDown,
  LucideChevronUp,
  LucideAlertCircle,
  LucidePlus,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme/ThemeProvider';
import { ThemedText } from './ThemedSafeAreaView';
import { BottomSheet } from './Kit';
import { notify } from '../utils/notify';
import {
  detectAccountsFromSms,
  addDetectedAccounts,
  checkSmsPermission,
  requestSmsPermission,
  DetectedAccountCandidate,
} from '../services/accountDetector';

interface CandidateItem extends DetectedAccountCandidate {
  selected: boolean;
  nameInput: string;
  balanceInput: string;
}

interface AccountDetectionSheetProps {
  visible: boolean;
  onClose: () => void;
  onAccountsAdded: (count: number) => void;
  currency?: string;
  navigation?: any;
}

export const AccountDetectionSheet: React.FC<AccountDetectionSheetProps> = ({
  visible,
  onClose,
  onAccountsAdded,
  currency = '₹',
  navigation,
}) => {
  const { colors, isDark } = useTheme();

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [candidates, setCandidates] = useState<CandidateItem[]>([]);
  const [existingAccounts, setExistingAccounts] = useState<DetectedAccountCandidate[]>([]);
  const [totalScanned, setTotalScanned] = useState(0);
  const [showExisting, setShowExisting] = useState(false);

  const startScan = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setIsScanning(false);
      return;
    }

    setIsScanning(true);
    setCandidates([]);
    setExistingAccounts([]);

    try {
      const result = await detectAccountsFromSms({ daysBack: 365, maxMessages: 3000 });
      setTotalScanned(result.totalSmsScanned);
      setExistingAccounts(result.existingAccounts);

      const items: CandidateItem[] = result.newCandidates.map((c) => ({
        ...c,
        selected: true,
        nameInput: c.suggestedName,
        balanceInput: c.balance > 0 ? String(c.balance) : '0',
      }));
      setCandidates(items);

      if (items.length > 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (err) {
      console.warn('[AccountDetectionSheet] Scan error:', err);
      notify.error('Failed to scan SMS for accounts');
    } finally {
      setIsScanning(false);
    }
  }, []);

  const handleInitialCheck = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setHasPermission(false);
      setIsScanning(false);
      return;
    }
    const granted = await checkSmsPermission();
    setHasPermission(granted);
    if (granted) {
      startScan();
    } else {
      setIsScanning(false);
    }
  }, [startScan]);

  useEffect(() => {
    if (visible) {
      if (Platform.OS === 'android') {
        setIsScanning(true);
      }
      handleInitialCheck();
    } else {
      setIsScanning(false);
      setIsSaving(false);
      setCandidates([]);
      setExistingAccounts([]);
      setShowExisting(false);
    }
  }, [visible, handleInitialCheck]);

  const handleRequestPermission = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const granted = await requestSmsPermission();
    setHasPermission(granted);
    if (granted) {
      startScan();
    } else {
      notify.info('SMS Permission', 'SMS permission is required to detect accounts');
    }
  };

  const toggleSelect = (key: string) => {
    Haptics.selectionAsync();
    setCandidates((prev) =>
      prev.map((c) => (c.key === key ? { ...c, selected: !c.selected } : c))
    );
  };

  const toggleSelectAll = () => {
    Haptics.selectionAsync();
    const allSelected = candidates.every((c) => c.selected);
    setCandidates((prev) => prev.map((c) => ({ ...c, selected: !allSelected })));
  };

  const updateName = (key: string, nameInput: string) => {
    setCandidates((prev) =>
      prev.map((c) => (c.key === key ? { ...c, nameInput } : c))
    );
  };

  const updateBalance = (key: string, balanceInput: string) => {
    setCandidates((prev) =>
      prev.map((c) => (c.key === key ? { ...c, balanceInput } : c))
    );
  };

  const handleSaveAccounts = async () => {
    const selected = candidates.filter((c) => c.selected);
    if (selected.length === 0) {
      notify.info('No accounts selected', 'Please select at least one account');
      return;
    }

    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const payload = selected.map((item) => {
        const bal = parseFloat(item.balanceInput) || 0;
        return {
          name: item.nameInput.trim() || item.suggestedName,
          balance: bal,
          accountType: item.accountType,
          last4Digits: item.last4Digits,
        };
      });

      const addedIds = await addDetectedAccounts(payload);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      notify.success(
        `Added ${addedIds.length} ${addedIds.length === 1 ? 'account' : 'accounts'}`
      );
      onAccountsAdded(addedIds.length);
      onClose();
    } catch (err) {
      notify.error('Failed to save accounts');
    } finally {
      setIsSaving(false);
    }
  };

  const selectedCount = candidates.filter((c) => c.selected).length;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Detect Accounts"
      maxHeightPct={0.92}
      right={
        !isScanning && hasPermission && (
          <TouchableOpacity
            onPress={startScan}
            style={{ padding: 6 }}
            activeOpacity={0.7}
          >
            <LucideRefreshCw color={colors.primary} size={18} />
          </TouchableOpacity>
        )
      }
    >
      <View style={{ minHeight: 320, maxHeight: 580, paddingHorizontal: 20, paddingBottom: 16 }}>
        {/* On iOS: graceful fallback notice */}
        {Platform.OS === 'ios' && (
          <View style={styles.centerBox}>
            <View
              style={[
                styles.iconBadge,
                { backgroundColor: `${colors.accent}15` },
              ]}
            >
              <LucideShieldCheck color={colors.accent} size={32} />
            </View>
            <ThemedText className="text-lg font-bold text-center mt-3 mb-2">
              SMS Scan Unavailable on iOS
            </ThemedText>
            <ThemedText
              type="secondary"
              className="text-sm text-center leading-5 mb-6"
            >
              Apple sandboxes incoming SMS messages from third-party apps for privacy. You can add your bank accounts and credit cards manually in seconds.
            </ThemedText>
            <TouchableOpacity
              onPress={() => {
                onClose();
                navigation?.navigate('AddAccount');
              }}
              style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
            >
              <ThemedText style={{ color: '#fff', fontWeight: 'bold' }}>
                Add Account Manually
              </ThemedText>
            </TouchableOpacity>
          </View>
        )}

        {/* Android: No Permission Granted State */}
        {Platform.OS === 'android' && hasPermission === false && !isScanning && (
          <View style={styles.centerBox}>
            <View
              style={[
                styles.iconBadge,
                { backgroundColor: `${colors.accent}15` },
              ]}
            >
              <LucideSparkles color={colors.accent} size={36} />
            </View>
            <ThemedText className="text-xl font-bold text-center mt-4 mb-2">
              Scan SMS for Accounts
            </ThemedText>
            <ThemedText
              type="secondary"
              className="text-sm text-center leading-6 mb-6"
            >
              Echo Spend can read your financial SMS to automatically detect your bank accounts, credit cards, and latest balances.
            </ThemedText>

            <View
              style={[
                styles.privacyCard,
                { backgroundColor: colors.translucent, borderColor: colors.border },
              ]}
            >
              <LucideShieldCheck color={colors.accent} size={18} />
              <ThemedText type="secondary" className="text-xs flex-1 ml-2">
                100% Private & Local. Your messages never leave this device.
              </ThemedText>
            </View>

            <TouchableOpacity
              onPress={handleRequestPermission}
              style={[styles.primaryBtn, { backgroundColor: colors.accent, marginTop: 20 }]}
            >
              <ThemedText style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
                Allow & Scan SMS
              </ThemedText>
            </TouchableOpacity>
          </View>
        )}

        {/* Scanning Spinner State */}
        {isScanning && (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={colors.accent} />
            <ThemedText className="text-lg font-bold mt-4 mb-1">
              Analyzing Financial SMS...
            </ThemedText>
            <ThemedText type="secondary" className="text-xs text-center">
              Scanning your inbox for banks, credit cards, and balances
            </ThemedText>
          </View>
        )}

        {/* Results State */}
        {!isScanning && hasPermission && (
          <View style={{ flex: 1 }}>
            {candidates.length > 0 ? (
              <>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 12,
                  }}
                >
                  <ThemedText type="secondary" className="text-xs font-bold uppercase tracking-wider">
                    Found {candidates.length} {candidates.length === 1 ? 'Account' : 'Accounts'}
                  </ThemedText>
                  <TouchableOpacity onPress={toggleSelectAll} activeOpacity={0.6}>
                    <ThemedText style={{ color: colors.accent, fontSize: 12, fontWeight: '700' }}>
                      {candidates.every((c) => c.selected) ? 'Deselect All' : 'Select All'}
                    </ThemedText>
                  </TouchableOpacity>
                </View>

                <GHScrollView
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{ paddingBottom: 16, paddingTop: 4 }}
                  style={{ flexShrink: 1, maxHeight: 380 }}
                >
                  {candidates.map((item) => {
                    const isCC = item.accountType === 'credit_card';
                    return (
                      <View
                        key={item.key}
                        style={[
                          styles.candidateCard,
                          {
                            backgroundColor: item.selected
                              ? isDark
                                ? '#1e242b'
                                : '#f4f8fa'
                              : colors.surface,
                            borderColor: item.selected ? colors.accent : colors.border,
                          },
                        ]}
                      >
                        <TouchableOpacity
                          onPress={() => toggleSelect(item.key)}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            marginBottom: item.selected ? 10 : 0,
                          }}
                          activeOpacity={0.7}
                        >
                          {/* Checkbox */}
                          <View
                            style={[
                              styles.checkbox,
                              {
                                backgroundColor: item.selected ? colors.accent : 'transparent',
                                borderColor: item.selected ? colors.accent : colors.border,
                              },
                            ]}
                          >
                            {item.selected && <LucideCheck color="#fff" size={12} strokeWidth={3} />}
                          </View>

                          {/* Icon */}
                          <View
                            style={[
                              styles.typeIcon,
                              { backgroundColor: `${colors.accent}15` },
                            ]}
                          >
                            {isCC ? (
                              <LucideCreditCard color={colors.accent} size={18} />
                            ) : (
                              <LucideLandmark color={colors.accent} size={18} />
                            )}
                          </View>

                          {/* Title & Type */}
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <ThemedText className="font-bold text-base">
                              {item.bankName}
                            </ThemedText>
                            <ThemedText type="secondary" className="text-[11px]">
                              {isCC ? 'Credit Card' : 'Bank Account'} · ending in {item.last4Digits}
                            </ThemedText>
                          </View>

                          {/* SMS count badge */}
                          <View
                            style={[
                              styles.badge,
                              { backgroundColor: colors.translucent, borderColor: colors.border },
                            ]}
                          >
                            <ThemedText style={{ fontSize: 10, color: colors.secondary, fontWeight: '600' }}>
                              {item.smsCount} {item.smsCount === 1 ? 'SMS' : 'SMS'}
                            </ThemedText>
                          </View>
                        </TouchableOpacity>

                        {/* Editable Fields if selected */}
                        {item.selected && (
                          <View
                            style={[
                              styles.editRow,
                              { borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 10 },
                            ]}
                          >
                            <View style={{ flex: 1, marginRight: 10 }}>
                              <ThemedText type="secondary" className="text-[10px] font-bold uppercase mb-1">
                                Display Name
                              </ThemedText>
                              <TextInput
                                value={item.nameInput}
                                onChangeText={(val) => updateName(item.key, val)}
                                style={[
                                  styles.input,
                                  {
                                    color: colors.primary,
                                    borderColor: colors.border,
                                    backgroundColor: colors.surface,
                                  },
                                ]}
                                placeholder="Account Name"
                                placeholderTextColor={colors.muted}
                              />
                            </View>

                            <View style={{ width: 110 }}>
                              <ThemedText type="secondary" className="text-[10px] font-bold uppercase mb-1">
                                Balance ({currency})
                              </ThemedText>
                              <TextInput
                                value={item.balanceInput}
                                onChangeText={(val) => updateBalance(item.key, val)}
                                keyboardType="numeric"
                                style={[
                                  styles.input,
                                  {
                                    color: colors.primary,
                                    borderColor: colors.border,
                                    backgroundColor: colors.surface,
                                  },
                                ]}
                                placeholder="0"
                                placeholderTextColor={colors.muted}
                              />
                            </View>
                          </View>
                        )}
                      </View>
                    );
                  })}

                  {/* Already Linked Accounts Section */}
                  {existingAccounts.length > 0 && (
                    <View style={{ marginTop: 8, marginBottom: 12 }}>
                      <TouchableOpacity
                        onPress={() => setShowExisting(!showExisting)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingVertical: 8,
                        }}
                        activeOpacity={0.7}
                      >
                        <ThemedText type="secondary" className="text-xs font-semibold">
                          ✓ {existingAccounts.length} already linked {existingAccounts.length === 1 ? 'account' : 'accounts'}
                        </ThemedText>
                        {showExisting ? (
                          <LucideChevronUp color={colors.secondary} size={16} />
                        ) : (
                          <LucideChevronDown color={colors.secondary} size={16} />
                        )}
                      </TouchableOpacity>

                      {showExisting && (
                        <View style={{ marginTop: 6, gap: 8 }}>
                          {existingAccounts.map((acc) => (
                            <View
                              key={acc.key}
                              style={[
                                styles.existingRow,
                                { backgroundColor: colors.translucent, borderColor: colors.border },
                              ]}
                            >
                              <ThemedText className="text-xs font-medium flex-1">
                                {acc.suggestedName}
                              </ThemedText>
                              <ThemedText type="secondary" className="text-[10px]">
                                Already Linked
                              </ThemedText>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </GHScrollView>

                {/* Primary Button */}
                <View style={{ paddingTop: 8 }}>
                  <TouchableOpacity
                    onPress={handleSaveAccounts}
                    disabled={isSaving || selectedCount === 0}
                    style={[
                      styles.primaryBtn,
                      {
                        backgroundColor: colors.accent,
                        opacity: isSaving || selectedCount === 0 ? 0.5 : 1,
                      },
                    ]}
                    activeOpacity={0.8}
                  >
                    {isSaving ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <ThemedText style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
                        Add {selectedCount} {selectedCount === 1 ? 'Account' : 'Accounts'}
                      </ThemedText>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <View style={styles.centerBox}>
                <View
                  style={[
                    styles.iconBadge,
                    { backgroundColor: `${colors.secondary}15` },
                  ]}
                >
                  <LucideAlertCircle color={colors.secondary} size={32} />
                </View>
                <ThemedText className="text-lg font-bold text-center mt-3 mb-1">
                  No New Accounts Found
                </ThemedText>
                <ThemedText
                  type="secondary"
                  className="text-xs text-center leading-5 mb-5"
                >
                  {existingAccounts.length > 0
                    ? `Scanned ${totalScanned} messages. Your ${existingAccounts.length} detected ${existingAccounts.length === 1 ? 'account is' : 'accounts are'} already linked.`
                    : `Scanned ${totalScanned} messages, but didn't find any unlinked bank accounts or credit cards.`}
                </ThemedText>

                <TouchableOpacity
                  onPress={() => {
                    onClose();
                    navigation?.navigate('AddAccount');
                  }}
                  style={[
                    styles.primaryBtn,
                    {
                      backgroundColor: colors.translucent,
                      borderColor: colors.border,
                      borderWidth: 1,
                      flexDirection: 'row',
                      gap: 8,
                    },
                  ]}
                  activeOpacity={0.7}
                >
                  <LucidePlus color={colors.primary} size={18} />
                  <ThemedText style={{ color: colors.primary, fontWeight: '700' }}>
                    Add Account Manually
                  </ThemedText>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </View>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  iconBadge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  primaryBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  candidateCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 14,
    marginBottom: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  existingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
});
