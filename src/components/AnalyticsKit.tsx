import React from 'react';
import { View, Pressable, StyleProp, ViewStyle, GestureResponderEvent } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { MotiView } from 'moti';
import {
  LucideArrowUp,
  LucideArrowDown,
  LucideChevronRight,
  LucideLock,
  LucideSparkles,
} from 'lucide-react-native';
import { ThemedText } from './ThemedSafeAreaView';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, withAlpha, radius } from '../theme/tokens';

// ─── Money helpers (presentation only) ──────────────────────────────────────

const shortMoney = (n: number, currency = '₹', masked = false): string => {
  if (masked) return '••';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 100000) return `${sign}${currency}${(abs / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${sign}${currency}${(abs / 1000).toFixed(1)}k`;
  return `${sign}${currency}${Math.round(abs).toLocaleString('en-IN')}`;
};

// ─── DeltaChip — period-over-period change ("▲ 12% vs last month") ───────────
// For spend, lower is better, so a decrease is coloured as good (credit) and an
// increase as bad (danger). Flip `goodWhenLower` for income-style metrics.

export const DeltaChip: React.FC<{
  current: number;
  previous: number;
  label?: string;
  goodWhenLower?: boolean;
}> = ({ current, previous, label = 'vs last month', goodWhenLower = true }) => {
  const { colors } = useTheme();
  const pct =
    previous > 0
      ? Math.round(((current - previous) / previous) * 100)
      : current > 0
        ? 100
        : 0;
  const isUp = current > previous;
  const flat = pct === 0 || (previous === 0 && current === 0);
  const good = goodWhenLower ? !isUp : isUp;
  const tone = flat ? colors.secondary : good ? colors.credit : colors.danger;
  const Arrow = isUp ? LucideArrowUp : LucideArrowDown;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 99,
        backgroundColor: withAlpha(tone, '1f'),
      }}
    >
      {!flat && <Arrow color={tone} size={11} strokeWidth={2.6} />}
      <ThemedText
        font="signal"
        style={{ fontSize: 10, fontWeight: '700', color: tone }}
      >
        {flat ? '—' : `${Math.abs(pct)}%`}
      </ThemedText>
      <ThemedText font="signal" style={{ fontSize: 9, color: colors.secondary }}>
        {label}
      </ThemedText>
    </View>
  );
};

// ─── SavingsMeter — net / income as a rate, with a horizontal fill ───────────

export const SavingsMeter: React.FC<{
  income: number;
  expense: number;
  currency?: string;
  masked?: boolean;
}> = ({ income, expense, currency = '₹', masked = false }) => {
  const { colors } = useTheme();
  const net = income - expense;
  const rate = income > 0 ? Math.round((net / income) * 100) : 0;
  const positive = net >= 0;
  const tone = positive ? colors.credit : colors.danger;
  const fillPct = Math.min(Math.max(rate, 0), 100);

  return (
    <View
      style={{
        padding: 16,
        borderRadius: 16,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <View>
          <ThemedText
            font="signal"
            style={{
              fontSize: 9,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
              color: colors.secondary,
            }}
          >
            Savings rate · month
          </ThemedText>
          <ThemedText
            style={{
              fontFamily: fonts.signalBold,
              fontSize: 26,
              color: tone,
              marginTop: 2,
              fontVariant: ['tabular-nums'],
            }}
          >
            {income > 0 ? `${rate}%` : '—'}
          </ThemedText>
        </View>
        <ThemedText
          font="signal"
          style={{ fontSize: 10, color: colors.secondary, marginBottom: 4 }}
        >
          {positive ? 'saved ' : 'over by '}
          {shortMoney(Math.abs(net), currency, masked)}
        </ThemedText>
      </View>
      <View
        style={{
          height: 8,
          borderRadius: 4,
          backgroundColor: colors.surfaceElevated,
          overflow: 'hidden',
        }}
      >
        <MotiView
          from={{ width: '0%' }}
          animate={{ width: `${fillPct}%` }}
          transition={{ type: 'timing', duration: 700 }}
          style={{ height: '100%', borderRadius: 4, backgroundColor: tone }}
        />
      </View>
    </View>
  );
};

// ─── WeekdayBars — average spend per weekday, heaviest highlighted ───────────
// Input is the raw SQL shape (weekday 0=Sun…6=Sat). We reorder to Mon-first and
// use per-occurrence average so an uneven window doesn't bias a weekday.

export const WeekdayBars: React.FC<{
  data: { weekday: number; total: number; count: number }[];
  currency?: string;
  masked?: boolean;
}> = ({ data, currency = '₹', masked = false }) => {
  const { colors } = useTheme();
  const order = [1, 2, 3, 4, 5, 6, 0]; // Mon → Sun
  const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const byDay = new Map(data.map((d) => [d.weekday, d]));

  const bars = order.map((wd, i) => {
    const d = byDay.get(wd);
    const avg = d && d.count > 0 ? d.total / d.count : 0;
    return { avg, letter: letters[i], weekday: wd };
  });
  const max = Math.max(...bars.map((b) => b.avg), 1);
  const heaviestIdx = bars.reduce(
    (best, b, i) => (b.avg > bars[best].avg ? i : best),
    0,
  );
  const fullNames = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
  ];
  const anySpend = bars.some((b) => b.avg > 0);

  return (
    <View
      style={{
        padding: 16,
        borderRadius: radius.md,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 20,
        }}
      >
        <ThemedText
          font="signal"
          style={{
            fontSize: 9,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
            color: colors.secondary,
          }}
        >
          Weekly rhythm
        </ThemedText>
        {anySpend && (
          <ThemedText style={{ fontSize: 12, color: colors.primary }}>
            Heaviest ·{' '}
            <ThemedText style={{ fontFamily: fonts.textSemibold, color: colors.debit }}>
              {fullNames[bars[heaviestIdx].weekday]}
            </ThemedText>
          </ThemedText>
        )}
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          height: 96,
          gap: 8,
        }}
      >
        {bars.map((b, i) => {
          const isMax = i === heaviestIdx && b.avg > 0;
          const h = Math.max(4, (b.avg / max) * 64);
          return (
            <View key={i} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
              {isMax && (
                <ThemedText
                  font="signal"
                  style={{ fontSize: 8, color: colors.debit }}
                  numberOfLines={1}
                >
                  {shortMoney(b.avg, currency, masked)}
                </ThemedText>
              )}
              <MotiView
                from={{ height: 4 }}
                animate={{ height: h }}
                transition={{ type: 'timing', duration: 500, delay: i * 40 }}
                style={{
                  width: '100%',
                  borderRadius: 5,
                  backgroundColor: isMax ? colors.debit : withAlpha(colors.debit, '40'),
                }}
              />
              <ThemedText
                font="signal"
                style={{
                  fontSize: 9,
                  color: isMax ? colors.primary : colors.secondary,
                }}
              >
                {b.letter}
              </ThemedText>
            </View>
          );
        })}
      </View>
    </View>
  );
};

