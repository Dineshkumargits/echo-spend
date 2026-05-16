import React, { useState, useEffect, useCallback } from 'react';
import {
  View, ScrollView, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { MotiView } from 'moti';
import {
  LucideX, LucideCheck, LucidePlus, LucideTrash2,
  LucideUsers, LucideToggleLeft, LucideToggleRight,
  LucideWallet, LucideSplit,
} from 'lucide-react-native';
import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import { useTheme } from '../theme/ThemeProvider';
import { useStore } from '../store/useStore';
import { notify } from '../utils/notify';
import {
  getAccounts, createSplit,
  Account, Transaction,
} from '../services/database';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemberRow {
  key: string;
  name: string;
  share: string;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

const SplitExpenseScreen = ({ navigation, route }: any) => {
  const { transaction }: { transaction?: Transaction } = route.params ?? {};
  const { colors } = useTheme();
  const { preferences } = useStore();
  const cur = preferences.currency;

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [title, setTitle] = useState(transaction?.merchant ?? '');
  const [totalStr, setTotalStr] = useState(String(transaction?.amount ?? ''));
  const [date] = useState(transaction?.date?.split('T')[0] ?? new Date().toISOString().split('T')[0]);
  const [paidByAccountId, setPaidByAccountId] = useState<number | null>(transaction?.accountId ?? null);
  const [receiveToAccountId, setReceiveToAccountId] = useState<number | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([
    { key: 'p1', name: '', share: '' },
  ]);
  const [splitEqually, setSplitEqually] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAccounts().then(accs => {
      setAccounts(accs);
      if (!paidByAccountId && accs.length) setPaidByAccountId(accs[0].id);
      if (accs.length) setReceiveToAccountId(accs[0].id);
    });
  }, []);

  const total = parseFloat(totalStr) || 0;

  // My share = total - sum of others (rounded to 2dp to avoid float noise)
  const othersTotal = members.reduce((s, m) => s + (parseFloat(m.share) || 0), 0);
  const myShare = Math.max(0, Math.round((total - othersTotal) * 100) / 100);

  const distributeEqually = useCallback((count: number, tot: number) => {
    if (count < 1 || tot <= 0) return '';
    const each = tot / (count + 1); // +1 for "me"
    return each.toFixed(2);
  }, []);

  // When total or member count changes and splitEqually is on, redistribute
  useEffect(() => {
    if (!splitEqually) return;
    const share = distributeEqually(members.length, total);
    setMembers(prev => prev.map(m => ({ ...m, share })));
  }, [splitEqually, members.length, total, distributeEqually]);

  const addMember = () => {
    const key = `p${Date.now()}`;
    const share = splitEqually ? distributeEqually(members.length + 1, total) : '';
    setMembers(prev => [...prev, { key, name: '', share }]);
  };

  const removeMember = (key: string) => {
    if (members.length === 1) return;
    setMembers(prev => {
      const next = prev.filter(m => m.key !== key);
      if (splitEqually) {
        const share = distributeEqually(next.length, total);
        return next.map(m => ({ ...m, share }));
      }
      return next;
    });
  };

  const updateMember = (key: string, field: 'name' | 'share', value: string) => {
    setMembers(prev => prev.map(m => m.key === key ? { ...m, [field]: value } : m));
  };

  const handleSave = async () => {
    if (!title.trim()) { notify.error('Enter a title for this split'); return; }
    if (total <= 0) { notify.error('Enter a valid total amount'); return; }
    if (members.some(m => !m.name.trim())) { notify.error('Enter a name for each person'); return; }
    if (members.some(m => (parseFloat(m.share) || 0) <= 0)) { notify.error('Each person needs a share > 0'); return; }
    if (othersTotal >= total) { notify.error("Others' total can't exceed the bill amount"); return; }

    setSaving(true);
    try {
      const allMembers = [
        // "Me" row — already paid (I paid the full bill)
        { name: 'Me', share: myShare, isMe: true, isPaid: true },
        ...members.map(m => ({
          name: m.name.trim(),
          share: parseFloat(m.share),
          isMe: false,
          isPaid: false,
        })),
      ];

      await createSplit(
        {
          transactionId: transaction?.id,
          title: title.trim(),
          totalAmount: total,
          paidByAccountId: paidByAccountId ?? undefined,
          receiveToAccountId: receiveToAccountId ?? undefined,
          date,
          notes: undefined,
        },
        allMembers,
      );

      notify.success('Split created');
      navigation.goBack();
    } catch (e) {
      notify.error('Failed to create split');
    }
    setSaving(false);
  };

  const AccountPill = ({
    label, value, onChange,
  }: { label: string; value: number | null; onChange: (id: number) => void }) => (
    <View style={{ marginBottom: 16 }}>
      <ThemedText style={{ fontSize: 11, fontWeight: '700', color: colors.secondary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
        {label}
      </ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {accounts.map(acc => (
          <TouchableOpacity
            key={acc.id}
            onPress={() => onChange(acc.id)}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99,
              borderWidth: 1.5,
              backgroundColor: value === acc.id ? `${colors.accent}18` : 'transparent',
              borderColor: value === acc.id ? colors.accent : colors.border,
            }}
          >
            <LucideWallet color={value === acc.id ? colors.accent : colors.secondary} size={13} />
            <ThemedText style={{ fontSize: 13, fontWeight: '600', color: value === acc.id ? colors.accent : colors.primary }}>
              {acc.name}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <ThemedSafeAreaView edges={['top', 'bottom']}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.translucent }}
        >
          <LucideX color={colors.primary} size={18} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          <LucideSplit color={colors.accent} size={18} />
          <ThemedText style={{ fontSize: 16, fontWeight: '700' }}>Split Expense</ThemedText>
        </View>
        <TouchableOpacity
          onPress={handleSave}
          disabled={saving}
          style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 99, backgroundColor: colors.accent }}
        >
          <ThemedText style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>Save</ThemedText>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 4 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Title */}
          <ThemedText style={{ fontSize: 11, fontWeight: '700', color: colors.secondary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
            Title
          </ThemedText>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Dinner at Barbeque Nation"
            placeholderTextColor={colors.muted}
            style={{ padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, color: colors.primary, backgroundColor: colors.surface, fontSize: 15, marginBottom: 20 }}
          />

          {/* Total Amount */}
          <ThemedText style={{ fontSize: 11, fontWeight: '700', color: colors.secondary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
            Total Bill Amount
          </ThemedText>
          <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surface, paddingHorizontal: 14, marginBottom: 20 }}>
            <ThemedText style={{ fontSize: 20, fontWeight: '700', color: colors.secondary, marginRight: 6 }}>{cur}</ThemedText>
            <TextInput
              value={totalStr}
              onChangeText={setTotalStr}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.muted}
              editable={!transaction}
              style={{ flex: 1, fontSize: 28, fontWeight: '700', paddingVertical: 14, color: transaction ? colors.secondary : colors.primary }}
            />
            {transaction && (
              <ThemedText style={{ fontSize: 11, color: colors.muted }}>from txn</ThemedText>
            )}
          </View>

          {/* Paid from */}
          <AccountPill label="Paid from account" value={paidByAccountId} onChange={setPaidByAccountId} />

          {/* Receive repayments to */}
          <AccountPill label="Collect repayments to" value={receiveToAccountId} onChange={setReceiveToAccountId} />

          {/* Split equally toggle */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, padding: 14, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
            <View>
              <ThemedText style={{ fontSize: 14, fontWeight: '600' }}>Split equally</ThemedText>
              <ThemedText style={{ fontSize: 12, color: colors.secondary, marginTop: 2 }}>
                Auto-divide between everyone including you
              </ThemedText>
            </View>
            <TouchableOpacity onPress={() => setSplitEqually(v => !v)}>
              {splitEqually
                ? <LucideToggleRight color={colors.accent} size={32} />
                : <LucideToggleLeft color={colors.muted} size={32} />
              }
            </TouchableOpacity>
          </View>

          {/* Members section */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <LucideUsers color={colors.secondary} size={14} />
              <ThemedText style={{ fontSize: 11, fontWeight: '700', color: colors.secondary, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Split with
              </ThemedText>
            </View>
            <TouchableOpacity
              onPress={addMember}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, backgroundColor: `${colors.accent}18` }}
            >
              <LucidePlus color={colors.accent} size={12} />
              <ThemedText style={{ fontSize: 12, fontWeight: '700', color: colors.accent }}>Add person</ThemedText>
            </TouchableOpacity>
          </View>

          {/* Me row (read-only) */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10, padding: 14, borderRadius: 14, backgroundColor: `${colors.accent}10`, borderWidth: 1, borderColor: `${colors.accent}30` }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.accent}20` }}>
              <ThemedText style={{ fontSize: 13, fontWeight: '800', color: colors.accent }}>Me</ThemedText>
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText style={{ fontSize: 14, fontWeight: '600', color: colors.accent }}>You (paid the full bill)</ThemedText>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <ThemedText style={{ fontSize: 16, fontWeight: '700', color: colors.accent }}>
                {cur}{myShare > 0 ? myShare.toFixed(2) : '—'}
              </ThemedText>
              <ThemedText style={{ fontSize: 10, color: colors.secondary }}>your share</ThemedText>
            </View>
          </View>

          {/* Other members */}
          {members.map((m, i) => (
            <MotiView
              key={m.key}
              from={{ opacity: 0, translateX: -16 }}
              animate={{ opacity: 1, translateX: 0 }}
              transition={{ type: 'timing', duration: 250 }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}
            >
              <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                <ThemedText style={{ fontSize: 13, fontWeight: '700', color: colors.secondary }}>{i + 1}</ThemedText>
              </View>
              <TextInput
                value={m.name}
                onChangeText={v => updateMember(m.key, 'name', v)}
                placeholder="Name"
                placeholderTextColor={colors.muted}
                style={{ flex: 1, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, color: colors.primary, backgroundColor: colors.surface, fontSize: 14 }}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface, paddingHorizontal: 8 }}>
                <ThemedText style={{ fontSize: 13, color: colors.secondary }}>{cur}</ThemedText>
                <TextInput
                  value={m.share}
                  onChangeText={v => !splitEqually && updateMember(m.key, 'share', v)}
                  editable={!splitEqually}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                  style={{ width: 70, padding: 12, fontSize: 14, fontWeight: '600', color: splitEqually ? colors.secondary : colors.primary }}
                />
              </View>
              {members.length > 1 && (
                <TouchableOpacity onPress={() => removeMember(m.key)} style={{ padding: 6 }}>
                  <LucideTrash2 color={colors.danger} size={16} />
                </TouchableOpacity>
              )}
            </MotiView>
          ))}

          {/* Summary */}
          {total > 0 && (
            <MotiView
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{ marginTop: 8, padding: 16, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 8 }}
            >
              <ThemedText style={{ fontSize: 11, fontWeight: '700', color: colors.secondary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>Summary</ThemedText>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <ThemedText style={{ color: colors.secondary, fontSize: 13 }}>Total bill</ThemedText>
                <ThemedText style={{ fontWeight: '700', fontSize: 13 }}>{cur}{total.toLocaleString('en-IN')}</ThemedText>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <ThemedText style={{ color: colors.secondary, fontSize: 13 }}>Your share</ThemedText>
                <ThemedText style={{ fontWeight: '700', fontSize: 13, color: colors.accent }}>{cur}{myShare.toFixed(2)}</ThemedText>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <ThemedText style={{ color: colors.secondary, fontSize: 13 }}>To collect from others</ThemedText>
                <ThemedText style={{ fontWeight: '700', fontSize: 13, color: colors.success }}>{cur}{othersTotal.toFixed(2)}</ThemedText>
              </View>
              <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <ThemedText style={{ fontSize: 13, fontWeight: '600' }}>{members.length + 1} people</ThemedText>
                <ThemedText style={{ fontSize: 11, color: colors.muted }}>including you</ThemedText>
              </View>
            </MotiView>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedSafeAreaView>
  );
};

export default SplitExpenseScreen;
