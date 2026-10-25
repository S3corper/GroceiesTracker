import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useGroceries } from '@/context/GroceryContext';
import { router } from 'expo-router';

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { receipts, totalSpent, itemCount, activeSpace } = useGroceries();
  const topInset = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;
  const currentMonthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: activeSpace?.timezone ?? 'America/New_York' }).format(new Date());

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.background }]} contentContainerStyle={{ paddingTop: topInset + 18, paddingBottom: insets.bottom + 30 }}>
      <View style={styles.header}>
        <View>
          <View style={styles.brandLine}><View style={[styles.brandMark, { borderColor: colors.primary }]}><Text style={[styles.brandLetter, { color: colors.primary }]}>G</Text></View><Text style={[styles.brand, { color: colors.foreground }]}>GroceriesTracker</Text></View>
          <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>PERSONAL WORKSPACE</Text>
        </View>
        <Pressable style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]} onPress={() => router.push('/(tabs)/receipts')} testID="button-dashboard-camera">
          <Feather name="camera" size={18} color={colors.foreground} />
        </Pressable>
      </View>
      <View style={styles.titleRow}><View style={styles.titleCopy}><Text style={[styles.title, { color: colors.foreground }]}>Dashboard</Text><Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{currentMonthLabel} spending at a glance</Text></View><View style={[styles.monthPill, { backgroundColor: colors.card }]}><Text style={[styles.monthText, { color: colors.foreground }]}>{currentMonthLabel}</Text><Feather name="chevron-down" size={14} color={colors.mutedForeground} /></View></View>
      <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.heroIcon, { backgroundColor: colors.accent }]}><Feather name="target" size={20} color={colors.primary} /></View>
        <View style={{ flex: 1 }}><Text style={[styles.cardTitle, { color: colors.foreground }]}>Keep your grocery spending visible.</Text><Text style={[styles.cardBody, { color: colors.mutedForeground }]}>Capture a receipt and we’ll turn it into a clear monthly summary.</Text></View>
      </View>
      <View style={styles.statGrid}>
        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.statLabel, { color: colors.mutedForeground }]}>MONTHLY SPEND</Text><Text style={[styles.statValue, { color: colors.foreground }]}>${totalSpent.toFixed(2)}</Text><Text style={[styles.statHint, { color: colors.mutedForeground }]}>{receipts.length} receipt{receipts.length === 1 ? '' : 's'}</Text></View>
        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.statLabel, { color: colors.mutedForeground }]}>ITEMS FOUND</Text><Text style={[styles.statValue, { color: colors.foreground }]}>{itemCount}</Text><Text style={[styles.statHint, { color: colors.mutedForeground }]}>from your scans</Text></View>
      </View>
      <View style={styles.sectionHead}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent receipts</Text><Pressable onPress={() => router.push('/(tabs)/receipts')}><Text style={[styles.link, { color: colors.primary }]}>View all</Text></Pressable></View>
      <View style={[styles.receiptCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {receipts.length === 0 ? <View style={styles.empty}><View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}><Feather name="file-text" size={19} color={colors.mutedForeground} /></View><Text style={[styles.emptyTitle, { color: colors.foreground }]}>No receipts yet</Text><Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>Your scanned receipts and recognized items will appear here.</Text><Pressable style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 }]} onPress={() => router.push('/(tabs)/receipts')}><Feather name="camera" size={16} color={colors.primaryForeground} /><Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Scan your first receipt</Text></Pressable></View> : receipts.slice(0, 3).map((receipt) => <View key={receipt.id} style={[styles.receiptRow, { borderBottomColor: colors.border }]}><View><Text style={[styles.receiptMerchant, { color: colors.foreground }]}>{receipt.merchant || 'Grocery receipt'}</Text><Text style={[styles.receiptDate, { color: colors.mutedForeground }]}>{receipt.date || 'August 2026'}</Text></View><Text style={[styles.receiptTotal, { color: colors.foreground }]}>${receipt.total.toFixed(2)}</Text></View>)}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 18 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 },
  brandLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandMark: { width: 25, height: 25, borderWidth: 1.5, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  brandLetter: { fontSize: 14, fontWeight: '700' },
  brand: { fontSize: 15, fontWeight: '700', letterSpacing: -0.4 },
  eyebrow: { marginTop: 6, fontSize: 9, letterSpacing: 1.2, fontWeight: '600' },
  iconButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 18 },
  titleCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 27, fontWeight: '700', letterSpacing: -1 },
  subtitle: { fontSize: 13, marginTop: 4 },
  monthPill: { minHeight: 40, maxWidth: '100%', flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  monthText: { flexShrink: 1, fontSize: 12, fontWeight: '600' },
  heroCard: { flexDirection: 'row', alignItems: 'center', gap: 13, borderWidth: 1, borderRadius: 16, padding: 17, marginBottom: 14 },
  heroIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700' },
  cardBody: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  statGrid: { flexDirection: 'row', gap: 12, marginBottom: 28 },
  statCard: { flex: 1, borderWidth: 1, borderRadius: 16, padding: 15 },
  statLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  statValue: { marginTop: 10, fontSize: 26, fontWeight: '700', letterSpacing: -0.8 },
  statHint: { marginTop: 4, fontSize: 11 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  link: { fontSize: 12, fontWeight: '600' },
  receiptCard: { borderWidth: 1, borderRadius: 16, padding: 15 },
  empty: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 18 },
  emptyIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { fontSize: 15, fontWeight: '700' },
  emptyBody: { textAlign: 'center', fontSize: 12, lineHeight: 18, marginTop: 5, marginBottom: 17 },
  primaryButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 15, paddingVertical: 11, borderRadius: 22 },
  primaryButtonText: { fontSize: 12, fontWeight: '700' },
  receiptRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1 },
  receiptMerchant: { fontSize: 13, fontWeight: '700' },
  receiptDate: { fontSize: 11, marginTop: 3 },
  receiptTotal: { fontSize: 14, fontWeight: '700' },
});