// ─── TopMerchants — ranked horizontal bars, tappable to drill down ───────────

export const TopMerchants: React.FC<{
  data: { merchant: string; total: number; count: number }[];
  currency?: string;
  masked?: boolean;
  onPressMerchant?: (merchant: string) => void;
}> = ({ data, currency = '₹', masked = false, onPressMerchant }) => {
  const { colors } = useTheme();
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.total), 1);

  return (
    <View
      style={{
        borderRadius: radius.md,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
      }}
    >
      {data.map((m, i) => (
        <Pressable
          key={m.merchant}
          onPress={() => onPressMerchant?.(m.merchant)}
          className="px-4 py-4"
          style={({ pressed }) => ({
            borderTopWidth: i > 0 ? 1 : 0,
            borderTopColor: colors.border,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 7,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              <ThemedText
                font="signal"
                style={{ fontSize: 10, color: colors.muted, width: 14 }}
              >
                {i + 1}
              </ThemedText>
              <ThemedText
                style={{ fontFamily: fonts.textSemibold, fontSize: 14, flexShrink: 1 }}
                numberOfLines={1}
              >
                {m.merchant}
              </ThemedText>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <ThemedText
                font="signal"
                style={{ fontSize: 13, fontWeight: '700', color: colors.primary }}
              >
                {shortMoney(m.total, currency, masked)}
              </ThemedText>
              <LucideChevronRight color={colors.muted} size={13} />
            </View>
          </View>
          <View
            style={{
              height: 5,
              borderRadius: 3,
              backgroundColor: colors.surfaceElevated,
              overflow: 'hidden',
            }}
          >
            <MotiView
              from={{ width: '0%' }}
              animate={{ width: `${(m.total / max) * 100}%` }}
              transition={{ type: 'timing', duration: 600, delay: i * 50 }}
              style={{ height: '100%', borderRadius: 3, backgroundColor: colors.debit }}
            />
          </View>
        </Pressable>
      ))}
    </View>
  );
};

// ─── CalendarHeatmap — GitHub-style month grid, tap a day to inspect it ──────

export const CalendarHeatmap: React.FC<{
  data: { date: string; total: number }[];
  innerWidth: number;
  selectedDate?: string | null;
  onDayPress?: (date: string, event: GestureResponderEvent) => void;
}> = ({ data, innerWidth, selectedDate, onDayPress }) => {
  const { colors } = useTheme();
  const gap = 5;
  const cell = Math.floor((innerWidth - gap * 6) / 7);
  const max = Math.max(...data.map((d) => d.total), 1);

  // Mon-first column index for the first date, to left-pad the grid.
  const leadBlanks =
    data.length > 0 ? (new Date(data[0].date).getDay() + 6) % 7 : 0;
  const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  return (
    <View>
      <View style={{ flexDirection: 'row', marginBottom: 6, gap }}>
        {letters.map((l, i) => (
          <ThemedText
            key={i}
            font="signal"
            style={{ width: cell, textAlign: 'center', fontSize: 8, color: colors.secondary }}
          >
            {l}
          </ThemedText>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
        {Array.from({ length: leadBlanks }).map((_, i) => (
          <View key={`b-${i}`} style={{ width: cell, height: cell }} />
        ))}
        {data.map((d) => {
          const intensity = d.total / max;
          const selected = selectedDate === d.date;
          const spent = d.total > 0;
          return (
            <Pressable
              key={d.date}
              onPress={(e) => onDayPress?.(selected ? '' : d.date, e)}
              style={{
                width: cell,
                height: cell,
                borderRadius: 6,
                backgroundColor: spent ? colors.debit : colors.surfaceElevated,
                opacity: spent ? 0.28 + intensity * 0.72 : 1,
                borderWidth: selected ? 2 : 0,
                borderColor: colors.primary,
              }}
            />
          );
        })}
      </View>
    </View>
  );
};

// ─── InteractiveDonut — tappable category ring with a selection state ────────

const polarPoint = (cx: number, cy: number, r: number, angleDeg: number) => {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
};

const arcPath = (
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
) => {
  const start = polarPoint(cx, cy, r, endAngle);
  const end = polarPoint(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
};

export interface DonutSegment {
  value: number;
  color: string;
  label: string;
}

export const InteractiveDonut: React.FC<{
  segments: DonutSegment[];
  size?: number;
  strokeWidth?: number;
  centerTitle: string;
  centerValue: string;
  selectedLabel?: string | null;
  onSelect?: (label: string | null) => void;
}> = ({
  segments,
  size = 168,
  strokeWidth = 22,
  centerTitle,
  centerValue,
  selectedLabel,
  onSelect,
}) => {
  const { colors } = useTheme();
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  const r = (size - strokeWidth - 6) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const gapDeg = segments.length > 1 ? 3 : 0;

  let cursor = 0;
  const paths = segments.map((seg, i) => {
    const sweep = (seg.value / total) * (360 - gapDeg * segments.length);
    const selected = selectedLabel === seg.label;
    const dim = selectedLabel != null && !selected;
    const d = arcPath(cx, cy, r, cursor, cursor + Math.max(sweep, 1));
    cursor += sweep + gapDeg;
    return (
      <Path
        key={seg.label + i}
        d={d}
        stroke={seg.color}
        strokeWidth={selected ? strokeWidth + 4 : strokeWidth}
        strokeLinecap="round"
        strokeOpacity={dim ? 0.28 : 1}
        fill="none"
        onPress={() => onSelect?.(selected ? null : seg.label)}
      />
    );
  });

  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={colors.secondary}
          strokeOpacity={0.12}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {paths}
      </Svg>
      <Pressable
        onPress={() => onSelect?.(null)}
        style={{ position: 'absolute', alignItems: 'center', width: size * 0.5 }}
      >
        <ThemedText
          font="signal"
          style={{
            fontSize: 9,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
            color: colors.secondary,
            textAlign: 'center',
          }}
          numberOfLines={1}
        >
          {centerTitle}
        </ThemedText>
        <ThemedText
          style={{
            fontFamily: fonts.signalBold,
            fontSize: 19,
            color: colors.primary,
            fontVariant: ['tabular-nums'],
            marginTop: 2,
          }}
          numberOfLines={1}
        >
          {centerValue}
        </ThemedText>
      </Pressable>
    </View>
  );
};

// ─── PremiumGate — monetization seam ─────────────────────────────────────────
// Renders children normally when unlocked. When locked, dims them and overlays a
// lock card. Advanced Analytics sections are wrapped in this so a future
// subscription flow only has to flip `premium` to false to gate them.

export const PremiumGate: React.FC<{
  premium: boolean;
  title?: string;
  onUnlock?: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}> = ({ premium, title = 'Premium insight', onUnlock, children, style }) => {
  const { colors } = useTheme();
  if (premium) return <>{children}</>;

  return (
    <View style={style}>
      <View style={{ opacity: 0.35 }} pointerEvents="none">
        {children}
      </View>
      <View
        style={{
          ...StyleSheetAbsoluteFill,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Pressable
          onPress={onUnlock}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderRadius: 99,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: withAlpha(colors.accent, '55'),
          }}
        >
          <LucideLock color={colors.accent} size={15} />
          <ThemedText style={{ fontFamily: fonts.textSemibold, fontSize: 13, color: colors.primary }}>
            {title}
          </ThemedText>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 3,
              paddingHorizontal: 7,
              paddingVertical: 2,
              borderRadius: 99,
              backgroundColor: withAlpha(colors.accent, '22'),
            }}
          >
            <LucideSparkles color={colors.accent} size={10} />
            <ThemedText font="signal" style={{ fontSize: 9, fontWeight: '700', color: colors.accent }}>
              PRO
            </ThemedText>
          </View>
        </Pressable>
      </View>
    </View>
  );
};

const StyleSheetAbsoluteFill = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};
