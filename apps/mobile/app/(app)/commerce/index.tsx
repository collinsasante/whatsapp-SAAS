import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Modal,
  TextInput,
  Switch,
  Alert,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';

interface Order {
  id: string;
  status: string;
  customerPhone: string;
  customerName: string | null;
  currency: string;
  totalMajorUnits: number;
  paystackReference: string | null;
  paidAt: string | null;
  createdAt: string;
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  priceMajorUnits: number;
  currency: string;
  isActive: boolean;
  imageUrl: string | null;
  stockQuantity: number | null;
}

const TABS = ['Orders', 'Products'] as const;
type Tab = (typeof TABS)[number];

const STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  DRAFT: { bg: 'rgba(255,255,255,0.08)', text: 'rgba(255,255,255,0.5)' },
  AWAITING_APPROVAL: { bg: 'rgba(249,115,22,0.15)', text: '#f97316' },
  PENDING_PAYMENT: { bg: 'rgba(234,179,8,0.15)', text: '#eab308' },
  PAID: { bg: 'rgba(37,211,102,0.15)', text: '#25D366' },
  FULFILLING: { bg: 'rgba(59,130,246,0.15)', text: '#3b82f6' },
  COMPLETED: { bg: 'rgba(37,211,102,0.15)', text: '#25D366' },
  CANCELLED: { bg: 'rgba(255,255,255,0.08)', text: 'rgba(255,255,255,0.4)' },
  REFUNDED: { bg: 'rgba(239,68,68,0.15)', text: '#ef4444' },
};

function money(currency: string, amount: number): string {
  return `${currency} ${amount.toFixed(2)}`;
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.DRAFT;
  return (
    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: style.bg }}>
      <Text className="text-[10px] font-semibold" style={{ color: style.text }}>
        {status.replace(/_/g, ' ')}
      </Text>
    </View>
  );
}

const BLANK_PRODUCT = {
  name: '',
  description: '',
  sku: '',
  priceMajorUnits: '',
  currency: 'GHS',
  stockQuantity: '',
  minOrderQuantity: '',
};

export default function CommerceScreen() {
  const [tab, setTab] = useState<Tab>('Orders');

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <View className="flex-row items-center px-4 py-3 border-b border-white/5">
        <TouchableOpacity
          onPress={() => router.back()}
          className="mr-3 p-1"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={22} color="#25D366" />
        </TouchableOpacity>
        <Text className="text-white font-semibold text-base flex-1">Commerce</Text>
      </View>

      <View className="flex-row px-4 pt-3 gap-2">
        {TABS.map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => setTab(t)}
            className={`px-4 py-2 rounded-full ${tab === t ? 'bg-green' : 'bg-surface-card border border-white/10'}`}
            activeOpacity={0.8}
          >
            <Text className={`text-sm font-medium ${tab === t ? 'text-white' : 'text-white/50'}`}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'Orders' ? <OrdersTab /> : <ProductsTab />}
    </SafeAreaView>
  );
}

function OrdersTab() {
  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['commerce', 'orders'],
    queryFn: () => apiClient.commerceOrders.list().then((r) => r.data as Order[]),
  });

  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#25D366" />}
      ListEmptyComponent={
        isLoading ? (
          <View className="flex-1 items-center justify-center pt-24">
            <ActivityIndicator color="#25D366" size="large" />
          </View>
        ) : (
          <View className="items-center pt-24">
            <Ionicons name="receipt-outline" size={48} color="rgba(255,255,255,0.15)" style={{ marginBottom: 12 }} />
            <Text className="text-white/30 text-base font-medium">No orders yet</Text>
          </View>
        )
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          className="bg-surface-card border border-white/5 rounded-2xl p-4"
          activeOpacity={0.8}
          onPress={() => router.push(`/(app)/commerce/orders/${item.id}`)}
        >
          <View className="flex-row items-center justify-between mb-1.5">
            <Text className="text-white font-semibold text-sm" numberOfLines={1}>
              {item.customerName || item.customerPhone}
            </Text>
            <StatusBadge status={item.status} />
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="text-white/40 text-xs">{new Date(item.createdAt).toLocaleDateString()}</Text>
            <Text className="text-white font-semibold text-sm">{money(item.currency, item.totalMajorUnits)}</Text>
          </View>
        </TouchableOpacity>
      )}
    />
  );
}

