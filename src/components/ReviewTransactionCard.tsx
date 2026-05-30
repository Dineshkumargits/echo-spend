import React, { useState } from 'react';
import { View, TouchableOpacity, TextInput } from 'react-native';
import * as Haptics from 'expo-haptics';
import { MotiView } from 'moti';
import {
  LucideArrowUpRight,
  LucideArrowDownLeft,
  LucideRotateCw,
  LucideInfo,
  LucidePencil,
  LucideTrash2,
  LucideCheck,
  LucideChevronDown,
  LucideZap,
  LucideAlertTriangle,
  LucidePlus,
} from 'lucide-react-native';
import { renderCategoryIcon } from './CategoryManager';
import { ThemedText } from './ThemedSafeAreaView';
import { useTheme } from '../theme/ThemeProvider';
import { useStore } from '../store/useStore';
import { Transaction, Account, Category, updateTransaction } from '../services/database';
import { TagInput } from './TagInput';

interface Props {
  tx: Transaction;
  isNew?: boolean;
  isOffline?: boolean;
  accounts: Account[];
  categories: Category[];
  accountOverride?: number;
  onConfirm: (tx: Transaction, accountId?: number) => void;
  onDelete: (tx: Transaction) => void;
  onEditPress: (tx: Transaction) => void;
  // Called when internal changes happen so the parent can update its state/queue
  onTransactionUpdated: (tx: Transaction) => void;
  onChangeAccount: (txId: number, accountId: number) => void;
}

