import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView, AnimatePresence } from 'moti';
import {
  LucideCheckCircle2,
  LucideXCircle,
  LucideInfo,
  LucideX,
} from 'lucide-react-native';
import { notify, NotifyMsg } from '../utils/notify';
import { useTheme } from '../theme/ThemeProvider';

const CONFIG = {
  success: { icon: LucideCheckCircle2, color: '#30D158', bg: '#30D15818' },
  error:   { icon: LucideXCircle,      color: '#FF453A', bg: '#FF453A18' },
  info:    { icon: LucideInfo,         color: '#0A84FF', bg: '#0A84FF18' },
};

const AUTO_DISMISS_MS = 2800;

const NotifyItem = ({
  msg,
  onDismiss,
  topOffset,
  index,
}: {
  msg: NotifyMsg;
  onDismiss: () => void;
  topOffset: number;
  index: number;
}) => {
  const { colors, isDark } = useTheme();
  const cfg = CONFIG[msg.type];
  const Icon = cfg.icon;

  useEffect(() => {
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <MotiView
      from={{ opacity: 0, translateY: -16, scale: 0.96 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      exit={{ opacity: 0, translateY: -12, scale: 0.95 }}
      transition={{ type: 'spring', damping: 20, stiffness: 260 }}
      style={[
        styles.pill,
        {
          top: topOffset + index * 56,
          backgroundColor: isDark ? colors.surfaceElevated : '#FFFFFF',
          borderColor: `${cfg.color}35`,
          shadowColor: isDark ? '#000' : '#00000030',
        },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: cfg.bg }]}>
        <Icon color={cfg.color} size={16} />
      </View>
      <View style={styles.textWrap}>
        <Text style={[styles.text, { color: colors.primary }]} numberOfLines={1}>
          {msg.text}
        </Text>
        {msg.text2 ? (
          <Text style={[styles.sub, { color: colors.secondary }]} numberOfLines={1}>
            {msg.text2}
          </Text>
        ) : null}
      </View>
      <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <LucideX color={colors.secondary} size={14} />
      </TouchableOpacity>
    </MotiView>
  );
};

export const Notifier = () => {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<NotifyMsg[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems(prev => prev.filter(m => m.id !== id));
  }, []);

  useEffect(() => {
    return notify._subscribe(msg => {
      setItems(prev => {
        // Keep at most 3 notifications
        const next = [...prev, msg];
        return next.slice(-3);
      });
    });
  }, []);

  if (items.length === 0) return null;

  return (
    <View style={styles.root} pointerEvents="box-none">
      <AnimatePresence>
        {items.map((msg, i) => (
          <NotifyItem
            key={msg.id}
            msg={msg}
            onDismiss={() => dismiss(msg.id)}
            topOffset={insets.top + 8}
            index={i}
          />
        ))}
      </AnimatePresence>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
  },
  pill: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
  },
  sub: {
    fontSize: 11,
    marginTop: 1,
  },
});
