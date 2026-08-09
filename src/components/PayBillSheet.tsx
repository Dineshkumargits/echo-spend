/**
 * Pay a credit card bill.
 *
 * The payment is recorded as a transfer from a funding account to the card —
 * which is what it actually is — so both balances move correctly through the
 * normal transaction impact path (a credit to a card account reduces its
 * outstanding). The statement is then reduced through the same oldest-first
 * waterfall used for payments detected from SMS, so a partial payment leaves the
 * bill open with a smaller remaining rather than flipping it to paid.
 */
import React, { useMemo, useState, useEffect } from 'react';
import { View, Pressable, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LucideWallet, LucideCheck } from 'lucide-react-native';
import { ThemedText } from './ThemedSafeAreaView';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, formatINR } from '../theme/tokens';
import { BottomSheet, FieldLabel, TextField, PrimaryButton, IconTile } from './Kit';
import { AmountText } from './Signal';
import { notify } from '../utils/notify';
import {
  addTransaction,
  applyCardPayment,
  Account,
  CardStatement,
} from '../services/database';

type Preset = 'full' | 'minimum' | 'custom';

interface PayBillSheetProps {
  visible: boolean;
  onClose: () => void;
  card: Account | null;
  statement: CardStatement | null;
  /** Accounts money can come from — banks, cash and wallets, never other cards. */
  fundingAccounts: Account[];
  currency: string;
  masked: boolean;
  /** Called after a successful payment so the caller can reload. */
  onPaid: () => void;
}