export const ReviewTransactionCard = ({
  tx,
  isNew,
  isOffline,
  accounts,
  categories,
  accountOverride,
  onConfirm,
  onDelete,
  onEditPress,
  onTransactionUpdated,
  onChangeAccount,
}: Props) => {
  const { colors } = useTheme();
  const { preferences } = useStore();
  const currency = preferences?.currency ?? '₹';
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCatPicker, setShowCatPicker] = useState(false);
  const [catTab, setCatTab] = useState<'expense' | 'income' | 'transfer'>(
    tx.type === 'credit' ? 'income' : tx.type === 'transfer' ? 'transfer' : 'expense'
  );
  const [showAccPicker, setShowAccPicker] = useState(false);
  const [showToAccPicker, setShowToAccPicker] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);

  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(tx.merchant);

  const handleTypeChange = async (newType: 'credit' | 'debit' | 'transfer') => {
    if (newType === tx.type) return;
    const updates: any = { type: newType };
    if (newType === 'transfer') {
      updates.isTransfer = 1;
      if (tx.category !== 'Transfer') updates.category = 'Transfer';
    } else {
      updates.isTransfer = 0;
    }
    await updateTransaction(tx.id, updates);
    onTransactionUpdated({ ...tx, ...updates, isTransfer: !!updates.isTransfer });
    setCatTab(newType === 'credit' ? 'income' : newType === 'transfer' ? 'transfer' : 'expense');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const changeToAccount = async (toAccountId: number) => {
    await updateTransaction(tx.id, { toAccountId });
    onTransactionUpdated({ ...tx, toAccountId });
    setShowToAccPicker(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const confidence = tx.confidence ?? 'medium';
  const effectiveAcc = accounts.find(a => a.id === (accountOverride ?? tx.accountId));

  const confidenceColor: Record<string, string> = {
    high: colors.success,
    medium: colors.warning,
    low: colors.danger,
  };


  const saveNameEdit = async () => {
    const newName = tempName.trim();
    if (newName && newName !== tx.merchant) {
      await updateTransaction(tx.id, { merchant: newName });
      onTransactionUpdated({ ...tx, merchant: newName });
    } else {
      setTempName(tx.merchant);
    }
    setIsEditingName(false);
  };

  const changeCategory = async (catName: string) => {
    await updateTransaction(tx.id, { category: catName });
    onTransactionUpdated({ ...tx, category: catName });
    setShowCatPicker(false);
  };

  const changeTags = async (newTags: string[]) => {
    await updateTransaction(tx.id, { tags: newTags });
    onTransactionUpdated({ ...tx, tags: newTags });
  };

  return (
    <MotiView
      from={{ opacity: 0, translateY: 12 }}
      animate={{ opacity: 1, translateY: 0 }}
      exit={{ opacity: 0, translateX: 60 }}
      className="mb-3 mt-3 rounded-apple-xl border overflow-hidden"
      style={{
        backgroundColor: colors.surface,
        borderColor: isNew ? `${colors.accent}40` : colors.border,
      }}
    >
      {/* New badge */}
      {isNew && (
        <View className="px-3 py-1 flex-row items-center" style={{ backgroundColor: `${colors.accent}12` }}>
          <LucideZap color={colors.accent} size={10} />
          <ThemedText className="text-[9px] font-bold uppercase ml-1.5 tracking-widest" style={{ color: colors.accent }}>
            New this scan
          </ThemedText>
        </View>
      )}

      {/* Offline-parsed badge — shown when AI was unavailable */}
      {isOffline && (
        <View className="px-3 py-1 flex-row items-center" style={{ backgroundColor: `${colors.warning}12` }}>
          <LucideAlertTriangle color={colors.warning} size={10} />
          <ThemedText className="text-[9px] font-bold uppercase ml-1.5 tracking-widest" style={{ color: colors.warning }}>
            Verify — parsed locally
          </ThemedText>
        </View>
      )}

      <View className="p-4">
        {/* Row 1: amount + type + confidence + actions */}
        <View className="flex-row justify-between items-start mb-2">
          <View className="flex-1 mr-3">
            <View className="flex-row items-center mb-1">
              {tx.type === 'credit'
                ? <LucideArrowDownLeft color={colors.success} size={18} />
                : tx.type === 'transfer'
                  ? <LucideRotateCw color={colors.warning} size={18} />
                  : <LucideArrowUpRight color={colors.danger} size={18} />
              }
              <ThemedText className="font-bold text-2xl ml-1.5">
                {tx.type === 'credit' ? '+' : '-'}{currency}{tx.amount?.toLocaleString('en-IN') ?? '0'}
              </ThemedText>
              <View
                className="ml-2 px-2 py-0.5 rounded-full"
                style={{ backgroundColor: `${confidenceColor[confidence]}18` }}
              >
                <ThemedText
                  className="text-[9px] font-bold uppercase"
                  style={{ color: confidenceColor[confidence] }}
                >
                  {confidence}
                </ThemedText>
              </View>
            </View>

            {isEditingName ? (
              <TextInput
                value={tempName}
                onChangeText={setTempName}
                autoFocus
                onBlur={saveNameEdit}
                onSubmitEditing={saveNameEdit}
                style={{
                  color: colors.primary,
                  fontSize: 16,
                  fontWeight: '600',
                  padding: 0,
                  margin: 0,
                  marginTop: 2,
                  marginBottom: 2,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.accent,
                }}
              />
            ) : (
              <TouchableOpacity onPress={() => setIsEditingName(true)} activeOpacity={0.7}>
                <ThemedText className="font-semibold text-base">{tx.merchant}</ThemedText>
              </TouchableOpacity>
            )}

            <ThemedText type="secondary" className="text-xs mt-0.5">
              {tx.date ? new Date(tx.date).toLocaleDateString('en-IN', {
                day: 'numeric', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              }) : ''}
            </ThemedText>
          </View>

          {/* Action buttons */}
          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={() => setIsExpanded(!isExpanded)}
              className="w-9 h-9 rounded-full items-center justify-center mr-1"
              style={{ backgroundColor: colors.translucent }}
            >
              <LucideInfo color={isExpanded ? colors.primary : colors.muted} size={15} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onEditPress(tx)}
              className="w-9 h-9 rounded-full items-center justify-center mr-1"
              style={{ backgroundColor: colors.translucent }}
            >
              <LucidePencil color={colors.warning} size={15} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onDelete(tx)}
              className="w-9 h-9 rounded-full items-center justify-center mr-1"
              style={{ backgroundColor: colors.translucent }}
            >
              <LucideTrash2 color={colors.danger} size={15} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onConfirm(tx, accountOverride)}
              className="w-10 h-10 rounded-full items-center justify-center"
              style={{ backgroundColor: colors.accent }}
            >
              <LucideCheck color="#FFFFFF" size={18} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Transaction Type Selector */}
        <View className="flex-row mb-3 bg-black/5 dark:bg-white/5 p-1 rounded-full">
          {[
            { id: 'debit', label: 'Expense', icon: LucideArrowUpRight, color: colors.danger },
            { id: 'credit', label: 'Income', icon: LucideArrowDownLeft, color: colors.success },
            { id: 'transfer', label: 'Transfer', icon: LucideRotateCw, color: colors.warning },
          ].map((type) => {
            const active = tx.type === type.id;
            const Icon = type.icon;
            return (
              <TouchableOpacity
                key={type.id}
                onPress={() => handleTypeChange(type.id as any)}
                className="flex-1 py-1.5 rounded-full flex-row items-center justify-center"
                style={{
                  backgroundColor: active ? colors.surface : 'transparent',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: active ? 0.1 : 0,
                  shadowRadius: 1,
                }}
              >
                <Icon color={active ? type.color : colors.muted} size={13} />
                <ThemedText
                  className="text-[10px] font-bold ml-1.5"
                  style={{ color: active ? colors.primary : colors.secondary }}
                >
                  {type.label}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Row 2: category + account chips */}
        <View className="flex-row flex-wrap mt-2">
          <TouchableOpacity
            onPress={() => {
              setShowCatPicker(!showCatPicker);
              setShowAccPicker(false);
              setShowTagPicker(false);
            }}
            className="flex-row items-center px-3 py-1.5 rounded-full mr-2 mb-2"
            style={{ backgroundColor: `${colors.accent}15` }}
          >
            <ThemedText className="text-[11px] font-bold mr-1" style={{ color: colors.accent }}>
              {tx.category}
            </ThemedText>
            <LucideChevronDown color={colors.accent} size={11} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setShowAccPicker(!showAccPicker);
              setShowCatPicker(false);
              setShowTagPicker(false);
            }}
            className="flex-row items-center px-3 py-1.5 rounded-full mr-2 mb-2"
            style={{ backgroundColor: colors.translucent }}
          >
            <ThemedText type="secondary" className="text-[11px] font-bold mr-1">
              {tx.type === 'transfer' ? 'From: ' : ''}{effectiveAcc?.name ?? 'No account'}
            </ThemedText>
            <LucideChevronDown color={colors.muted} size={11} />
          </TouchableOpacity>

          {tx.type === 'transfer' && (
            <TouchableOpacity
              onPress={() => {
                setShowToAccPicker(!showToAccPicker);
                setShowCatPicker(false);
                setShowAccPicker(false);
                setShowTagPicker(false);
              }}
              className="flex-row items-center px-3 py-1.5 rounded-full mr-2 mb-2"
              style={{ backgroundColor: `${colors.success}15` }}
            >
              <ThemedText className="text-[11px] font-bold mr-1" style={{ color: colors.success }}>
                To: {accounts.find(a => a.id === tx.toAccountId)?.name ?? 'Select…'}
              </ThemedText>
              <LucideChevronDown color={colors.success} size={11} />
            </TouchableOpacity>
          )}

          {(tx.tags || []).map(tag => (
            <View key={tag} className="flex-row items-center px-3 py-1.5 rounded-full mr-2 mb-2" style={{ backgroundColor: `${colors.accent}10`, borderWidth: 1, borderColor: `${colors.accent}30` }}>
              <ThemedText className="text-[11px] font-bold" style={{ color: colors.accent }}>#{tag}</ThemedText>
            </View>
          ))}

          <TouchableOpacity
            onPress={() => {
              setShowTagPicker(!showTagPicker);
              setShowCatPicker(false);
              setShowAccPicker(false);
            }}
            className="flex-row items-center px-3 py-1.5 rounded-full mb-2"
            style={{ backgroundColor: colors.translucent, borderStyle: 'dashed', borderWidth: 1, borderColor: colors.border }}
          >
            <LucidePlus color={colors.secondary} size={11} />
            <ThemedText type="secondary" className="text-[11px] font-bold ml-1">Tag</ThemedText>
          </TouchableOpacity>
        </View>

        {/* Tag picker */}
        {showTagPicker && (
          <MotiView
            from={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mt-3 pt-3 border-t"
            style={{ borderTopColor: colors.border }}
          >
            <ThemedText type="secondary" className="text-[10px] font-bold uppercase tracking-widest mb-2">
              Add Tags
            </ThemedText>
            <TagInput tags={tx.tags || []} onChangeTags={changeTags} placeholder="e.g. vacation" />
          </MotiView>
        )}

        {/* Category picker */}
        {showCatPicker && (
          <MotiView
            from={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mt-3 pt-3 border-t"
            style={{ borderTopColor: colors.border }}
          >
            <View className="flex-row items-center justify-between mb-3">
              <ThemedText type="secondary" className="text-[10px] font-bold uppercase tracking-widest">
                Change Category
              </ThemedText>
            </View>
            
            {/* Tabs */}
            <View className="flex-row mb-3 bg-black/5 dark:bg-white/5 p-1 rounded-full">
              {(['expense', 'income', 'transfer'] as const).map(tab => (
                <TouchableOpacity
                  key={tab}
                  onPress={() => {
                    setCatTab(tab);
                    const newType = tab === 'income' ? 'credit' : tab === 'transfer' ? 'transfer' : 'debit';
                    handleTypeChange(newType);
                  }}
                  className="flex-1 py-1.5 rounded-full items-center"
                  style={{
                    backgroundColor: catTab === tab ? colors.surface : 'transparent',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: catTab === tab ? 0.1 : 0,
                    shadowRadius: 1,
                  }}
                >
                  <ThemedText
                    className="text-[11px] font-bold capitalize"
                    style={{ color: catTab === tab ? colors.primary : colors.secondary }}
                  >
                    {tab}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </View>

            <View className="flex-col">
              {(() => {
                const currentCats = categories.filter(c => c.type === catTab);
                const parents = currentCats.filter(c => !c.parentId);
                const childrenMap = currentCats.reduce((acc, cat) => {
                  if (cat.parentId) {
                    if (!acc[cat.parentId]) acc[cat.parentId] = [];
                    acc[cat.parentId].push(cat);
                  }
                  return acc;
                }, {} as Record<number, typeof currentCats>);

                return parents.map(parent => (
                  <View key={parent.id} className="mb-2">
                    <TouchableOpacity
                      onPress={() => changeCategory(parent.name)}
                      className="px-3 py-1.5 rounded-full flex-row items-center self-start"
                      style={{
                        backgroundColor: tx.category === parent.name ? colors.accent : colors.translucent,
                        borderWidth: 1,
                        borderColor: tx.category === parent.name ? colors.accent : colors.border,
                      }}
                    >
                      {renderCategoryIcon(parent.icon, tx.category === parent.name ? '#FFF' : parent.color, 12)}
                      <ThemedText
                        className="text-[11px] font-bold ml-1.5"
                        style={{ color: tx.category === parent.name ? '#FFF' : colors.secondary }}
                      >
                        {parent.name}
                      </ThemedText>
                    </TouchableOpacity>

                    {childrenMap[parent.id] && childrenMap[parent.id].length > 0 && (
                      <View className="flex-row flex-wrap mt-2 ml-4 pl-3 border-l" style={{ borderLeftColor: colors.border }}>
                        {childrenMap[parent.id].map(child => (
                          <TouchableOpacity
                            key={child.id}
                            onPress={() => changeCategory(child.name)}
                            className="mr-2 mb-2 px-3 py-1.5 rounded-full flex-row items-center"
                            style={{
                              backgroundColor: tx.category === child.name ? colors.accent : colors.translucent,
                              borderWidth: 1,
                              borderColor: tx.category === child.name ? colors.accent : colors.border,
                            }}
                          >
                            {renderCategoryIcon(child.icon, tx.category === child.name ? '#FFF' : child.color, 10)}
                            <ThemedText
                              className="text-[10px] font-medium ml-1.5"
                              style={{ color: tx.category === child.name ? '#FFF' : colors.secondary }}
                            >
                              {child.name}
                            </ThemedText>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                ));
              })()}
            </View>
          </MotiView>
        )}

        {/* Account picker */}
        {showAccPicker && (
          <MotiView
            from={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mt-3 pt-3 border-t"
            style={{ borderTopColor: colors.border }}
          >
            <ThemedText type="secondary" className="text-[10px] font-bold uppercase tracking-widest mb-2">
              {tx.type === 'transfer' ? 'Source Account' : 'Assign Account'}
            </ThemedText>
            <View className="flex-row flex-wrap">
              {accounts.map(acc => {
                const active = (accountOverride ?? tx.accountId) === acc.id;
                return (
                  <TouchableOpacity
                    key={acc.id}
                    onPress={() => {
                      onChangeAccount(tx.id, acc.id);
                      setShowAccPicker(false);
                    }}
                    className="mr-2 mb-2 px-3 py-1.5 rounded-full"
                    style={{
                      backgroundColor: active ? colors.accent : colors.translucent,
                      borderWidth: 1,
                      borderColor: active ? colors.accent : colors.border,
                    }}
                  >
                    <ThemedText
                      className="text-[11px] font-bold"
                      style={{ color: active ? '#FFF' : colors.secondary }}
                    >
                      {acc.name}
                    </ThemedText>
                  </TouchableOpacity>
                );
              })}
            </View>
          </MotiView>
        )}

        {/* To Account picker */}
        {showToAccPicker && (
          <MotiView
            from={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mt-3 pt-3 border-t"
            style={{ borderTopColor: colors.border }}
          >
            <ThemedText type="secondary" className="text-[10px] font-bold uppercase tracking-widest mb-2">
              Destination Account
            </ThemedText>
            <View className="flex-row flex-wrap">
              {accounts.map(acc => {
                const active = tx.toAccountId === acc.id;
                // Don't allow selecting same account for From and To
                const isFrom = (accountOverride ?? tx.accountId) === acc.id;
                
                return (
                  <TouchableOpacity
                    key={acc.id}
                    onPress={() => !isFrom && changeToAccount(acc.id)}
                    disabled={isFrom}
                    className="mr-2 mb-2 px-3 py-1.5 rounded-full"
                    style={{
                      backgroundColor: active ? colors.success : colors.translucent,
                      borderWidth: 1,
                      borderColor: active ? colors.success : colors.border,
                      opacity: isFrom ? 0.3 : 1,
                    }}
                  >
                    <ThemedText
                      className="text-[11px] font-bold"
                      style={{ color: active ? '#FFF' : colors.secondary }}
                    >
                      {acc.name}
                    </ThemedText>
                  </TouchableOpacity>
                );
              })}
            </View>
          </MotiView>
        )}

        {/* Raw SMS */}
        {isExpanded && tx.rawSms && (
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-3 p-3 rounded-lg"
            style={{ backgroundColor: colors.translucent }}
          >
            <ThemedText type="secondary" className="text-xs leading-relaxed">{tx.rawSms}</ThemedText>
          </MotiView>
        )}
      </View>
    </MotiView>
  );
};
