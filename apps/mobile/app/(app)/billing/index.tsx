import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, TextInput,
  Alert, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../src/lib/api';

interface Plan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
  trialDays: number;
  features: string[];
  limMaxAgents: number;
  limMaxChannels: number;
  limMaxContacts: number;
  limMessagesPerMonth: number;
  limAiCreditsPerMonth: number;
}

interface Subscription {
  id: string;
  planId: string;
  status: string;
  cycle: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  plan: Plan;
}

interface BillingStatus {
  subscription: Subscription;
  plan: Plan;
  billingEmail: string | null;
}

interface UsageLimits {
  maxAgents: number;
  maxChannels: number;
  maxContacts: number;
  maxTemplates: number;
  messagesPerMonth: number;
  maxCampaigns: number;
  aiCreditsPerMonth: number;
  storageGb: number;
}

interface UsageData {
  periodStart: string;
  messagesSent: number;
  messagesReceived: number;
  conversationsOpened: number;
  campaignsSent: number;
  aiCreditsUsed: number;
  activeAgents: number;
  activeChannels: number;
  totalContacts: number;
  totalTemplates: number;
}

interface UsageResponse {
  usage: UsageData;
  limits: UsageLimits;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  total: number;
  currency: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  createdAt: string;
}

interface CreditPack {
  slug: string;
  credits: number;
  amount: number;
  label: string;
  description: string;
  currency: string;
}

interface AiCredits {
  balance: number;
}

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: '#25D366',
  TRIAL: '#3b82f6',
  PAST_DUE: '#ef4444',
  SUSPENDED: '#f97316',
  CANCELED: '#6b7280',
  EXPIRED: '#6b7280',
};

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatPrice(amount: number, currency?: string): string {
  const sym = currency === 'GHS' ? '₵' : '$';
  return `${sym}${amount}`;
}