export const PayBillSheet: React.FC<PayBillSheetProps> = ({
  visible,
  onClose,
  card,
  statement,
  fundingAccounts,
  currency,
  masked,
  onPaid,
}) => {
  const { colors } = useTheme();

  const remaining = statement
    ? Math.max(statement.totalDue - statement.paidAmount, 0)
    : Math.max(card?.balance ?? 0, 0);
  const minimumDue = statement?.minimumDue ?? null;

  const [preset, setPreset] = useState<Preset>('full');
  const [customAmount, setCustomAmount] = useState('');
  const [fundingId, setFundingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset on each open so a previous half-finished payment never leaks through.
  useEffect(() => {
    if (!visible) return;
    setPreset('full');
    setCustomAmount('');
    setFundingId(fundingAccounts[0]?.id ?? null);
    setSaving(false);
  }, [visible, fundingAccounts]);

  const amount = useMemo(() => {
    if (preset === 'full') return remaining;
    if (preset === 'minimum') return minimumDue ?? 0;
    const parsed = parseFloat(customAmount);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [preset, remaining, minimumDue, customAmount]);

  const funding = fundingAccounts.find((a) => a.id === fundingId) ?? null;
  // Cards can be overpaid (credit balance is legitimate), so the only hard limit
  // is that something must actually be paid.
  const canPay = !!card && !!funding && amount > 0 && !saving;

  const handlePay = async () => {
    if (!card || !funding || amount <= 0) return;
    setSaving(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

      await addTransaction({
        amount,
        category: 'Transfer',
        merchant: `${card.name} payment`,
        type: 'transfer',
        date: new Date().toISOString(),
        accountId: funding.id,
        toAccountId: card.id,
        isConfirmed: true,
        isTransfer: true,
        source: 'manual',
      } as any);

      // Reduce the statement through the same waterfall SMS-detected payments use.
      await applyCardPayment(card.id, amount);

      notify.success(
        amount >= remaining - 0.01 ? 'Bill paid' : 'Partial payment recorded',
      );
      onPaid();
      onClose();
    } catch (e) {
      notify.error('Could not record the payment');
    } finally {
      setSaving(false);
    }
  };

  const PresetChip: React.FC<{ value: Preset; label: string; sub?: string; disabled?: boolean }> = ({
    value, label, sub, disabled,
  }) => {
    const active = preset === value;
    return (
      <Pressable
        onPress={() => {
          if (disabled) return;
          Haptics.selectionAsync().catch(() => {});
          setPreset(value);
        }}
        style={{
          flex: 1,
          paddingVertical: 12,
          paddingHorizontal: 10,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: active ? colors.accent : colors.border,
          backgroundColor: active ? `${colors.accent}18` : 'transparent',
          opacity: disabled ? 0.4 : 1,
          alignItems: 'center',
        }}
      >
        <ThemedText
          style={{
            fontFamily: fonts.textMedium,
            fontSize: 13,
            color: active ? colors.accent : colors.primary,
          }}
        >
          {label}
        </ThemedText>
        {sub && (
          <ThemedText
            style={{ fontFamily: fonts.signal, fontSize: 10, color: colors.secondary, marginTop: 3 }}
          >
            {sub}
          </ThemedText>
        )}
      </Pressable>
    );
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={`Pay ${card?.name ?? 'bill'}`}>
      <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
        <View style={{ alignItems: 'center', marginBottom: 18 }}>
          <ThemedText style={{ fontSize: 11, color: colors.secondary, letterSpacing: 1.6 }}>
            {statement ? 'DUE NOW' : 'OUTSTANDING'}
          </ThemedText>
          <AmountText
            value={remaining}
            size={30}
            currency={currency}
            masked={masked}
            kind="debit"
            style={{ marginTop: 4 }}
          />
          {statement && (
            <ThemedText style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
              {`Due ${new Date(statement.dueDate).toLocaleDateString('en-IN', {
                day: 'numeric', month: 'short',
              })}`}
              {statement.paidAmount > 0 &&
                ` · ${currency}${formatINR(statement.paidAmount)} already paid`}
            </ThemedText>
          )}
        </View>

        <FieldLabel>Amount</FieldLabel>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          <PresetChip
            value="full"
            label="Full"
            sub={masked ? '••••' : `${currency}${formatINR(remaining)}`}
          />
          <PresetChip
            value="minimum"
            label="Minimum"
            // Disabled rather than hidden, so it's clear the bank didn't tell us.
            disabled={!minimumDue}
            sub={minimumDue ? (masked ? '••••' : `${currency}${formatINR(minimumDue)}`) : 'n/a'}
          />
          <PresetChip value="custom" label="Custom" />
        </View>

        {preset === 'custom' && (
          <TextField
            keyboardType="numeric"
            value={customAmount}
            onChangeText={setCustomAmount}
            placeholder={`${currency}0`}
            style={{ fontFamily: fonts.signal, fontSize: 15 }}
          />
        )}

        {preset === 'minimum' && minimumDue !== null && (
          <ThemedText
            style={{ fontSize: 11, color: colors.debit, lineHeight: 16, marginBottom: 4 }}
          >
            Paying only the minimum avoids a late fee, but interest still accrues
            on the rest — usually 36–42% a year.
          </ThemedText>
        )}

        <FieldLabel style={{ marginTop: 16 }}>Pay from</FieldLabel>
        <ScrollView style={{ maxHeight: 190 }} showsVerticalScrollIndicator={false}>
          {fundingAccounts.length === 0 && (
            <ThemedText style={{ fontSize: 12, color: colors.muted, paddingVertical: 8 }}>
              No bank, cash or wallet account to pay from. Add one first.
            </ThemedText>
          )}
          {fundingAccounts.map((a) => {
            const active = a.id === fundingId;
            const short = a.balance < amount;
            return (
              <Pressable
                key={a.id}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setFundingId(a.id);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  borderRadius: 14,
                  marginBottom: 8,
                  borderWidth: 1,
                  borderColor: active ? colors.accent : colors.border,
                  backgroundColor: active ? `${colors.accent}12` : 'transparent',
                }}
              >
                <IconTile color={active ? colors.accent : colors.secondary} size={34}>
                  <LucideWallet size={15} color={active ? colors.accent : colors.secondary} />
                </IconTile>
                <View style={{ flex: 1 }}>
                  <ThemedText
                    numberOfLines={1}
                    style={{ fontFamily: fonts.textMedium, fontSize: 14 }}
                  >
                    {a.name}
                  </ThemedText>
                  <ThemedText
                    style={{
                      fontFamily: fonts.signal,
                      fontSize: 11,
                      color: short ? colors.debit : colors.secondary,
                      marginTop: 2,
                    }}
                  >
                    {masked ? `${currency}••••` : `${currency}${formatINR(a.balance)}`}
                    {short ? ' · not enough' : ''}
                  </ThemedText>
                </View>
                {active && <LucideCheck size={16} color={colors.accent} />}
              </Pressable>
            );
          })}
        </ScrollView>

        {/* A short funding account is a warning, not a block — the money may
            arrive before the transfer clears, and the user knows their situation. */}
        {funding && funding.balance < amount && (
          <ThemedText style={{ fontSize: 11, color: colors.debit, marginTop: 2, lineHeight: 16 }}>
            {`${funding.name} has less than this. You can still record the payment.`}
          </ThemedText>
        )}

        <PrimaryButton
          label={
            amount > 0 && !masked
              ? `Pay ${currency}${formatINR(amount)}`
              : 'Pay'
          }
          onPress={handlePay}
          disabled={!canPay}
          tone="echo"
          style={{ marginTop: 18 }}
        />
      </View>
    </BottomSheet>
  );
};
