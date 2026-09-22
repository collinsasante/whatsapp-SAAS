import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../../src/lib/api';
import { useAppTheme } from '../../../../src/theme/useAppTheme';

interface OrderItem {
  id: string;
  productNameSnapshot: string;
  variantLabelSnapshot: string | null;
  quantity: number;
  unitPriceMajorUnitsSnapshot: number;
  lineTotalMajorUnits: number;
}

interface OrderEvent {
  id: string;
  type: string;
  createdAt: string;
}

interface LedgerEntry {
  id: string;
  type: string;
  amountMajorUnits: number;
  createdAt: string;
}

interface OrderDetail {
  id: string;
  status: string;
  customerPhone: string;
  customerName: string | null;
  currency: string;
  totalMajorUnits: number;
  paystackReference: string | null;
  paidAt: string | null;
  createdAt: string;
  items?: OrderItem[];
  events?: OrderEvent[];
  ledgerEntries?: LedgerEntry[];
}

function money(currency: string, amount: number): string {
  return `${currency} ${amount.toFixed(2)}`;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string | string[] } } };
  const msg = e.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : msg || fallback;
}

export default function OrderDetailScreen() {
  const { colors } = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [verifying, setVerifying] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const { data: order, isLoading } = useQuery({
    queryKey: ['commerce', 'orders', id],
    queryFn: () => apiClient.commerceOrders.get(id).then((r) => r.data as OrderDetail),
    enabled: !!id,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['commerce', 'orders', id] });
    void queryClient.invalidateQueries({ queryKey: ['commerce', 'orders'] });
  };

  const verifyPayment = async () => {
    setVerifying(true);
    try {
      const res = await apiClient.commerceOrders.verifyPayment(id);
      const data = res.data as { verified: boolean; reason?: string };
      if (data.verified) {
        Alert.alert('Verified', 'Payment verified with Paystack — order is PAID');
        refresh();
      } else {
        Alert.alert('Not verified', data.reason || 'Payment not confirmed by Paystack yet');
      }
    } catch (e) {
      Alert.alert('Error', apiErrorMessage(e, 'Verification failed'));
    } finally {
      setVerifying(false);
    }
  };

  const approveOrder = async () => {
    setApproving(true);
    try {
      await apiClient.commerceOrders.approve(id);
      Alert.alert('Approved', 'Payment link sent to the customer');
      refresh();
    } catch (e) {
      Alert.alert('Error', apiErrorMessage(e, 'Failed to approve order'));
    } finally {
      setApproving(false);
    }
  };

  const rejectOrder = () => {
    Alert.alert('Reject order', 'Are you sure you want to reject this order?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: async () => {
          setRejecting(true);
          try {
            await apiClient.commerceOrders.reject(id);
            refresh();
          } catch (e) {
            Alert.alert('Error', apiErrorMessage(e, 'Failed to reject order'));
          } finally {
            setRejecting(false);
          }
        },
      },
    ]);
  };

  if (isLoading || !order) {
    return (
      <SafeAreaView className="flex-1 bg-light-background dark:bg-surface items-center justify-center" edges={['top']}>
        <ActivityIndicator color="#25D366" size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-light-background dark:bg-surface" edges={['top']}>
      <View className="flex-row items-center px-4 py-3 border-b border-light-border dark:border-white/5">
        <TouchableOpacity onPress={() => router.back()} className="mr-3 p-1" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={22} color="#25D366" />
        </TouchableOpacity>
        <Text className="text-light-text-primary dark:text-white font-semibold text-base flex-1">Order</Text>
      </View>

      <ScrollView className="flex-1 px-4 pt-4" contentContainerStyle={{ paddingBottom: 32, gap: 20 }}>
        <View className="bg-light-card dark:bg-surface-card rounded-2xl border border-light-border dark:border-white/5 p-4">
          <Text className="text-light-text-primary dark:text-white font-bold text-lg mb-1">
            {order.customerName || order.customerPhone}
          </Text>
          <Text className="text-light-text-muted dark:text-white/40 text-xs mb-3">{order.customerPhone}</Text>
          <View className="flex-row items-center justify-between">
            <Text className="text-light-text-muted dark:text-white/50 text-sm">{order.status.replace(/_/g, ' ')}</Text>
            <Text className="text-light-text-primary dark:text-white font-bold text-lg">{money(order.currency, order.totalMajorUnits)}</Text>
          </View>
          {order.paystackReference && (
            <View className="mt-3 pt-3 border-t border-light-border dark:border-white/5">
              <Text className="text-light-text-disabled dark:text-white/30 text-[11px]">Paystack reference</Text>
              <Text className="text-light-text-muted dark:text-white/60 text-xs mt-0.5">{order.paystackReference}</Text>
            </View>
          )}
          {order.paidAt && (
            <View className="mt-2">
              <Text className="text-light-text-disabled dark:text-white/30 text-[11px]">Paid at</Text>
              <Text className="text-light-text-muted dark:text-white/60 text-xs mt-0.5">{new Date(order.paidAt).toLocaleString()}</Text>
            </View>
          )}
        </View>

        {order.items && order.items.length > 0 && (
          <View>
            <Text className="text-light-text-muted dark:text-white/40 text-xs font-semibold uppercase tracking-wider mb-2">Items</Text>
            <View className="bg-light-card dark:bg-surface-card rounded-2xl border border-light-border dark:border-white/5 p-4" style={{ gap: 8 }}>
              {order.items.map((item) => (
                <View key={item.id} className="flex-row items-center justify-between">
                  <Text className="text-light-text-secondary dark:text-white/70 text-sm flex-1 mr-2" numberOfLines={2}>
                    {item.quantity}× {item.productNameSnapshot}
                    {item.variantLabelSnapshot ? ` (${item.variantLabelSnapshot})` : ''}
                  </Text>
                  <Text className="text-light-text-primary dark:text-white text-sm font-medium">
                    {money(order.currency, item.lineTotalMajorUnits)}
                  </Text>
                </View>
              ))}
              <View className="flex-row items-center justify-between border-t border-light-border dark:border-white/5 pt-2 mt-1">
                <Text className="text-light-text-primary dark:text-white font-semibold text-sm">Total</Text>
                <Text className="text-light-text-primary dark:text-white font-bold text-sm">{money(order.currency, order.totalMajorUnits)}</Text>
              </View>
            </View>
          </View>
        )}

        {order.ledgerEntries && order.ledgerEntries.length > 0 && (
          <View>
            <Text className="text-light-text-muted dark:text-white/40 text-xs font-semibold uppercase tracking-wider mb-2">Ledger</Text>
            <View className="bg-light-card dark:bg-surface-card rounded-2xl border border-light-border dark:border-white/5 p-4" style={{ gap: 6 }}>
              {order.ledgerEntries.map((entry) => (
                <View key={entry.id} className="flex-row items-center justify-between">
                  <Text className="text-light-text-muted dark:text-white/40 text-xs">{entry.type.replace(/_/g, ' ')}</Text>
                  <Text className={`text-xs font-medium ${entry.amountMajorUnits < 0 ? 'text-red-400' : 'text-light-text-secondary dark:text-white/70'}`}>
                    {money(order.currency, entry.amountMajorUnits)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {order.events && order.events.length > 0 && (
          <View>
            <Text className="text-light-text-muted dark:text-white/40 text-xs font-semibold uppercase tracking-wider mb-2">Timeline</Text>
            <View className="bg-light-card dark:bg-surface-card rounded-2xl border border-light-border dark:border-white/5 p-4" style={{ gap: 6 }}>
              {order.events.map((ev) => (
                <View key={ev.id} className="flex-row items-center justify-between">
                  <Text className="text-light-text-muted dark:text-white/60 text-xs">{ev.type.replace(/_/g, ' ')}</Text>
                  <Text className="text-light-text-disabled dark:text-white/30 text-[11px]">{new Date(ev.createdAt).toLocaleString()}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {order.status === 'PENDING_PAYMENT' && order.paystackReference && (
        <View className="px-4 py-4 border-t border-light-border dark:border-white/5">
          <TouchableOpacity
            className="bg-green rounded-xl py-3.5 items-center flex-row justify-center gap-2"
            onPress={verifyPayment}
            disabled={verifying}
            activeOpacity={0.85}
          >
            {verifying ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="checkmark-done" size={18} color="#fff" />}
            <Text className="text-white font-bold text-sm">Verify payment with Paystack</Text>
          </TouchableOpacity>
        </View>
      )}

      {order.status === 'AWAITING_APPROVAL' && (
        <View className="px-4 py-4 border-t border-light-border dark:border-white/5 flex-row gap-3">
          <TouchableOpacity
            className="flex-1 bg-green rounded-xl py-3.5 items-center flex-row justify-center gap-2"
            onPress={approveOrder}
            disabled={approving || rejecting}
            activeOpacity={0.85}
          >
            {approving ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="checkmark-circle" size={18} color="#fff" />}
            <Text className="text-white font-bold text-sm">Approve</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 border border-red-500/30 rounded-xl py-3.5 items-center flex-row justify-center gap-2"
            onPress={rejectOrder}
            disabled={approving || rejecting}
            activeOpacity={0.85}
          >
            {rejecting ? <ActivityIndicator color="#ef4444" size="small" /> : <Ionicons name="close-circle" size={18} color="#ef4444" />}
            <Text className="text-red-400 font-bold text-sm">Reject</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}