function ProgressBar({ used, max, color = '#25D366' }: { used: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((used / max) * 100, 100) : 0;
  const isHigh = pct > 80;
  return (
    <View className="h-1.5 bg-white/10 rounded-full overflow-hidden">
      <View
        className="h-full rounded-full"
        style={{ width: `${pct}%`, backgroundColor: isHigh ? '#ef4444' : color }}
      />
    </View>
  );
}

export default function BillingScreen() {
  const qc = useQueryClient();
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [checkoutCycle, setCheckoutCycle] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
  const [billingEmail, setBillingEmail] = useState('');

  const { data: billingStatus, isLoading, refetch: refetchStatus } = useQuery({
    queryKey: ['billing', 'status'],
    queryFn: () => apiClient.billing.getStatus().then((r) => r.data as BillingStatus | { data: BillingStatus }),
    select: (raw) => (('data' in (raw as object)) ? (raw as { data: BillingStatus }).data : raw) as BillingStatus,
  });

  const { data: plans, refetch: refetchPlans } = useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: () => apiClient.billing.getPlans().then((r) => r.data),
    select: (raw) => (Array.isArray(raw) ? raw : ((raw as { data: Plan[] }).data ?? [])) as Plan[],
  });

  const { data: usageData, refetch: refetchUsage } = useQuery({
    queryKey: ['billing', 'usage'],
    queryFn: () => apiClient.billing.getUsage().then((r) => r.data as UsageResponse | { data: UsageResponse }),
    select: (raw) => (('data' in (raw as object)) ? (raw as { data: UsageResponse }).data : raw) as UsageResponse,
  });

  const { data: invoices, refetch: refetchInvoices } = useQuery({
    queryKey: ['billing', 'invoices'],
    queryFn: () => apiClient.billing.getInvoices().then((r) => r.data),
    select: (raw) => (Array.isArray(raw) ? raw : ((raw as { data: Invoice[] }).data ?? [])) as Invoice[],
  });

  const { data: aiCredits } = useQuery({
    queryKey: ['billing', 'credits'],
    queryFn: () => apiClient.billing.getAiCredits().then((r) => r.data as AiCredits | { data: AiCredits }),
    select: (raw) => (('data' in (raw as object)) ? (raw as { data: AiCredits }).data : raw) as AiCredits,
  });

  const { data: creditPacks } = useQuery({
    queryKey: ['billing', 'credit-packs'],
    queryFn: () => apiClient.billing.getCreditPacks().then((r) => r.data),
    select: (raw) => (Array.isArray(raw) ? raw : ((raw as { data: CreditPack[] }).data ?? [])) as CreditPack[],
  });

  const checkoutMutation = useMutation({
    mutationFn: (data: { planSlug: string; cycle: string; billingEmail?: string }) =>
      apiClient.billing.initiateCheckout(data),
    onSuccess: (res) => {
      setShowCheckoutModal(false);
      const ref = (res.data as { reference?: string })?.reference;
      Alert.alert(
        'Payment Initiated',
        ref ? `Your reference: ${ref}\nMake payment and confirm.` : 'Contact support to complete payment.',
      );
    },
    onError: () => Alert.alert('Error', 'Failed to initiate checkout.'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => apiClient.billing.cancelSubscription(false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing'] });
      Alert.alert('Cancelled', 'Subscription will end at the current period end.');
    },
    onError: () => Alert.alert('Error', 'Failed to cancel subscription.'),
  });

  const creditPurchaseMutation = useMutation({
    mutationFn: (slug: string) => apiClient.billing.initializeCreditPurchase(slug),
    onSuccess: (res) => {
      const ref = (res.data as { reference?: string })?.reference;
      Alert.alert('Credit Purchase', ref ? `Reference: ${ref}\nComplete payment to add credits.` : 'Contact support.');
    },
    onError: () => Alert.alert('Error', 'Failed to initiate credit purchase.'),
  });

  const refetchAll = () => { refetchStatus(); refetchPlans(); refetchUsage(); refetchInvoices(); };

  const subscription = billingStatus?.subscription;
  const currentPlan = billingStatus?.plan;
  const usage = usageData?.usage;
  const limits = usageData?.limits;
  const statusColor = STATUS_COLOR[subscription?.status ?? ''] ?? '#fff';

  const USAGE_METERS = limits && usage ? [
    { label: 'Messages Sent', used: usage.messagesSent, max: limits.messagesPerMonth },
    { label: 'Contacts', used: usage.totalContacts, max: limits.maxContacts },
    { label: 'Active Agents', used: usage.activeAgents, max: limits.maxAgents },
    { label: 'Templates', used: usage.totalTemplates, max: limits.maxTemplates },
    { label: 'Active Channels', used: usage.activeChannels, max: limits.maxChannels },
    { label: 'Campaigns', used: usage.campaignsSent, max: limits.maxCampaigns },
    { label: 'AI Credits', used: usage.aiCreditsUsed, max: limits.aiCreditsPerMonth },
  ] : [];

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <View className="px-4 py-3 border-b border-white/5">
        <Text className="text-white text-xl font-bold">Billing</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetchAll} tintColor="#25D366" />}
      >
        {/* Current subscription */}
        {subscription && (
          <View className="bg-surface-card rounded-2xl border border-white/5 p-5 mb-5">
            <View className="flex-row items-start justify-between mb-3">
              <View>
                <Text className="text-white font-bold text-lg">{currentPlan?.name ?? 'Free'}</Text>
                <View className="flex-row items-center gap-2 mt-1">
                  <View className="rounded-full px-2.5 py-0.5" style={{ backgroundColor: statusColor + '20' }}>
                    <Text className="text-xs font-semibold" style={{ color: statusColor }}>
                      {subscription.status}
                    </Text>
                  </View>
                  <Text className="text-white/40 text-xs capitalize">{subscription.cycle}</Text>
                </View>
              </View>
              <View className="items-end">
                <Text className="text-white font-bold text-xl">
                  {formatPrice(
                    subscription.cycle === 'YEARLY'
                      ? (currentPlan?.yearlyPrice ?? 0)
                      : (currentPlan?.monthlyPrice ?? 0),
                    currentPlan?.currency,
                  )}
                </Text>
                <Text className="text-white/30 text-xs">
                  /{subscription.cycle === 'YEARLY' ? 'yr' : 'mo'}
                </Text>
              </View>
            </View>

            {subscription.trialEndsAt && (
              <View className="bg-blue-500/10 rounded-xl p-3 mb-3">
                <Text className="text-blue-300 text-xs">
                  Trial ends {formatDate(subscription.trialEndsAt)}
                </Text>
              </View>
            )}

            {subscription.cancelAtPeriodEnd && (
              <View className="bg-red-500/10 rounded-xl p-3 mb-3">
                <Text className="text-red-300 text-xs">
                  Cancels {formatDate(subscription.currentPeriodEnd)}
                </Text>
              </View>
            )}

            <Text className="text-white/30 text-xs">
              Renews {formatDate(subscription.currentPeriodEnd)}
            </Text>

            {!subscription.cancelAtPeriodEnd && subscription.status === 'ACTIVE' && (
              <TouchableOpacity
                className="border border-red-500/30 rounded-xl py-2.5 items-center mt-3"
                onPress={() =>
                  Alert.alert('Cancel Subscription', 'Your plan will end at the current billing period.', [
                    { text: 'Keep Plan', style: 'cancel' },
                    { text: 'Cancel', style: 'destructive', onPress: () => cancelMutation.mutate() },
                  ])
                }
              >
                <Text className="text-red-400 text-sm font-semibold">Cancel Subscription</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Usage meters */}
        {USAGE_METERS.length > 0 && (
          <>
            <Text className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
              Usage This Period
            </Text>
            <View className="bg-surface-card rounded-2xl border border-white/5 p-4 mb-5">
              {USAGE_METERS.map((m, i) => (
                <View key={m.label} className={`py-3 ${i < USAGE_METERS.length - 1 ? 'border-b border-white/5' : ''}`}>
                  <View className="flex-row justify-between mb-1.5">
                    <Text className="text-white/60 text-sm">{m.label}</Text>
                    <Text className="text-white text-sm font-semibold">
                      {m.used.toLocaleString()}
                      {m.max > 0 && (
                        <Text className="text-white/30"> / {m.max.toLocaleString()}</Text>
                      )}
                    </Text>
                  </View>
                  {m.max > 0 && <ProgressBar used={m.used} max={m.max} />}
                </View>
              ))}
            </View>
          </>
        )}

        {/* Available plans */}
        {plans && plans.length > 0 && (
          <>
            <Text className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
              Available Plans
            </Text>
            {plans.map((plan) => {
              const isCurrent = plan.id === currentPlan?.id;
              return (
                <View key={plan.id} className={`bg-surface-card rounded-2xl border p-4 mb-3 ${isCurrent ? 'border-green/40' : 'border-white/5'}`}>
                  <View className="flex-row items-start justify-between mb-2">
                    <View>
                      <View className="flex-row items-center gap-2">
                        <Text className="text-white font-bold">{plan.name}</Text>
                        {isCurrent && (
                          <View className="bg-green/20 rounded-full px-2 py-0.5">
                            <Text className="text-green text-[10px] font-semibold">Current</Text>
                          </View>
                        )}
                      </View>
                      {plan.description && (
                        <Text className="text-white/40 text-xs mt-0.5">{plan.description}</Text>
                      )}
                    </View>
                    <View className="items-end">
                      <Text className="text-white font-bold text-lg">
                        {formatPrice(plan.monthlyPrice, plan.currency)}
                        <Text className="text-white/40 text-xs">/mo</Text>
                      </Text>
                    </View>
                  </View>

                  <View className="flex-row flex-wrap gap-2 mb-3">
                    {[
                      `${plan.limMaxAgents} agents`,
                      `${plan.limMaxChannels} channels`,
                      plan.limMaxContacts > 0 ? `${plan.limMaxContacts.toLocaleString()} contacts` : 'Unlimited contacts',
                    ].map((f) => (
                      <View key={f} className="bg-surface rounded-full px-2.5 py-0.5">
                        <Text className="text-white/40 text-[10px]">{f}</Text>
                      </View>
                    ))}
                  </View>

                  {!isCurrent && (
                    <TouchableOpacity
                      className="bg-green rounded-xl py-2.5 items-center"
                      onPress={() => {
                        setSelectedPlan(plan);
                        setBillingEmail(billingStatus?.billingEmail ?? '');
                        setShowCheckoutModal(true);
                      }}
                    >
                      <Text className="text-white font-semibold text-sm">
                        {(currentPlan?.monthlyPrice ?? 0) > plan.monthlyPrice ? 'Downgrade' : 'Upgrade'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </>
        )}

        {/* AI Credits */}
        <Text className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3 mt-2">
          AI Credits
        </Text>
        <View className="bg-surface-card rounded-2xl border border-white/5 p-4 mb-5">
          <View className="flex-row items-center justify-between mb-3">
            <View className="flex-row items-center gap-2">
              <Ionicons name="sparkles" size={18} color="#25D366" />
              <Text className="text-white font-semibold">Credit Balance</Text>
            </View>
            <Text className="text-white font-bold text-xl">{aiCredits?.balance ?? 0}</Text>
          </View>

          {creditPacks && creditPacks.length > 0 && (
            <View className="gap-2">
              {creditPacks.map((pack) => (
                <View key={pack.slug} className="flex-row items-center justify-between bg-surface rounded-xl p-3">
                  <View>
                    <Text className="text-white text-sm font-semibold">{pack.credits} Credits</Text>
                    <Text className="text-white/40 text-xs">{pack.description}</Text>
                  </View>
                  <TouchableOpacity
                    className="bg-green/20 rounded-xl px-3 py-1.5"
                    onPress={() => creditPurchaseMutation.mutate(pack.slug)}
                    disabled={creditPurchaseMutation.isPending}
                  >
                    <Text className="text-green text-xs font-semibold">
                      {formatPrice(pack.amount, pack.currency)}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Invoice history */}
        {invoices && invoices.length > 0 && (
          <>
            <Text className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
              Invoices
            </Text>
            <View className="bg-surface-card rounded-2xl border border-white/5 overflow-hidden mb-5">
              {invoices.slice(0, 5).map((inv, i) => (
                <View key={inv.id} className={`px-4 py-3 flex-row items-center gap-3 ${i < invoices.length - 1 ? 'border-b border-white/5' : ''}`}>
                  <View className="flex-1 min-w-0">
                    <Text className="text-white text-sm font-medium">#{inv.invoiceNumber}</Text>
                    <Text className="text-white/30 text-xs">
                      {formatDate(inv.billingPeriodStart)} – {formatDate(inv.billingPeriodEnd)}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-white font-semibold text-sm">
                      {formatPrice(inv.total, inv.currency)}
                    </Text>
                    <View
                      className="rounded-full px-2 py-0.5 mt-0.5"
                      style={{
                        backgroundColor:
                          inv.status === 'PAID' ? '#25D366' + '20' : '#f97316' + '20',
                      }}
                    >
                      <Text
                        className="text-[10px] font-semibold capitalize"
                        style={{ color: inv.status === 'PAID' ? '#25D366' : '#f97316' }}
                      >
                        {inv.status.toLowerCase()}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* Checkout modal */}
      <Modal visible={showCheckoutModal} animationType="slide" transparent>
        <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View className="bg-surface rounded-t-3xl p-6">
            <View className="flex-row items-center justify-between mb-5">
              <Text className="text-white text-lg font-bold">
                Subscribe to {selectedPlan?.name}
              </Text>
              <TouchableOpacity onPress={() => setShowCheckoutModal(false)}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>

            {/* Billing cycle */}
            <Text className="text-white/50 text-xs mb-2">Billing Cycle</Text>
            <View className="flex-row bg-surface-card rounded-xl p-1 mb-4">
              {(['MONTHLY', 'YEARLY'] as const).map((cycle) => (
                <TouchableOpacity
                  key={cycle}
                  onPress={() => setCheckoutCycle(cycle)}
                  className={`flex-1 py-2.5 rounded-lg items-center ${checkoutCycle === cycle ? 'bg-green' : ''}`}
                >
                  <Text className={`text-sm font-semibold ${checkoutCycle === cycle ? 'text-white' : 'text-white/40'}`}>
                    {cycle === 'MONTHLY' ? (
                      `Monthly  ${selectedPlan ? formatPrice(selectedPlan.monthlyPrice, selectedPlan.currency) : ''}`
                    ) : (
                      `Yearly  ${selectedPlan ? formatPrice(selectedPlan.yearlyPrice, selectedPlan.currency) : ''}`
                    )}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Billing email */}
            <Text className="text-white/50 text-xs mb-1.5">Billing Email</Text>
            <TextInput
              className="bg-surface-card border border-white/10 rounded-xl px-4 py-3 text-white mb-5"
              placeholder="your@email.com"
              placeholderTextColor="rgba(255,255,255,0.2)"
              value={billingEmail}
              onChangeText={setBillingEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <TouchableOpacity
              className="bg-green rounded-2xl py-4 items-center"
              onPress={() => {
                if (!selectedPlan) return;
                checkoutMutation.mutate({
                  planSlug: selectedPlan.slug,
                  cycle: checkoutCycle,
                  billingEmail: billingEmail || undefined,
                });
              }}
              disabled={checkoutMutation.isPending}
            >
              {checkoutMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white font-bold text-base">Proceed to Payment</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
