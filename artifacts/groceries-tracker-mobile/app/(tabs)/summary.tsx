import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useGroceries } from '@/context/GroceryContext';

export default function SummaryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { receipts, totalSpent, itemCount } = useGroceries();
  const topInset = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;
  const categories = receipts.flatMap((receipt) => receipt.items).reduce<Record<string, number>>((totals, item) => {
    totals[item.category] = (totals[item.category] ?? 0) + item.price;
    return totals;
  }, {});
  const categoryRows = Object.entries(categories).sort(([, a], [, b]) => b - a);

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.background }]} contentContainerStyle={{ paddingTop: topInset + 18, paddingBottom: insets.bottom + 30 }}>
      <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>A CLEARER MONTH</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>Summary</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>August 2026 · built from recognized items</Text>
      <View style={styles.statGrid}><View style={[styles.bigStat, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.statLabel, { color: colors.mutedForeground }]}>TOTAL SPENT</Text><Text style={[styles.bigValue, { color: colors.foreground }]}>${totalSpent.toFixed(2)}</Text></View><View style={[styles.bigStat, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.statLabel, { color: colors.mutedForeground }]}>ITEMS</Text><Text style={[styles.bigValue, { color: colors.foreground }]}>{itemCount}</Text></View></View>
      <View style={styles.sectionHead}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Category breakdown</Text><Text style={[styles.sectionMeta, { color: colors.mutedForeground }]}>{categoryRows.length} categories</Text></View>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {categoryRows.length === 0 ? <View style={styles.empty}><View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}><Feather name="pie-chart" size={18} color={colors.mutedForeground} /></View><Text style={[styles.emptyTitle, { color: colors.foreground }]}>No categories yet</Text><Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>Scan a receipt to see where your grocery money goes.</Text></View> : categoryRows.map(([category, value]) => <View key={category} style={styles.categoryRow}><View style={styles.categoryInfo}><View style={[styles.categoryDot, { backgroundColor: colors.primary }]} /><Text style={[styles.categoryName, { color: colors.foreground }]}>{category}</Text></View><View style={styles.categoryAmount}><Text style={[styles.amount, { color: colors.foreground }]}>${value.toFixed(2)}</Text><View style={[styles.track, { backgroundColor: colors.muted }]}><View style={[styles.fill, { backgroundColor: colors.primary, width: `${Math.min((value / Math.max(totalSpent, 1)) * 100, 100)}%` }]} /></View></View></View>)}
      </View>
      <View style={styles.sectionHead}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recognized items</Text><Text style={[styles.sectionMeta, { color: colors.mutedForeground }]}>{itemCount} total</Text></View>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {receipts.flatMap((receipt) => receipt.items).slice(0, 8).map((item, index) => <View key={`${item.name}-${index}`} style={[styles.itemRow, { borderBottomColor: colors.border }]}><Text style={[styles.itemName, { color: colors.foreground }]}>{item.name}</Text><Text style={[styles.itemCategory, { color: colors.mutedForeground }]}>{item.category}</Text><Text style={[styles.itemPrice, { color: colors.foreground }]}>${item.price.toFixed(2)}</Text></View>)}
        {itemCount === 0 && <Text style={[styles.emptyList, { color: colors.mutedForeground }]}>Recognized items will appear here after your first scan.</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 18 },
  eyebrow: { fontSize: 9, fontWeight: '700', letterSpacing: 1.3, marginBottom: 5 },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -1 },
  subtitle: { fontSize: 13, marginTop: 4, marginBottom: 22 },
  statGrid: { flexDirection: 'row', gap: 12, marginBottom: 28 },
  bigStat: { flex: 1, borderWidth: 1, borderRadius: 16, padding: 16 },
  statLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  bigValue: { fontSize: 26, fontWeight: '700', marginTop: 10, letterSpacing: -0.8 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 11 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  sectionMeta: { fontSize: 11 },
  card: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 15, marginBottom: 25 },
  empty: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: 20 },
  emptyIcon: { width: 45, height: 45, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 11 },
  emptyTitle: { fontSize: 15, fontWeight: '700' },
  emptyBody: { textAlign: 'center', fontSize: 12, lineHeight: 18, marginTop: 5 },
  categoryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  categoryInfo: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  categoryDot: { width: 8, height: 8, borderRadius: 4 },
  categoryName: { fontSize: 13, fontWeight: '600' },
  categoryAmount: { alignItems: 'flex-end', width: 112 },
  amount: { fontSize: 12, fontWeight: '700' },
  track: { width: 112, height: 5, borderRadius: 3, marginTop: 6, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, gap: 7 },
  itemName: { flex: 1, fontSize: 12, fontWeight: '600' },
  itemCategory: { fontSize: 10 },
  itemPrice: { fontSize: 12, fontWeight: '700', width: 52, textAlign: 'right' },
  emptyList: { fontSize: 12, lineHeight: 18, paddingVertical: 20 },
});