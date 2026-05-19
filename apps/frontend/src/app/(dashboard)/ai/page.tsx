'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Brain, Plus, Edit2, Trash2, ToggleLeft, ToggleRight, Save, X, Clock, Zap, BookOpen, AlertCircle } from 'lucide-react';
import { knowledgeBaseApi, manageSettingsApi } from '@/lib/api';
import toast from 'react-hot-toast';

interface Article {
  id: string;
  title: string;
  content: string;
  isActive: boolean;
  createdAt: string;
}

interface AiSettings {
  aiEnabled: boolean;
  aiAlwaysOn: boolean;
  aiPersonality: string;
  offHoursEnabled: boolean;
}

const DEFAULT_PERSONALITY = 'You are helpful, friendly, and professional. Keep replies concise and conversational — this is WhatsApp, not email.';

export default function AiPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [settings, setSettings] = useState<AiSettings>({ aiEnabled: false, aiAlwaysOn: false, aiPersonality: '', offHoursEnabled: false });
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState({ title: '', content: '', isActive: true });
  const [personality, setPersonality] = useState('');
  const [learning, setLearning] = useState(false);
  const [showLearnModal, setShowLearnModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [kbRes, settingsRes] = await Promise.all([
        knowledgeBaseApi.list(),
        manageSettingsApi.get(),
      ]);
      setArticles(kbRes.data);
      const s = settingsRes.data;
      setSettings({
        aiEnabled: s.aiEnabled ?? false,
        aiAlwaysOn: s.aiAlwaysOn ?? false,
        aiPersonality: s.aiPersonality ?? '',
        offHoursEnabled: s.offHoursEnabled ?? false,
      });
      setPersonality(s.aiPersonality ?? '');
    } catch {
      toast.error('Failed to load AI settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveSettings = async (patch: Partial<AiSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    setSavingSettings(true);
    try {
      await manageSettingsApi.updateAi({
        aiEnabled: next.aiEnabled,
        aiAlwaysOn: next.aiAlwaysOn,
        aiPersonality: next.aiPersonality,
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

  const openNew = () => {
    setForm({ title: '', content: '', isActive: true });
    setEditingId('new');
  };

  const openEdit = (a: Article) => {
    setForm({ title: a.title, content: a.content, isActive: a.isActive });
    setEditingId(a.id);
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
    if (!confirm('Delete this article?')) return;
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
      <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center">
            <Brain size={18} className="text-teal-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Verz</h1>
            <p className="text-xs text-gray-500">Knowledge base + after-hours responder</p>
          </div>
        </div>
        {settings.aiEnabled && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-teal-50 border border-teal-200 rounded-xl">
            <div className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
            <span className="text-xs font-semibold text-teal-700">Verz Active</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">

          {/* AI Settings Card */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Zap size={15} className="text-teal-600" />
              Verz Settings
            </h2>

            <div className="space-y-4">
              {/* Enable toggle */}
              <div className="flex items-center justify-between py-3 border-b border-gray-100">
                <div>
                  <p className="text-sm font-medium text-gray-900">Enable Verz</p>
                  <p className="text-xs text-gray-500 mt-0.5">Verz will automatically reply to customer messages using your knowledge base</p>
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
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => void saveSettings({ aiAlwaysOn: false })}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${!settings.aiAlwaysOn ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <Clock size={15} className={!settings.aiAlwaysOn ? 'text-teal-600' : 'text-gray-400'} />
                          <span className={`text-sm font-semibold ${!settings.aiAlwaysOn ? 'text-teal-700' : 'text-gray-700'}`}>After Hours Only</span>
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed">Verz replies only when your team is offline (based on your off-hours schedule in Manage settings)</p>
                        {!settings.offHoursEnabled && !settings.aiAlwaysOn && (
                          <Link href="/manage?tab=offhours" className="mt-2 flex items-center gap-1 text-amber-600 text-xs hover:text-amber-700 hover:underline">
                            <AlertCircle size={11} />
                            Off-hours schedule not configured — set it up
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
                        <p className="text-xs text-gray-500 leading-relaxed">Verz replies to every inbound message 24/7 (chatbot flows still take priority)</p>
                      </button>
                    </div>
                  </div>

                  {/* Personality */}
                  <div className="py-3">
                    <p className="text-sm font-medium text-gray-900 mb-1.5">AI Personality</p>
                    <p className="text-xs text-gray-500 mb-3">Describe how Verz should communicate with customers</p>
                    <textarea
                      value={personality}
                      onChange={e => setPersonality(e.target.value)}
                      rows={3}
                      placeholder={DEFAULT_PERSONALITY}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 resize-none transition-colors"
                    />
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-gray-400">Leave blank to use the default personality</p>
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

          {/* Knowledge Base */}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen size={15} className="text-teal-600" />
                <h2 className="text-sm font-bold text-gray-900">Knowledge Base</h2>
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{articles.length} articles</span>
              </div>
              <button
                onClick={openNew}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                <Plus size={12} />
                Add Article
              </button>
            </div>

            {/* Article editor inline */}
            {editingId !== null && (
              <div className="p-6 border-b border-gray-100 bg-gray-50">
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
                      placeholder="Write everything Verz should know about this topic. Be detailed — Verz will use this to answer customer questions."
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

            {articles.length === 0 ? (
              <div className="py-16 text-center">
                <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <BookOpen size={22} className="text-gray-400" />
                </div>
                <p className="text-sm font-medium text-gray-700 mb-1">No articles yet</p>
                <p className="text-xs text-gray-500 max-w-sm mx-auto">
                  Add articles about your business — FAQs, policies, hours, pricing. Verz will use these to answer customer questions.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {articles.map(a => (
                  <div key={a.id} className="flex items-start gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${a.isActive ? 'bg-teal-50' : 'bg-gray-100'}`}>
                      <BookOpen size={14} className={a.isActive ? 'text-teal-600' : 'text-gray-400'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-sm font-semibold text-gray-900 truncate">{a.title}</p>
                        {!a.isActive && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full flex-shrink-0">Disabled</span>}
                      </div>
                      <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{a.content}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => void toggleArticle(a)}
                        title={a.isActive ? 'Disable' : 'Enable'}
                        className="p-1.5 text-gray-400 hover:text-teal-600 rounded-lg hover:bg-teal-50 transition-colors"
                      >
                        {a.isActive ? <ToggleRight size={16} className="text-teal-600" /> : <ToggleLeft size={16} />}
                      </button>
                      <button
                        onClick={() => openEdit(a)}
                        className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => void deleteArticle(a.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* How it works */}
          <div className="bg-teal-50 border border-teal-100 rounded-2xl p-5">
            <p className="text-xs font-bold text-teal-700 uppercase tracking-wider mb-3">How it works</p>
            <div className="grid sm:grid-cols-3 gap-4">
              {[
                { step: '1', title: 'Customer messages', desc: 'A customer sends a WhatsApp message outside business hours (or any time if Always On)' },
                { step: '2', title: 'Verz searches KB', desc: 'Verz reads your knowledge base articles and crafts a relevant, natural reply' },
                { step: '3', title: 'Instant reply', desc: 'Customer gets an answer in seconds. If Verz cannot help, it lets them know a team member will follow up' },
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

      {/* Enable Verz modal — offers to learn from conversations */}
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