function ProductsTab() {
  const queryClient = useQueryClient();
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK_PRODUCT);
  const [saving, setSaving] = useState(false);

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['commerce', 'products'],
    queryFn: () => apiClient.commerceProducts.list().then((r) => r.data as Product[]),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiClient.commerceProducts.update(id, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['commerce', 'products'] }),
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(BLANK_PRODUCT);
    setModalVisible(true);
  };

  const openEdit = (p: Product) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      description: p.description ?? '',
      sku: p.sku ?? '',
      priceMajorUnits: String(p.priceMajorUnits),
      currency: p.currency,
      stockQuantity: p.stockQuantity != null ? String(p.stockQuantity) : '',
      minOrderQuantity: '',
    });
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.priceMajorUnits.trim()) {
      Alert.alert('Missing info', 'Name and price are required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        sku: form.sku.trim() || undefined,
        priceMajorUnits: parseFloat(form.priceMajorUnits) || 0,
        currency: form.currency.trim() || 'GHS',
        stockQuantity: form.stockQuantity.trim() ? parseInt(form.stockQuantity, 10) : undefined,
        minOrderQuantity: form.minOrderQuantity.trim() ? parseInt(form.minOrderQuantity, 10) : undefined,
      };
      if (editingId) {
        await apiClient.commerceProducts.update(editingId, payload);
      } else {
        await apiClient.commerceProducts.create(payload);
      }
      await queryClient.invalidateQueries({ queryKey: ['commerce', 'products'] });
      setModalVisible(false);
    } catch {
      Alert.alert('Error', 'Failed to save product. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <FlatList
        data={data ?? []}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#25D366" />}
        ListEmptyComponent={
          isLoading ? (
            <View className="flex-1 items-center justify-center pt-24">
              <ActivityIndicator color="#25D366" size="large" />
            </View>
          ) : (
            <View className="items-center pt-24 w-full">
              <Ionicons name="cube-outline" size={48} color="rgba(255,255,255,0.15)" style={{ marginBottom: 12 }} />
              <Text className="text-white/30 text-base font-medium">No products yet</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            className="bg-surface-card border border-white/5 rounded-2xl p-3 flex-1"
            activeOpacity={0.8}
            onPress={() => openEdit(item)}
          >
            <View className="flex-row items-start justify-between mb-2">
              <Text className="text-white font-semibold text-sm flex-1" numberOfLines={2}>
                {item.name}
              </Text>
              <Switch
                value={item.isActive}
                onValueChange={(v) => toggleActive.mutate({ id: item.id, isActive: v })}
              />
            </View>
            <Text className="text-green font-semibold text-sm mb-1">{money(item.currency, item.priceMajorUnits)}</Text>
            {item.stockQuantity != null && (
              <Text className="text-white/30 text-[11px]">{item.stockQuantity} in stock</Text>
            )}
          </TouchableOpacity>
        )}
      />

      <TouchableOpacity
        className="absolute bottom-6 right-6 w-14 h-14 rounded-full bg-green items-center justify-center"
        style={{ elevation: 4, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6 }}
        onPress={openCreate}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 justify-end"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <View className="bg-surface rounded-t-3xl max-h-[85%]">
            <View className="flex-row items-center justify-between px-5 py-4 border-b border-white/5">
              <Text className="text-white font-bold text-lg">{editingId ? 'Edit Product' : 'New Product'}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>
            <ScrollView className="px-5 py-4" contentContainerStyle={{ gap: 14 }}>
              <FormField label="Name" value={form.name} onChangeText={(v) => setForm((s) => ({ ...s, name: v }))} />
              <FormField
                label="Description"
                value={form.description}
                onChangeText={(v) => setForm((s) => ({ ...s, description: v }))}
                multiline
              />
              <FormField label="SKU" value={form.sku} onChangeText={(v) => setForm((s) => ({ ...s, sku: v }))} />
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <FormField
                    label={`Price (${form.currency})`}
                    value={form.priceMajorUnits}
                    onChangeText={(v) => setForm((s) => ({ ...s, priceMajorUnits: v }))}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View className="flex-1">
                  <FormField
                    label="Stock (blank = unlimited)"
                    value={form.stockQuantity}
                    onChangeText={(v) => setForm((s) => ({ ...s, stockQuantity: v }))}
                    keyboardType="number-pad"
                  />
                </View>
              </View>
            </ScrollView>
            <View className="px-5 py-4 border-t border-white/5">
              <TouchableOpacity
                className="bg-green rounded-xl py-3.5 items-center"
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold">Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  multiline,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  multiline?: boolean;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
}) {
  return (
    <View>
      <Text className="text-white/50 text-xs font-medium mb-1.5">{label}</Text>
      <TextInput
        className="bg-surface-card border border-white/10 rounded-xl px-3.5 py-3 text-white text-sm"
        placeholderTextColor="rgba(255,255,255,0.3)"
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        keyboardType={keyboardType}
        style={multiline ? { minHeight: 70, textAlignVertical: 'top' } : undefined}
      />
    </View>
  );
}
