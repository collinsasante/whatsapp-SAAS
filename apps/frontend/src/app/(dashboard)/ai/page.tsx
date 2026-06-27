'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Brain, Plus, Edit2, Trash2, ToggleLeft, ToggleRight, Save, X,
  Clock, Zap, BookOpen, AlertCircle, Upload, Link2, FileText,
  Globe, Sparkles, RefreshCw, CheckCircle2, ShieldCheck, Download, BarChart2, Shield, Eraser,
} from 'lucide-react';
import { billingApi, knowledgeBaseApi, manageSettingsApi, aiLogsApi } from '@/lib/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import toast from 'react-hot-toast';
import { showConfirm } from '@/store/confirm.store';

interface Article {
  id: string;
  title: string;
  content: string;
  isActive: boolean;
  source: string;
  sourceRef?: string;
  createdAt: string;
}

interface AiSettings {
  aiEnabled: boolean;
  aiAlwaysOn: boolean;
  aiPersonality: string;
  offHoursEnabled: boolean;
  aiTrialStartedAt?: string | null;
  aiTrialApprovedAt?: string | null;
  aiMode: 'SUGGESTION' | 'AUTO_REPLY';
  aiPilotGroup: boolean;
}

interface AiAnalytics {
  total: number;
  sent: number;
  approved: number;
  edited: number;
  rejected: number;
  autoSent: number;
  suggested: number;
  approvalRate: number;
  editRate: number;
  rejectionRate: number;
  avgRating: number | null;
  avgResponseMs: number | null;
  avgConfidence: number | null;
  dailyUsage: { date: string; count: number }[];
}

const DEFAULT_PERSONALITY = 'You are helpful, friendly, and professional. Keep replies concise and conversational — this is WhatsApp, not email.';

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  manual: { label: 'Manual', color: 'bg-gray-100 text-gray-600' },
  upload: { label: 'File', color: 'bg-blue-50 text-blue-600' },
  url: { label: 'URL', color: 'bg-violet-50 text-violet-600' },
  learned: { label: 'AI-Learned', color: 'bg-teal-50 text-teal-600' },
};

type KbTab = 'kb' | 'learned' | 'analytics';

