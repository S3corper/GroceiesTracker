import { scanReceipt } from '@workspace/api-client-react';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useEffect, useState } from 'react';
import { useColors } from '@/hooks/useColors';
import { useGroceries, type GroceryReceipt } from '@/context/GroceryContext';

function todayForTimezone(timezone: string) {
  const values = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).reduce<Record<string, string>>((out, part) => ({ ...out, [part.type]: part.value }), {});
  return `${values.year}-${values.month}-${values.day}`;
}

export default function ReceiptsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { receipts, addReceipt, updateReceiptDate, pendingDrafts, saveDraft, updateDraft, removeDraft, activeSpace } = useGroceries();
  const timezone = activeSpace?.timezone ?? 'America/New_York';
  const [isScanning, setIsScanning] = useState(false);
  const [scanProvider, setScanProvider] = useState<'local' | 'gemini'>('local');
  const [draft, setDraft] = useState<GroceryReceipt | null>(null);
  const [dateEdits, setDateEdits] = useState<Record<string, { date: string; time: string }>>({});
  useEffect(() => { if (!draft && pendingDrafts[0]) setDraft(pendingDrafts[0]); }, [draft, pendingDrafts]);
  useEffect(() => { if (draft) updateDraft(draft); }, [draft]);
  const topInset = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;

  async function recognizeAsset(asset: ImagePicker.ImagePickerAsset) {
    if (!asset.base64) {
      Alert.alert('Photo could not be read', 'Please try taking the photo again.');
      return;
    }
    setIsScanning(true);
    try {
      const mimeType = asset.mimeType === 'image/png' ? 'image/png' : asset.mimeType === 'image/webp' ? 'image/webp' : 'image/jpeg';
      let geminiApiKey: string | null = null;
      if (scanProvider === 'gemini') {
        geminiApiKey = await AsyncStorage.getItem('@groceries-tracker/gemini-api-key');
        if (!geminiApiKey) {
          Alert.alert('Gemini key needed', 'Add your Gemini API key in Connect devices settings first.');
          return;
        }
        const confirmed = Platform.OS === 'web'
          ? window.confirm('Gemini sends this receipt photo to Google for recognition. Continue?')
          : await new Promise<boolean>((resolve) => Alert.alert('Send receipt to Gemini?', 'This receipt photo will be sent to Google for recognition.', [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, { text: 'Continue', onPress: () => resolve(true) }]));
        if (!confirmed) return;
      }
      const result = await scanReceipt({ imageBase64: asset.base64, mimeType, provider: scanProvider, ...(geminiApiKey ? { geminiApiKey } : {}) });
      const receipt: Omit<GroceryReceipt, 'id'> = { ...result, imageUri: asset.uri, imageBase64: asset.base64, imageMimeType: mimeType, date: result.date || todayForTimezone(timezone), purchaseTime: result.purchaseTime ?? null, timezone: result.purchaseTime ? timezone : null };
      setDraft({ ...receipt, id: saveDraft(receipt) });
      Alert.alert('Review the receipt', `${result.items.length} items are ready for review before saving.`);
    } catch (error) {
      const offlineDraft: Omit<GroceryReceipt, 'id'> = { merchant: '', date: todayForTimezone(timezone), total: 0, items: [], imageUri: asset.uri, imageBase64: asset.base64, imageMimeType: asset.mimeType === 'image/png' ? 'image/png' : asset.mimeType === 'image/webp' ? 'image/webp' : 'image/jpeg', purchaseTime: null, timezone };
      setDraft({ ...offlineDraft, id: saveDraft(offlineDraft) });
      const status = error && typeof error === 'object' && 'status' in error ? Number((error as { status: unknown }).status) : undefined;
      const message = status === 503 || status === 429
        ? 'Gemini is temporarily busy. The photo is kept in a review draft; try Gemini again shortly or select Offline OCR.'
        : status === undefined
          ? 'The household host could not be reached. The photo is kept in a review draft until you reconnect.'
          : 'The photo is kept in a review draft. Check the recognition settings and try again.';
      Alert.alert('Could not recognize receipt', message);
    } finally {
      setIsScanning(false);
    }
  }

  async function captureReceipt() {
    if (Platform.OS === 'web') {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.8 });
      if (!result.canceled && result.assets[0]) await recognizeAsset(result.assets[0]);
      return;
    }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera access needed', 'Allow camera access to capture a grocery receipt.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) await recognizeAsset(result.assets[0]);
  }

  async function chooseFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) await recognizeAsset(result.assets[0]);
  }

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.background }]} contentContainerStyle={{ paddingTop: topInset + 18, paddingBottom: insets.bottom + 30 }}>
      <View style={styles.header}><View><Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>YOUR MONTH</Text><Text style={[styles.title, { color: colors.foreground }]}>Receipts</Text><Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Capture once. We’ll sort the details.</Text></View><View style={[styles.countPill, { backgroundColor: colors.card }]}><Text style={[styles.count, { color: colors.foreground }]}>{receipts.length}</Text><Text style={[styles.countLabel, { color: colors.mutedForeground }]}>saved</Text></View></View>
      <View style={[styles.scanCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.cameraCircle, { backgroundColor: colors.accent }]}><Feather name="camera" size={26} color={colors.primary} /></View>
        <Text style={[styles.scanTitle, { color: colors.foreground }]}>Scan a receipt</Text>
        <Text style={[styles.scanBody, { color: colors.mutedForeground }]}>Take a photo of the full receipt and recognition will pull the items into Summary automatically.</Text>
        <View style={styles.providerRow}><Pressable onPress={() => setScanProvider('local')} style={[styles.providerChip, { backgroundColor: scanProvider === 'local' ? colors.primary : colors.secondary }]}><Text style={{ color: scanProvider === 'local' ? colors.primaryForeground : colors.foreground, fontSize: 11, fontWeight: '700' }}>Offline OCR</Text></Pressable><Pressable onPress={() => setScanProvider('gemini')} style={[styles.providerChip, { backgroundColor: scanProvider === 'gemini' ? colors.primary : colors.secondary }]}><Text style={{ color: scanProvider === 'gemini' ? colors.primaryForeground : colors.foreground, fontSize: 11, fontWeight: '700' }}>Gemini</Text></Pressable></View>
        <Text style={[styles.scanBody, { color: colors.mutedForeground, marginTop: -8 }]}>{scanProvider === 'local' ? 'Runs on your household server without sending photos to Google.' : 'Uses your saved Gemini key. The photo is sent to Google after confirmation.'}</Text>
        <Pressable style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary, opacity: pressed || isScanning ? 0.75 : 1 }]} onPress={captureReceipt} disabled={isScanning} testID="button-capture-receipt">
          {isScanning ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="camera" size={16} color={colors.primaryForeground} />}
          <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>{isScanning ? 'Recognizing…' : 'Use camera'}</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.secondaryButton, { backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 }]} onPress={chooseFromLibrary} disabled={isScanning} testID="button-choose-receipt"><Feather name="image" size={15} color={colors.foreground} /><Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Choose from photos</Text></Pressable>
      </View>
      {draft && <View style={[styles.reviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Review before saving</Text>
        <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Store</Text><TextInput value={draft.merchant} onChangeText={(merchant) => setDraft({ ...draft, merchant })} style={[styles.reviewInput, { color: colors.foreground, borderColor: colors.border }]} />
        <View style={styles.reviewPair}><View style={{ flex: 1 }}><Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Purchase date</Text><TextInput value={draft.date} onChangeText={(date) => setDraft({ ...draft, date })} placeholder="YYYY-MM-DD" style={[styles.reviewInput, { color: colors.foreground, borderColor: colors.border }]} /></View><View style={{ flex: 1 }}><Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Time optional</Text><TextInput value={draft.purchaseTime ?? ''} onChangeText={(purchaseTime) => setDraft({ ...draft, purchaseTime: purchaseTime || null })} placeholder="HH:mm" style={[styles.reviewInput, { color: colors.foreground, borderColor: colors.border }]} /></View></View>
        <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Receipt total</Text><TextInput value={String(draft.total)} keyboardType="decimal-pad" onChangeText={(value) => setDraft({ ...draft, total: Number(value) || 0 })} style={[styles.reviewInput, { color: colors.foreground, borderColor: colors.border }]} />
        <Text style={[styles.fieldLabel, { color: colors.mutedForeground, marginTop: 8 }]}>Items · name, variant/count, line price</Text>
        {draft.items.map((item, index) => {
          const updateItem = (patch: Partial<typeof item>) => setDraft((current) => current && ({ ...current, items: current.items.map((entry, i) => i === index ? { ...entry, ...patch } : entry) }));
          const inputStyle = [styles.reviewItemInput, { color: colors.foreground, borderColor: colors.border }];
          return <View key={`${item.name}-${index}`} style={[styles.reviewItemCard, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <Text style={[styles.reviewItemNumber, { color: colors.mutedForeground }]}>ITEM {index + 1}</Text>
            <View style={[styles.reviewField, styles.reviewNameField]}><Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Grocery name</Text><TextInput value={item.name} onChangeText={(name) => updateItem({ name })} style={[inputStyle, styles.reviewNameInput]} /></View>
            <View style={styles.reviewFieldsGrid}>
              <View style={styles.reviewField}><Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Variant / pack</Text><TextInput value={item.variant ?? ''} placeholder="e.g. large brown" onChangeText={(variant) => updateItem({ variant })} style={inputStyle} /></View>
              <View style={styles.reviewField}><Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Measured amount</Text><TextInput value={String(item.measureAmount ?? '')} keyboardType="decimal-pad" placeholder="Optional" onChangeText={(value) => updateItem({ measureAmount: Number(value) || undefined })} style={inputStyle} /></View>
              <View style={styles.reviewField}><Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Unit</Text><TextInput value={item.measureUnit ?? ''} placeholder="lb, oz, each" onChangeText={(measureUnit) => updateItem({ measureUnit })} style={inputStyle} /></View>
              <View style={styles.reviewField}><Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Quantity</Text><TextInput value={String(item.quantity)} keyboardType="number-pad" placeholder="1" onChangeText={(value) => updateItem({ quantity: Number(value) || 1 })} style={inputStyle} /></View>
              <View style={styles.reviewField}><Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Units per pack</Text><TextInput value={String(item.packCount ?? '')} keyboardType="number-pad" placeholder="Optional" onChangeText={(value) => updateItem({ packCount: Number(value) || undefined })} style={inputStyle} /></View>
              <View style={styles.reviewField}><Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Line price ($)</Text><TextInput value={String(item.price)} keyboardType="decimal-pad" onChangeText={(value) => updateItem({ price: Number(value) || 0 })} style={inputStyle} /></View>
            </View>
          </View>;
        })}
        <Pressable onPress={async () => { try { const { id, ...receipt } = draft; await addReceipt(receipt); removeDraft(id); setDraft(null); Alert.alert('Receipt saved', 'Receipt and item prices are now part of your history.'); } catch (error) { Alert.alert('Could not save receipt', error instanceof Error ? error.message : 'Connect to your household server and try again.'); } }} style={[styles.primaryButton, { backgroundColor: colors.primary, marginTop: 14 }]}><Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Save receipt</Text></Pressable><Pressable onPress={() => { removeDraft(draft.id); setDraft(null); }} style={[styles.secondaryButton, { backgroundColor: colors.secondary }]}><Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Discard draft</Text></Pressable>
      </View>}
      <View style={styles.sectionHead}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Saved receipts</Text><Text style={[styles.sectionMeta, { color: colors.mutedForeground }]}>August 2026</Text></View>
      <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {receipts.length === 0 ? <View style={styles.empty}><View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}><Feather name="file-text" size={18} color={colors.mutedForeground} /></View><Text style={[styles.emptyTitle, { color: colors.foreground }]}>No receipts yet</Text><Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>Add your first receipt to start tracking what you spend.</Text></View> : receipts.map((receipt) => {
          const edit = dateEdits[receipt.id] ?? { date: receipt.date, time: receipt.purchaseTime ?? '' };
          return <View key={receipt.id} style={[styles.receiptEntry, { borderBottomColor: colors.border }]}><View style={styles.receiptRow}>{receipt.imageUri ? <Image source={{ uri: receipt.imageUri }} style={styles.thumb} /> : <View style={[styles.thumb, { backgroundColor: colors.secondary }]}><Feather name="file-text" size={16} color={colors.mutedForeground} /></View>}<View style={{ flex: 1 }}><Text style={[styles.receiptMerchant, { color: colors.foreground }]}>{receipt.merchant || 'Grocery receipt'}</Text><Text style={[styles.receiptDate, { color: colors.mutedForeground }]}>{receipt.date || 'Date unknown'} · {receipt.items.length} items</Text></View><Text style={[styles.receiptTotal, { color: colors.foreground }]}>${receipt.total.toFixed(2)}</Text></View><View style={styles.receiptDateEdit}><TextInput value={edit.date} onChangeText={(date) => setDateEdits((current) => ({ ...current, [receipt.id]: { ...edit, date } }))} placeholder="YYYY-MM-DD" style={[styles.dateEditInput, { color: colors.foreground, borderColor: colors.border }]} /><TextInput value={edit.time} onChangeText={(time) => setDateEdits((current) => ({ ...current, [receipt.id]: { ...edit, time } }))} placeholder="HH:mm" style={[styles.dateEditInput, { color: colors.foreground, borderColor: colors.border }]} /><Pressable onPress={async () => { try { await updateReceiptDate(receipt.id, edit.date, edit.time || null); setDateEdits((current) => { const next = { ...current }; delete next[receipt.id]; return next; }); Alert.alert('Receipt updated', 'Summaries and price history now use the edited purchase time.'); } catch (error) { Alert.alert('Could not update receipt', error instanceof Error ? error.message : 'Reconnect to your household server.'); } }} style={[styles.dateSave, { backgroundColor: colors.secondary }]}><Text style={{ color: colors.foreground, fontSize: 10, fontWeight: '700' }}>Save date</Text></Pressable></View></View>;
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 18 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 22 },
  eyebrow: { fontSize: 9, fontWeight: '700', letterSpacing: 1.3, marginBottom: 5 },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -1 },
  subtitle: { fontSize: 13, marginTop: 4 },
  countPill: { alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 14 },
  count: { fontSize: 18, fontWeight: '700' },
  countLabel: { fontSize: 10, marginTop: 1 },
  scanCard: { alignItems: 'center', borderWidth: 1, borderRadius: 18, padding: 23, marginBottom: 28 },
  cameraCircle: { width: 60, height: 60, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 13 },
  scanTitle: { fontSize: 18, fontWeight: '700' },
  scanBody: { textAlign: 'center', fontSize: 12, lineHeight: 18, marginTop: 6, marginBottom: 17, maxWidth: 300 },
  providerRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  providerChip: { borderRadius: 18, paddingVertical: 8, paddingHorizontal: 14 },
  primaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minWidth: 165, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 24 },
  primaryButtonText: { fontSize: 13, fontWeight: '700' },
  secondaryButton: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 9, paddingHorizontal: 15, paddingVertical: 10, borderRadius: 22 },
  secondaryButtonText: { fontSize: 12, fontWeight: '600' },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 11 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  sectionMeta: { fontSize: 11 },
  listCard: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 15 },
  reviewCard: { borderWidth: 1, borderRadius: 16, padding: 15, marginBottom: 24, gap: 8 },
  fieldLabel: { fontSize: 10, fontWeight: '700', marginTop: 4 },
  reviewInput: { borderWidth: 1, borderRadius: 8, minHeight: 40, paddingHorizontal: 10, fontSize: 13 },
  reviewPair: { flexDirection: 'row', gap: 9 },
  reviewItemCard: { borderWidth: 1, borderRadius: 13, padding: 12, gap: 9, marginTop: 7 },
  reviewItemNumber: { fontSize: 10, fontWeight: '700', letterSpacing: 0.7 },
  reviewFieldsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  reviewField: { flexGrow: 1, flexBasis: '46%', minWidth: 120, gap: 4 },
  reviewNameField: { flexBasis: '100%' },
  reviewNameInput: { width: '100%' },
  reviewItemInput: { minWidth: 0, minHeight: 44, borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, fontSize: 14 },
  empty: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: 20 },
  emptyIcon: { width: 45, height: 45, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 11 },
  emptyTitle: { fontSize: 15, fontWeight: '700' },
  emptyBody: { textAlign: 'center', fontSize: 12, lineHeight: 18, marginTop: 5 },
  receiptRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1 },
  receiptEntry: { paddingBottom: 9, borderBottomWidth: 1 },
  receiptDateEdit: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingVertical: 8 },
  dateEditInput: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, minHeight: 44, fontSize: 13, flexGrow: 1, flexBasis: 120 },
  dateSave: { minHeight: 44, minWidth: 88, alignItems: 'center', justifyContent: 'center', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 },
  thumb: { width: 42, height: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  receiptMerchant: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  receiptDate: { fontSize: 11, marginTop: 3 },
  receiptTotal: { fontSize: 14, fontWeight: '700', flexShrink: 0 },
});
