import { ThemedSafeAreaView } from '../components/ThemedSafeAreaView';
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { MotiView } from 'moti';
import {
  LucideZap,
  LucideInbox,
  LucideClock,
  LucideChevronRight,
  LucideRotateCcw,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useIsFocused } from '@react-navigation/native';
import {
  getUnconfirmedTransactions,
  Transaction,
  getLastScanTime,
  clearSmsHashesSince,
  resetAllAccountScanDates,
  getLastConfirmedSmsTransactionDate,
} from '../services/database';
import { useTheme } from '../theme/ThemeProvider';
import { ThemedText } from '../components/ThemedSafeAreaView';
import { useStore } from '../store/useStore';
import { SonarSweep, SectionLabel } from '../components/Signal';
import { fonts } from '../theme/tokens';

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

const SmartScanTab = ({ navigation }: any) => {
  const [pendingCount, setPendingCount] = useState(0);
  const [latestPending, setLatestPending] = useState<Transaction[]>([]);
  const [lastScanTime, setLastScanTime] = useState<string | null>(null);
  const { colors, isDark } = useTheme();
  const { preferences } = useStore();
  const isFocused = useIsFocused();

  const loadData = useCallback(async () => {
    const [data, scanTime] = await Promise.all([
      getUnconfirmedTransactions(),
      getLastScanTime(),
    ]);
    setPendingCount(data.length);
    setLatestPending(data.slice(0, 3));
    setLastScanTime(scanTime);
  }, []);

  const handleRescanFrom = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Auto-detect the anchor: date of the last confirmed SMS transaction.
    // Fall back to start-of-today if nothing has been confirmed yet.
    const lastDate = await getLastConfirmedSmsTransactionDate();
    const anchor = new Date(lastDate ?? new Date().toISOString());
    anchor.setHours(0, 0, 0, 0); // rewind to midnight of that day
    const isoDate = anchor.toISOString();

    // Clear hashes from that point so missed SMS are no longer blocked.
    // The scan loop itself guards against re-importing already-confirmed
    // transactions via isRawSmsAlreadyExists(), so no hash restoration needed.
    await clearSmsHashesSince(isoDate);
    await resetAllAccountScanDates(isoDate);
    await loadData();
    navigation.navigate('SmartScan');
  }, [loadData, navigation]);

  const confirmRescan = useCallback(() => {
    Alert.alert(
      'Rescan missed SMS',
      'This will re-read SMS from your last confirmed transaction onwards. Already-confirmed transactions will not be duplicated.',
      [
        {
          text: 'Rescan',
          onPress: handleRescanFrom,
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [handleRescanFrom]);

  useEffect(() => {
    if (isFocused) loadData();
  }, [isFocused]);

  return (
    <ThemedSafeAreaView>
      <View className="flex-1 px-6">
        {/* Hero section */}
        <View className="flex-1 items-center justify-center">
          <MotiView
            from={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'timing', duration: 500 }}
            className="items-center w-full"
          >
            {/* Icon with glow */}
            <View className="mb-6">
              <SonarSweep size={150} />
            </View>

            <SectionLabel>On-device AI</SectionLabel>
            <Text
              className="text-center mb-2"
              style={{ fontFamily: fonts.displayBold, fontSize: 30, letterSpacing: -0.5, marginTop: 4, color: colors.primary }}
            >
              Smart Scan
            </Text>
            <Text className="text-center text-sm px-8 leading-5 mb-2" style={{ color: colors.muted }}>
              AI reads your bank SMS and auto-categorizes transactions — with account detection and anomaly alerts.
            </Text>

            {/* Last scan indicator */}
            {lastScanTime && (
              <View className="flex-row items-center mb-4">
                <LucideClock color={colors.muted} size={12} />
                <ThemedText type="secondary" className="text-[11px] ml-1.5 font-medium">
                  Last scan: {(() => {
                    const d = new Date(lastScanTime);
                    const isToday = new Date().toDateString() === d.toDateString();
                    const dateStr = isToday ? 'Today' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                    const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                    const relative = formatRelativeTime(lastScanTime);
                    return `${dateStr}, ${timeStr} (${relative})`;
                  })()}
                </ThemedText>
              </View>
            )}

            {/* Scan button */}
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                navigation.navigate('SmartScan');
              }}
              activeOpacity={0.85}
              className="rounded-full px-10 py-4 mb-3 w-full items-center"
              style={{
                backgroundColor: colors.debit,
                shadowColor: colors.debit,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.4,
                shadowRadius: 16,
                elevation: 12,
              }}
            >
              <View className="flex-row items-center">
                <LucideZap color={colors.onAccent} size={18} />
                <Text
                  className="ml-2"
                  style={{ fontFamily: fonts.signalBold, fontSize: 13, letterSpacing: 1.4, textTransform: 'uppercase', color: colors.onAccent }}
                >
                  Scan SMS
                </Text>
              </View>
            </TouchableOpacity>

            {/* Rescan missed SMS */}
            <TouchableOpacity
              onPress={confirmRescan}
              activeOpacity={0.7}
              className="flex-row items-center justify-center mb-5 py-2"
            >
              <LucideRotateCcw color={colors.muted} size={13} />
              <ThemedText type="secondary" className="text-xs ml-1.5">
                Rescan missed SMS
              </ThemedText>
            </TouchableOpacity>

            {/* Pending review queue */}
            {pendingCount > 0 && (
              <MotiView
                from={{ opacity: 0, translateY: 10 }}
                animate={{ opacity: 1, translateY: 0 }}
                className="w-full mb-4"
              >
                <TouchableOpacity
                  onPress={() => navigation.navigate('SmartInbox')}
                  activeOpacity={0.9}
                  className="rounded-apple-xl p-4 border"
                  style={{ backgroundColor: colors.surface, borderColor: colors.border }}
                >
                  <View className="flex-row justify-between items-center mb-3">
                    <View className="flex-row items-center">
                      <LucideInbox color={colors.accent} size={16} />
                      <ThemedText className="font-bold ml-2">Pending Review</ThemedText>
                      <View
                        className="ml-2 px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: colors.accent }}
                      >
                        <Text className="text-white text-[10px] font-bold">{pendingCount}</Text>
                      </View>
                    </View>
                    <LucideChevronRight color={colors.muted} size={16} />
                  </View>

                  {latestPending.map((tx, idx) => (
                    <View
                      key={tx.id}
                      className={`flex-row justify-between items-center ${idx < latestPending.length - 1 ? 'mb-3' : ''}`}
                    >
                      <View className="flex-1">
                        <ThemedText className="font-medium text-sm" numberOfLines={1}>{tx.merchant}</ThemedText>
                        <ThemedText type="secondary" className="text-[10px] uppercase font-bold tracking-widest mt-0.5">
                          {tx.category}
                        </ThemedText>
                      </View>
                      <ThemedText className="font-bold ml-4" style={{ color: tx.type === 'credit' ? colors.success : colors.primary }}>
                        {tx.type === 'credit' ? '+' : '-'}{preferences.hideAmounts ? '****' : `${preferences.currency}${tx.amount.toLocaleString('en-IN')}`}
                      </ThemedText>
                    </View>
                  ))}

                  {pendingCount > 3 && (
                    <ThemedText type="secondary" className="text-xs text-center mt-3">
                      +{pendingCount - 3} more · tap to review all
                    </ThemedText>
                  )}
                </TouchableOpacity>
              </MotiView>
            )}
          </MotiView>
        </View>

        {/* Bottom section: info cards */}
        <View className="pb-4">
          {/* Info pills */}
          <View className="flex-row">
            <View className="flex-1 p-4 rounded-apple-md border mr-2" style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
              <Text style={{ color: colors.accent, fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                Privacy First
              </Text>
              <Text style={{ color: colors.secondary, fontSize: 11, lineHeight: 16 }}>
                All data stays on your device. Nothing uploaded.
              </Text>
            </View>
            <View className="flex-1 p-4 rounded-apple-md border ml-2" style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
              <Text style={{ color: colors.credit, fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                AI Powered
              </Text>
              <Text style={{ color: colors.secondary, fontSize: 11, lineHeight: 16 }}>
                Auto-categorizes, assigns accounts, detects anomalies.
              </Text>
            </View>
          </View>
        </View>
      </View>
    </ThemedSafeAreaView>
  );
};

export default SmartScanTab;