export default function AiPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [settings, setSettings] = useState<AiSettings>({ aiEnabled: false, aiAlwaysOn: false, aiPersonality: '', offHoursEnabled: false, aiMode: 'SUGGESTION', aiPilotGroup: false });
  const [analytics, setAnalytics] = useState<AiAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [aiCredits, setAiCredits] = useState(0);
  const [approvingAi, setApprovingAi] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState({ title: '', content: '', isActive: true });
  const [personality, setPersonality] = useState('');
  const [learning, setLearning] = useState(false);
  const [showLearnModal, setShowLearnModal] = useState(false);
  const [activeTab, setActiveTab] = useState<KbTab>('kb');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [scrapingUrl, setScrapingUrl] = useState(false);
  const [selectedLearnedIds, setSelectedLearnedIds] = useState<Set<string>>(new Set());
  const [deduplicating, setDeduplicating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [kbRes, settingsRes, creditsRes] = await Promise.all([
        knowledgeBaseApi.list(),
        manageSettingsApi.get(),
        billingApi.getAiCredits(),
      ]);
      setArticles(kbRes.data);
      const s = settingsRes.data as AiSettings & { offHoursEnabled?: boolean };
      setSettings({
        aiEnabled: s.aiEnabled ?? false,
        aiAlwaysOn: s.aiAlwaysOn ?? false,
        aiPersonality: s.aiPersonality ?? '',
        offHoursEnabled: s.offHoursEnabled ?? false,
        aiTrialStartedAt: s.aiTrialStartedAt ?? null,
        aiTrialApprovedAt: s.aiTrialApprovedAt ?? null,
        aiMode: (s.aiMode as 'SUGGESTION' | 'AUTO_REPLY') ?? 'SUGGESTION',
        aiPilotGroup: s.aiPilotGroup ?? false,
      });
      setPersonality(s.aiPersonality ?? '');
      setAiCredits((creditsRes.data as { credits: number }).credits ?? 0);
    } catch {
      toast.error('Failed to load AI settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const res = await aiLogsApi.analytics();
      setAnalytics(res.data as AiAnalytics);
    } catch { /* silently fail */ }
    finally { setAnalyticsLoading(false); }
  }, []);

  useEffect(() => {
    if (activeTab === 'analytics') void loadAnalytics();
  }, [activeTab, loadAnalytics]);

  const saveSettings = async (patch: Partial<AiSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    setSavingSettings(true);
    try {
      await manageSettingsApi.updateAi({
        aiEnabled: next.aiEnabled,
        aiAlwaysOn: next.aiAlwaysOn,
        aiPersonality: next.aiPersonality,
        aiMode: next.aiMode,
        aiPilotGroup: next.aiPilotGroup,
      });
    } catch {
      toast.error('Failed to save settings');
      setSettings(settings);
    } finally {
      setSavingSettings(false);
    }
  };

  const savePersonality = async () => {
    setSavingSettings(true);
    try {
      await manageSettingsApi.updateAi({ aiPersonality: personality });
      setSettings(s => ({ ...s, aiPersonality: personality }));
      toast.success('Personality saved');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleApproveAi = async () => {
    setApprovingAi(true);
    try {
      await manageSettingsApi.approveAi();
      toast.success('VerzAI activated! It will now start replying to messages.');
      void load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Failed to approve AI';
      toast.error(msg);
    } finally {
      setApprovingAi(false);
    }
  };

  const openNew = () => {
    setForm({ title: '', content: '', isActive: true });
    setEditingId('new');
    setShowUrlInput(false);
  };

  const openEdit = (a: Article) => {
    setForm({ title: a.title, content: a.content, isActive: a.isActive });
    setEditingId(a.id);
    setShowUrlInput(false);
  };

  const saveArticle = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      toast.error('Title and content are required');
      return;
    }
    try {
      if (editingId === 'new') {
        await knowledgeBaseApi.create(form);
        toast.success('Article added');
      } else {
        await knowledgeBaseApi.update(editingId!, form);
        toast.success('Article updated');
      }
      setEditingId(null);
      void load();
    } catch {
      toast.error('Failed to save article');
    }
  };

  const deleteArticle = async (id: string) => {
    if (!await showConfirm('Delete this article?', { subtext: 'This cannot be undone.' })) return;
    try {
      await knowledgeBaseApi.delete(id);
      toast.success('Article deleted');
      setArticles(prev => prev.filter(a => a.id !== id));
    } catch {
      toast.error('Failed to delete');
    }
  };

  const toggleArticle = async (a: Article) => {
    try {
      await knowledgeBaseApi.update(a.id, { isActive: !a.isActive });
      setArticles(prev => prev.map(x => x.id === a.id ? { ...x, isActive: !x.isActive } : x));
    } catch {
      toast.error('Failed to update');
    }
  };

  const learnFromConversations = async () => {
    setLearning(true);
    try {
      const res = await knowledgeBaseApi.learn();
      const { created } = res.data as { created: number };
      if (created > 0) {
        toast.success(`Verz learned! Added ${created} new article${created !== 1 ? 's' : ''} from the last 30 days.`);
        void load();
      } else {
        toast('No new patterns found in the last 30 days of conversations.');
      }
    } catch {
      toast.error('Failed to learn from conversations');
    } finally {
      setLearning(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    try {
      const res = await knowledgeBaseApi.upload(file);
      const { created } = res.data as { created: number };
      toast.success(`Imported ${created} article${created !== 1 ? 's' : ''} from ${file.name}`);
      void load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to upload file');
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleScrapeUrl = async () => {
    const url = urlInput.trim();
    if (!url) return;
    setScrapingUrl(true);
    try {
      const res = await knowledgeBaseApi.scrape(url);
      const { created } = res.data as { created: number };
      toast.success(`Imported ${created} article${created !== 1 ? 's' : ''} from URL`);
      setUrlInput('');
      setShowUrlInput(false);
      void load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to fetch URL');
    } finally {
      setScrapingUrl(false);
    }
  };

  const kbArticles = articles.filter(a => a.source !== 'learned');
  const learnedArticles = articles.filter(a => a.source === 'learned');

  const cleanDuplicates = async () => {
    if (!await showConfirm('Clean duplicate AI-learned articles?', {
      subtext: 'This keeps the most recent version of each article and deletes all older duplicates. Only AI-Learned articles are affected — your manual articles are safe.',
    })) return;
    setDeduplicating(true);
    try {
      const res = await knowledgeBaseApi.deduplicate();
      const { deleted } = res.data as { deleted: number };
      if (deleted > 0) {
        toast.success(`Removed ${deleted} duplicate article${deleted !== 1 ? 's' : ''}`);
        void load();
      } else {
        toast('No duplicates found');
      }
    } catch {
      toast.error('Failed to clean duplicates');
    } finally {
      setDeduplicating(false);
    }
  };

  const downloadLearnedArticles = (ids: Set<string>) => {
    const toExport = learnedArticles.filter(a => ids.has(a.id));
    const text = toExport.map(a =>
      `# ${a.title}\n\n${a.content}${a.sourceRef ? `\n\nSource: ${a.sourceRef}` : ''}`
    ).join('\n\n---\n\n');
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `verz-learned-articles-${new Date().toISOString().split('T')[0]}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-teal-600" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-auto">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 sm:px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center">
            <Brain size={18} className="text-teal-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Verz AI</h1>
            <p className="text-xs text-gray-500">Knowledge base + after-hours responder</p>
          </div>
        </div>
        {settings.aiEnabled && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-teal-50 border border-teal-200 rounded-xl">
            <div className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
            <span className="text-xs font-semibold text-teal-700">Active</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-5">

          {/* Trial / Approval Banner */}
          {(() => {
            const trialStarted = settings.aiTrialStartedAt;
            const approved = settings.aiTrialApprovedAt;

            if (!trialStarted) return null;

            const trialStart = new Date(trialStarted);
            const trialEnd = new Date(trialStart.getTime() + 30 * 24 * 60 * 60 * 1000);
            const now = new Date();
            const daysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / 86_400_000));
            const trialComplete = now >= trialEnd;

            if (approved) {
              return (
                <div className="p-4 bg-teal-50 border border-teal-200 rounded-2xl flex items-start gap-3">
                  <CheckCircle2 size={16} className="text-teal-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-teal-900">VerzAI is active</p>
                    <p className="text-xs text-teal-700 mt-0.5">
                      AI replies consume 1 credit each. Balance: <strong>{aiCredits.toLocaleString()} credits</strong>.
                      {aiCredits <= 20 && aiCredits > 0 && ' — top up soon!'}
                    </p>
                    {aiCredits === 0 && (
                      <Link href="/billing" className="text-xs text-red-600 font-semibold hover:underline mt-1 inline-block">
                        No credits remaining — buy credits to resume →
                      </Link>
                    )}
                  </div>
                </div>
              );
            }

            if (trialComplete) {
              return (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl">
                  <div className="flex items-start gap-3 mb-3">
                    <ShieldCheck size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-amber-900">VerzAI learning period complete — approval required</p>
                      <p className="text-xs text-amber-700 mt-0.5">
                        Verz has been observing your conversations for 30 days and is ready to start replying.
                        To activate it, you need an active paid plan and AI credits.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => { void handleApproveAi(); }}
                      disabled={approvingAi}
                      className="px-4 py-2 text-sm font-semibold bg-amber-600 text-white rounded-xl hover:bg-amber-700 disabled:opacity-60 transition-colors flex items-center gap-2">
                      {approvingAi
                        ? <><span className="animate-spin h-3 w-3 border-2 border-white/30 border-t-white rounded-full" />Activating…</>
                        : <><ShieldCheck size={13} />Approve &amp; Activate VerzAI</>}
                    </button>
                    <Link href="/billing" className="px-4 py-2 text-sm font-medium text-amber-700 border border-amber-300 rounded-xl hover:bg-amber-100 transition-colors">
                      Buy AI Credits
                    </Link>
                  </div>
                </div>
              );
            }

            return (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl flex items-start gap-3">
                <Clock size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-blue-900">VerzAI learning period — {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining</p>
                  <p className="text-xs text-blue-700 mt-0.5">
                    Verz is observing your conversations and building knowledge. After 30 days, you&rsquo;ll be asked to approve it to start replying.
                  </p>
                </div>
              </div>
            );
          })()}

          {/* AI Settings Card */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Zap size={15} className="text-teal-600" />
              Verz Settings
            </h2>

            <div className="space-y-4">
              {/* Enable toggle */}
              <div className="flex items-center justify-between py-3 border-b border-gray-100">
                <div>
                  <p className="text-sm font-medium text-gray-900">Enable Verz</p>
                  <p className="text-xs text-gray-500 mt-0.5">Automatically reply using your knowledge base</p>
                </div>
                <button
                  onClick={() => {
                    if (!settings.aiEnabled) {
                      setShowLearnModal(true);
                    } else {
                      void saveSettings({ aiEnabled: false });
                    }
                  }}
                  disabled={savingSettings}
                  className="flex-shrink-0"
                >
                  {settings.aiEnabled
                    ? <ToggleRight size={28} className="text-teal-600" />
                    : <ToggleLeft size={28} className="text-gray-300" />}
                </button>
              </div>

              {settings.aiEnabled && (
                <>
                  {/* Mode */}
                  <div className="py-3 border-b border-gray-100">
                    <p className="text-sm font-medium text-gray-900 mb-3">When should Verz reply?</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        onClick={() => void saveSettings({ aiAlwaysOn: false })}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${!settings.aiAlwaysOn ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <Clock size={15} className={!settings.aiAlwaysOn ? 'text-teal-600' : 'text-gray-400'} />
                          <span className={`text-sm font-semibold ${!settings.aiAlwaysOn ? 'text-teal-700' : 'text-gray-700'}`}>After Hours Only</span>
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed">Replies only when your team is offline</p>
                        {!settings.offHoursEnabled && !settings.aiAlwaysOn && (
                          <Link href="/manage?tab=offhours" className="mt-2 flex items-center gap-1 text-amber-600 text-xs hover:underline">
                            <AlertCircle size={11} />
                            Off-hours not configured
                          </Link>
                        )}
                      </button>

                      <button
                        onClick={() => void saveSettings({ aiAlwaysOn: true })}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${settings.aiAlwaysOn ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <Zap size={15} className={settings.aiAlwaysOn ? 'text-teal-600' : 'text-gray-400'} />
                          <span className={`text-sm font-semibold ${settings.aiAlwaysOn ? 'text-teal-700' : 'text-gray-700'}`}>Always On</span>
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed">Replies to every inbound message 24/7</p>
                      </button>
                    </div>
                  </div>

                  {/* Response Mode */}
                  <div className="py-3 border-b border-gray-100">
                    <p className="text-sm font-medium text-gray-900 mb-0.5">Response Mode</p>
                    <p className="text-xs text-gray-500 mb-3">How Verz should handle AI responses</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        onClick={() => void saveSettings({ aiMode: 'SUGGESTION' })}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${settings.aiMode === 'SUGGESTION' ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <Sparkles size={15} className={settings.aiMode === 'SUGGESTION' ? 'text-teal-600' : 'text-gray-400'} />
                          <span className={`text-sm font-semibold ${settings.aiMode === 'SUGGESTION' ? 'text-teal-700' : 'text-gray-700'}`}>Suggestion Mode</span>
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed">AI suggests a reply — agents approve before sending</p>
                      </button>
                      <button
                        onClick={() => void saveSettings({ aiMode: 'AUTO_REPLY' })}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${settings.aiMode === 'AUTO_REPLY' ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <Zap size={15} className={settings.aiMode === 'AUTO_REPLY' ? 'text-teal-600' : 'text-gray-400'} />
                          <span className={`text-sm font-semibold ${settings.aiMode === 'AUTO_REPLY' ? 'text-teal-700' : 'text-gray-700'}`}>Auto-Reply</span>
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed">AI sends replies automatically without agent review</p>
                      </button>
                    </div>
                  </div>

                  {/* Personality */}
                  <div className="py-3">
                    <p className="text-sm font-medium text-gray-900 mb-1">AI Personality</p>
                    <p className="text-xs text-gray-500 mb-2">How Verz should communicate with customers</p>
                    {/* Preset quick-select chips */}
                    <div className="flex flex-wrap gap-2 mb-3">
                      {[
                        { label: '😊 Friendly', value: 'You are warm, friendly, and approachable. Use a conversational tone, feel free to use the customer\'s name, and keep replies short — this is WhatsApp, not email.' },
                        { label: '💼 Professional', value: 'You are professional, courteous, and precise. Use formal language, avoid slang, and always ensure accuracy before responding.' },
                        { label: '⚡ Concise', value: 'You are direct and to the point. Answer questions in 1-2 sentences maximum. Avoid filler words. Customers are busy.' },
                        { label: '🤝 Empathetic', value: 'You lead with empathy. Acknowledge the customer\'s feelings first, then provide help. Never rush — make the customer feel heard.' },
                      ].map(preset => (
                        <button
                          key={preset.label}
                          onClick={() => setPersonality(preset.value)}
                          className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                            personality === preset.value
                              ? 'bg-teal-600 text-white border-teal-600'
                              : 'border-gray-200 text-gray-600 hover:border-teal-400 hover:text-teal-700 bg-white'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={personality}
                      onChange={e => setPersonality(e.target.value)}
                      rows={3}
                      placeholder={DEFAULT_PERSONALITY}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 resize-none transition-colors"
                    />
                    <div className="flex items-center justify-between mt-2">
                      <button
                        onClick={() => setPersonality('')}
                        className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        Reset to default
                      </button>
                      <button
                        onClick={savePersonality}
                        disabled={savingSettings || personality === settings.aiPersonality}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
                      >
                        <Save size={11} />
                        Save
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Knowledge Base Tabs */}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            {/* Tab bar */}
            <div className="flex border-b border-gray-100">
              <button
                onClick={() => setActiveTab('kb')}
                className={`flex items-center gap-2 px-5 py-3.5 text-sm font-semibold border-b-2 transition-colors ${
                  activeTab === 'kb'
                    ? 'border-teal-500 text-teal-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <BookOpen size={14} />
                Knowledge Base
                {kbArticles.length > 0 && (
                  <span className="text-[11px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{kbArticles.length}</span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('learned')}
                className={`flex items-center gap-2 px-5 py-3.5 text-sm font-semibold border-b-2 transition-colors ${
                  activeTab === 'learned'
                    ? 'border-teal-500 text-teal-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Sparkles size={14} />
                AI-Learned
                {learnedArticles.length > 0 && (
                  <span className="text-[11px] bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded-full">{learnedArticles.length}</span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('analytics')}
                className={`flex items-center gap-2 px-5 py-3.5 text-sm font-semibold border-b-2 transition-colors ${
                  activeTab === 'analytics'
                    ? 'border-teal-500 text-teal-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <BarChart2 size={14} />
                Analytics
              </button>
            </div>

            {/* ── KNOWLEDGE BASE TAB ── */}
            {activeTab === 'kb' && (
              <>
                {/* Action bar */}
                <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
                  <button
                    onClick={openNew}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    <Plus size={12} />
                    Write Article
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.txt,.csv,.md"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingFile}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 hover:border-gray-300 text-gray-700 hover:bg-gray-50 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                  >
                    {uploadingFile
                      ? <span className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
                      : <Upload size={12} />
                    }
                    {uploadingFile ? 'Uploading…' : 'Upload File'}
                  </button>

                  <button
                    onClick={() => { setShowUrlInput(v => !v); setEditingId(null); }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 border text-xs font-semibold rounded-lg transition-colors ${
                      showUrlInput
                        ? 'border-violet-300 bg-violet-50 text-violet-700'
                        : 'border-gray-200 hover:border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <Link2 size={12} />
                    Add from URL
                  </button>

                  <p className="text-xs text-gray-400 ml-auto hidden sm:block">PDF, TXT, CSV, MD supported</p>
                </div>

                {/* URL input */}
                {showUrlInput && (
                  <div className="px-5 py-4 border-b border-gray-100 bg-violet-50/50">
                    <p className="text-xs font-semibold text-gray-700 mb-2">Import from URL</p>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={urlInput}
                        onChange={e => setUrlInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') void handleScrapeUrl(); }}
                        placeholder="https://yoursite.com/faq"
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 bg-white"
                      />
                      <button
                        onClick={() => void handleScrapeUrl()}
                        disabled={scrapingUrl || !urlInput.trim()}
                        className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
                      >
                        {scrapingUrl
                          ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          : <Globe size={14} />
                        }
                        {scrapingUrl ? 'Fetching…' : 'Fetch'}
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5">We'll extract readable text from the page automatically</p>
                  </div>
                )}

                {/* Article editor */}
                {editingId !== null && (
                  <div className="p-5 border-b border-gray-100 bg-gray-50">
                    <p className="text-sm font-semibold text-gray-900 mb-4">{editingId === 'new' ? 'New Article' : 'Edit Article'}</p>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                        <input
                          type="text"
                          value={form.title}
                          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                          placeholder="e.g. Return Policy, Business Hours, Shipping Info…"
                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Content</label>
                        <textarea
                          value={form.content}
                          onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                          rows={6}
                          placeholder="Write everything Verz should know about this topic. Be detailed."
                          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 resize-none bg-white"
                        />
                      </div>
                      <div className="flex items-center gap-3 pt-1">
                        <button onClick={saveArticle} className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded-lg transition-colors">
                          <Save size={12} />
                          {editingId === 'new' ? 'Add Article' : 'Save Changes'}
                        </button>
                        <button onClick={() => setEditingId(null)} className="flex items-center gap-1.5 px-3 py-2 text-gray-500 hover:text-gray-700 text-xs font-medium transition-colors">
                          <X size={12} />
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {kbArticles.length === 0 ? (
                  <div className="py-14 text-center px-6">
                    <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                      <BookOpen size={20} className="text-gray-400" />
                    </div>
                    <p className="text-sm font-medium text-gray-700 mb-1">No articles yet</p>
                    <p className="text-xs text-gray-500 max-w-xs mx-auto leading-relaxed">
                      Add articles about your business — FAQs, policies, hours, pricing. Upload a PDF or paste a URL to get started fast.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {kbArticles.map(a => (
                      <ArticleRow
                        key={a.id}
                        article={a}
                        onToggle={() => void toggleArticle(a)}
                        onEdit={() => openEdit(a)}
                        onDelete={() => void deleteArticle(a.id)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ── AI-LEARNED TAB ── */}
            {activeTab === 'learned' && (
              <>
                <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    {learnedArticles.length > 0 && (
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-teal-600 cursor-pointer"
                        checked={selectedLearnedIds.size === learnedArticles.length && learnedArticles.length > 0}
                        onChange={e => setSelectedLearnedIds(e.target.checked ? new Set(learnedArticles.map(a => a.id)) : new Set())}
                        title="Select all"
                      />
                    )}
                    <p className="text-xs text-gray-500">Verz analyses your agent conversations and extracts recurring patterns</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedLearnedIds.size > 0 && (
                      <button
                        onClick={() => downloadLearnedArticles(selectedLearnedIds)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 text-white hover:bg-teal-700 text-xs font-semibold rounded-lg transition-colors"
                      >
                        <Download size={12} />
                        Download ({selectedLearnedIds.size})
                      </button>
                    )}
                    {learnedArticles.length > 1 && (
                      <button
                        onClick={() => void cleanDuplicates()}
                        disabled={deduplicating}
                        className="flex items-center gap-1.5 px-3 py-1.5 border border-orange-200 text-orange-700 hover:bg-orange-50 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                      >
                        {deduplicating
                          ? <span className="w-3 h-3 border border-orange-500 border-t-transparent rounded-full animate-spin" />
                          : <Eraser size={12} />
                        }
                        {deduplicating ? 'Cleaning…' : 'Clean Duplicates'}
                      </button>
                    )}
                    <button
                      onClick={() => void learnFromConversations()}
                      disabled={learning}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-teal-200 text-teal-700 hover:bg-teal-50 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                    >
                      {learning
                        ? <span className="w-3 h-3 border border-teal-500 border-t-transparent rounded-full animate-spin" />
                        : <RefreshCw size={12} />
                      }
                      {learning ? 'Learning…' : 'Learn Now'}
                    </button>
                  </div>
                </div>

                {learnedArticles.length === 0 ? (
                  <div className="py-14 text-center px-6">
                    <div className="w-12 h-12 bg-teal-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
                      <Sparkles size={20} className="text-teal-400" />
                    </div>
                    <p className="text-sm font-medium text-gray-700 mb-1">Nothing learned yet</p>
                    <p className="text-xs text-gray-500 max-w-xs mx-auto leading-relaxed">
                      Click &ldquo;Learn Now&rdquo; to have Verz scan the last 30 days of agent conversations and build knowledge articles automatically.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {learnedArticles.map(a => (
                      <ArticleRow
                        key={a.id}
                        article={a}
                        onToggle={() => void toggleArticle(a)}
                        onEdit={() => { setActiveTab('kb'); openEdit(a); }}
                        onDelete={() => void deleteArticle(a.id)}
                        isSelected={selectedLearnedIds.has(a.id)}
                        onSelect={() => setSelectedLearnedIds(prev => {
                          const next = new Set(prev);
                          next.has(a.id) ? next.delete(a.id) : next.add(a.id);
                          return next;
                        })}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ── ANALYTICS TAB ── */}
            {activeTab === 'analytics' && (
              <div className="p-5">
                {analyticsLoading ? (
                  <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600" /></div>
                ) : !analytics || analytics.total === 0 ? (
                  <div className="py-14 text-center">
                    <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-3"><BarChart2 size={20} className="text-gray-300" /></div>
                    <p className="text-sm font-medium text-gray-600 mb-1">No data yet</p>
                    <p className="text-xs text-gray-400">AI analytics will appear here once Verz starts suggesting or sending replies.</p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {/* KPI cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[
                        { label: 'Total Suggestions', value: analytics.total, color: 'text-gray-900' },
                        { label: 'Approval Rate', value: `${analytics.approvalRate}%`, color: 'text-green-600' },
                        { label: 'Edit Rate', value: `${analytics.editRate}%`, color: 'text-blue-600' },
                        { label: 'Rejection Rate', value: `${analytics.rejectionRate}%`, color: 'text-red-500' },
                        { label: 'Avg Response Time', value: analytics.avgResponseMs !== null ? `${(analytics.avgResponseMs / 1000).toFixed(1)}s` : '—', color: 'text-gray-700' },
                        { label: 'Avg Rating', value: analytics.avgRating !== null ? `${analytics.avgRating}/5` : '—', color: 'text-yellow-500' },
                        { label: 'Avg Confidence', value: analytics.avgConfidence !== null ? `${analytics.avgConfidence}%` : '—', color: analytics.avgConfidence !== null && analytics.avgConfidence < 70 ? 'text-orange-500' : 'text-teal-600' },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-gray-50 rounded-xl p-3">
                          <p className="text-[11px] text-gray-500 mb-1">{label}</p>
                          <p className={`text-xl font-bold ${color}`}>{String(value)}</p>
                        </div>
                      ))}
                    </div>

                    {/* Daily usage chart */}
                    {analytics.dailyUsage.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-gray-600 mb-3">Daily AI Suggestions (last 30 days)</p>
                        <ResponsiveContainer width="100%" height={160}>
                          <BarChart data={analytics.dailyUsage} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                            <Tooltip
                              labelFormatter={l => String(l)}
                              formatter={(v: unknown) => [String(v), 'Suggestions']}
                              contentStyle={{ fontSize: 12 }}
                            />
                            <Bar dataKey="count" fill="#0d9488" radius={[3,3,0,0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* How it works */}
          <div className="bg-teal-50 border border-teal-100 rounded-2xl p-5">
            <p className="text-xs font-bold text-teal-700 uppercase tracking-wider mb-3">How it works</p>
            <div className="grid sm:grid-cols-3 gap-4">
              {[
                { step: '1', title: 'Customer messages', desc: 'A customer sends a WhatsApp message outside business hours (or any time if Always On)' },
                { step: '2', title: 'Verz searches KB', desc: 'Verz reads your knowledge base and crafts a relevant, natural reply' },
                { step: '3', title: 'Instant reply', desc: "Customer gets an answer in seconds. If Verz can't help, it lets them know a team member will follow up" },
              ].map(({ step, title, desc }) => (
                <div key={step} className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-teal-600 text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">{step}</div>
                  <div>
                    <p className="text-xs font-semibold text-teal-900 mb-0.5">{title}</p>
                    <p className="text-xs text-teal-700/80 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* Enable Verz modal */}
      {showLearnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
                <Brain size={20} className="text-violet-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">Enable Verz?</p>
                <p className="text-xs text-gray-500 mt-0.5">Your AI agent is ready to go</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed mb-5">
              Would you like Verz to analyse the last 30 days of conversations between your agents and customers to build its knowledge base automatically?
            </p>
            <div className="space-y-2">
              <button
                disabled={learning || savingSettings}
                onClick={async () => {
                  setShowLearnModal(false);
                  await saveSettings({ aiEnabled: true });
                  void learnFromConversations();
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {(learning || savingSettings)
                  ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : 'Enable and learn from conversations'
                }
              </button>
              <button
                disabled={savingSettings}
                onClick={async () => {
                  setShowLearnModal(false);
                  await saveSettings({ aiEnabled: true });
                }}
                className="w-full px-4 py-2.5 border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium rounded-xl transition-colors"
              >
                Enable without learning
              </button>
              <button
                onClick={() => setShowLearnModal(false)}
                className="w-full px-4 py-2.5 text-gray-400 hover:text-gray-600 text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ArticleRow({
  article: a,
  onToggle,
  onEdit,
  onDelete,
  isSelected,
  onSelect,
}: {
  article: Article;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isSelected?: boolean;
  onSelect?: () => void;
}) {
  const src = SOURCE_LABELS[a.source] ?? SOURCE_LABELS.manual;
  return (
    <div className="flex items-start gap-3 px-5 py-4 hover:bg-gray-50 transition-colors">
      {onSelect !== undefined && (
        <input
          type="checkbox"
          checked={isSelected ?? false}
          onChange={onSelect}
          className="rounded border-gray-300 text-teal-600 cursor-pointer mt-1 flex-shrink-0"
        />
      )}
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${a.isActive ? 'bg-teal-50' : 'bg-gray-100'}`}>
        {a.source === 'upload' ? (
          <FileText size={14} className={a.isActive ? 'text-teal-600' : 'text-gray-400'} />
        ) : a.source === 'url' ? (
          <Globe size={14} className={a.isActive ? 'text-teal-600' : 'text-gray-400'} />
        ) : a.source === 'learned' ? (
          <Sparkles size={14} className={a.isActive ? 'text-teal-600' : 'text-gray-400'} />
        ) : (
          <BookOpen size={14} className={a.isActive ? 'text-teal-600' : 'text-gray-400'} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <p className="text-sm font-semibold text-gray-900 truncate">{a.title}</p>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${src.color}`}>{src.label}</span>
          {!a.isActive && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full flex-shrink-0">Disabled</span>}
        </div>
        <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{a.content}</p>
        {a.sourceRef && (
          <p className="text-[10px] text-gray-400 mt-0.5 truncate">{a.sourceRef}</p>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onToggle}
          title={a.isActive ? 'Disable' : 'Enable'}
          className="p-1.5 text-gray-400 hover:text-teal-600 rounded-lg hover:bg-teal-50 transition-colors"
        >
          {a.isActive ? <ToggleRight size={16} className="text-teal-600" /> : <ToggleLeft size={16} />}
        </button>
        <button
          onClick={onEdit}
          className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
        >
          <Edit2 size={13} />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
