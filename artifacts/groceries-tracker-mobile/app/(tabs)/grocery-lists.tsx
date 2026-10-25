import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useState } from 'react';
import { useColors } from '@/hooks/useColors';

export default function GroceryListsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [item, setItem] = useState('');
  const [items, setItems] = useState<string[]>([]);
  const topInset = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;
  const addItem = () => {
    if (!item.trim()) return;
    setItems((current) => [...current, item.trim()]);
    setItem('');
  };

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.background }]} contentContainerStyle={{ paddingTop: topInset + 18, paddingBottom: insets.bottom + 30 }}>
      <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>PLAN THE NEXT SHOP</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>Grocery Lists</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Keep the next trip simple and focused.</Text>
      <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.listHead}><View style={[styles.listIcon, { backgroundColor: colors.accent }]}><Feather name="shopping-cart" size={19} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={[styles.listName, { color: colors.foreground }]}>Next grocery trip</Text><Text style={[styles.listMeta, { color: colors.mutedForeground }]}>{items.length} item{items.length === 1 ? '' : 's'}</Text></View><Feather name="more-horizontal" size={18} color={colors.mutedForeground} /></View>
        <View style={styles.addRow}><TextInput value={item} onChangeText={setItem} onSubmitEditing={addItem} placeholder="Add an item" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, backgroundColor: colors.secondary, borderColor: colors.border }]} returnKeyType="done" testID="input-grocery-item" /><Pressable style={({ pressed }) => [styles.addButton, { backgroundColor: colors.primary, opacity: pressed ? 0.78 : 1 }]} onPress={addItem} testID="button-add-grocery-item"><Feather name="plus" size={18} color={colors.primaryForeground} /></Pressable></View>
        {items.length === 0 ? <View style={styles.empty}><Feather name="check-square" size={27} color={colors.mutedForeground} /><Text style={[styles.emptyTitle, { color: colors.foreground }]}>No items yet</Text><Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>Start a list for the next shop.</Text></View> : items.map((name, index) => <View key={`${name}-${index}`} style={[styles.itemRow, { borderBottomColor: colors.border }]}><Feather name="circle" size={18} color={colors.mutedForeground} /><Text style={[styles.itemText, { color: colors.foreground }]}>{name}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Delete ${name}`} hitSlop={6} style={styles.deleteButton} onPress={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Feather name="x" size={17} color={colors.mutedForeground} /></Pressable></View>)}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 18 },
  eyebrow: { fontSize: 9, fontWeight: '700', letterSpacing: 1.3, marginBottom: 5 },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -1 },
  subtitle: { fontSize: 13, marginTop: 4, marginBottom: 22 },
  listCard: { borderWidth: 1, borderRadius: 18, padding: 16 },
  listHead: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 17 },
  listIcon: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  listName: { fontSize: 15, fontWeight: '700' },
  listMeta: { fontSize: 11, marginTop: 3 },
  addRow: { flexDirection: 'row', gap: 8, marginBottom: 5 },
  input: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 13 },
  addButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: 36 },
  emptyTitle: { fontSize: 15, fontWeight: '700', marginTop: 10 },
  emptyBody: { fontSize: 12, marginTop: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1 },
  itemText: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  deleteButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
