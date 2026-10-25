import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
function AppTabLayout() {
  const colors = useColors();
  const isWeb = Platform.OS === 'web';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarItemStyle: { minHeight: 54, paddingVertical: 5 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color }) => <Feather name="home" size={20} color={color} /> }} />
      <Tabs.Screen name="receipts" options={{ title: 'Receipts', tabBarIcon: ({ color }) => <Feather name="file-text" size={20} color={color} /> }} />
      <Tabs.Screen name="summary" options={{ title: 'Summary', tabBarIcon: ({ color }) => <Feather name="pie-chart" size={20} color={color} /> }} />
      <Tabs.Screen name="grocery-lists" options={{ title: 'Lists', tabBarIcon: ({ color }) => <Feather name="check-square" size={20} color={color} /> }} />
      <Tabs.Screen name="server" options={{ title: 'Server', tabBarIcon: ({ color }) => <Feather name="server" size={20} color={color} /> }} />
    </Tabs>
  );
}

export default function TabLayout() {
  return <AppTabLayout />;
}
