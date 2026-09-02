import { scanReceipt } from '@workspace/api-client-react';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';
import { useColors } from '@/hooks/useColors';
import { useGroceries, type GroceryReceipt } from '@/context/GroceryContext';

export default function ReceiptsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { receipts, addReceipt } = useGroceries();
  const [isScanning, setIsScanning] = useState(false);
  const topInset = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;

  async function recognizeAsset(asset: ImagePicker.ImagePickerAsset) {
    if (!asset.base64) {
      Alert.alert('Photo could not be read', 'Please try taking the photo again.');
      return;
    }
    setIsScanning(true);
    try {
      const mimeType = asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
      const result = await scanReceipt({ imageBase64: asset.base64, mimeType });
      const receipt: Omit<GroceryReceipt, 'id'> = { ...result, imageUri: asset.uri };
      addReceipt(receipt);
      Alert.alert('Receipt recognized', `${result.items.length} item${result.items.length === 1 ? '' : 's'} added to your summary.`);
    } catch {
      Alert.alert('Could not recognize receipt', 'Try a brighter, flatter photo with the full receipt in frame.');
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
        <Pressable style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary, opacity: pressed || isScanning ? 0.75 : 1 }]} onPress={captureReceipt} disabled={isScanning} testID="button-capture-receipt">
          {isScanning ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="camera" size={16} color={colors.primaryForeground} />}
          <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>{isScanning ? 'Recognizing…' : 'Use camera'}</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.secondaryButton, { backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 }]} onPress={chooseFromLibrary} disabled={isScanning} testID="button-choose-receipt"><Feather name="image" size={15} color={colors.foreground} /><Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Choose from photos</Text></Pressable>
      </View>
      <View style={styles.sectionHead}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Saved receipts</Text><Text style={[styles.sectionMeta, { color: colors.mutedForeground }]}>August 2026</Text></View>
      <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {receipts.length === 0 ? <View style={styles.empty}><View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}><Feather name="file-text" size={18} color={colors.mutedForeground} /></View><Text style={[styles.emptyTitle, { color: colors.foreground }]}>No receipts yet</Text><Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>Add your first receipt to start tracking what you spend.</Text></View> : receipts.map((receipt) => <View key={receipt.id} style={[styles.receiptRow, { borderBottomColor: colors.border }]}>{receipt.imageUri ? <Image source={{ uri: receipt.imageUri }} style={styles.thumb} /> : <View style={[styles.thumb, { backgroundColor: colors.secondary }]}><Feather name="file-text" size={16} color={colors.mutedForeground} /></View>}<View style={{ flex: 1 }}><Text style={[styles.receiptMerchant, { color: colors.foreground }]}>{receipt.merchant || 'Grocery receipt'}</Text><Text style={[styles.receiptDate, { color: colors.mutedForeground }]}>{receipt.date || 'August 2026'} · {receipt.items.length} items</Text></View><Text style={[styles.receiptTotal, { color: colors.foreground }]}>${receipt.total.toFixed(2)}</Text></View>)}
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
  primaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minWidth: 165, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 24 },
  primaryButtonText: { fontSize: 13, fontWeight: '700' },
  secondaryButton: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 9, paddingHorizontal: 15, paddingVertical: 10, borderRadius: 22 },
  secondaryButtonText: { fontSize: 12, fontWeight: '600' },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 11 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  sectionMeta: { fontSize: 11 },
  listCard: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 15 },
  empty: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: 20 },
  emptyIcon: { width: 45, height: 45, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 11 },
  emptyTitle: { fontSize: 15, fontWeight: '700' },
  emptyBody: { textAlign: 'center', fontSize: 12, lineHeight: 18, marginTop: 5 },
  receiptRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1 },
  thumb: { width: 42, height: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  receiptMerchant: { fontSize: 13, fontWeight: '700' },
  receiptDate: { fontSize: 11, marginTop: 3 },
  receiptTotal: { fontSize: 13, fontWeight: '700' },
});