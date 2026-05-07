'use client';
import { useEffect, useState } from 'react';
import { Plus, Zap, ToggleLeft, ToggleRight, Trash2, X } from 'lucide-react';
import { automationApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

interface Condition {
  field: string;
  operator: 'equals' | 'contains' | 'starts_with' | 'ends_with' | 'matches';
  value: string;
}

interface Action {
  type: string;
  payload: Record<string, string>;
}

interface AutomationRule {
  id: string;
  name: string;
  isActive: boolean;
  trigger: string;
  conditions: Condition[];
  actions: Action[];
  executionCount: number;
  priority: number;
}

const TRIGGERS: Record<string, string> = {
  KEYWORD: 'Keyword Match',
  FIRST_MESSAGE: 'First Message',
  CONVERSATION_CREATED: 'Conversation Created',
  CONVERSATION_RESOLVED: 'Conversation Resolved',
  LABEL_ADDED: 'Label Added',
};

const CONDITION_FIELDS = [
  { value: 'message_content', label: 'Message Content' },
  { value: 'contact_phone', label: 'Contact Phone' },
  { value: 'contact_name', label: 'Contact Name' },
];

const OPERATORS = [
  { value: 'contains', label: 'Contains' },
  { value: 'equals', label: 'Equals' },
  { value: 'starts_with', label: 'Starts With' },
  { value: 'ends_with', label: 'Ends With' },
  { value: 'matches', label: 'Matches Regex' },
];

const ACTION_TYPES = [
  { value: 'SEND_MESSAGE', label: 'Send Message' },
  { value: 'ASSIGN_AGENT', label: 'Assign Agent' },
  { value: 'ADD_LABEL', label: 'Add Label' },
  { value: 'RESOLVE_CONVERSATION', label: 'Resolve Conversation' },
];

const emptyCondition = (): Condition => ({ field: 'message_content', operator: 'contains', value: '' });
const emptyAction = (): Action => ({ type: 'SEND_MESSAGE', payload: { message: '' } });

function ActionPayloadFields({ action, onChange }: { action: Action; onChange: (payload: Record<string, string>) => void }) {
  switch (action.type) {
    case 'SEND_MESSAGE':
      return (
        <textarea
          placeholder="Message to send..."
          value={action.payload['message'] ?? ''}
          onChange={(e) => onChange({ message: e.target.value })}
          rows={2}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
        />
      );
    case 'ASSIGN_AGENT':
      return (
        <input
          type="text"
          placeholder="Agent ID"
          value={action.payload['agentId'] ?? ''}
          onChange={(e) => onChange({ agentId: e.target.value })}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      );
    case 'ADD_LABEL':
      return (
        <input
          type="text"
          placeholder="Label name (e.g. vip)"
          value={action.payload['label'] ?? ''}
          onChange={(e) => onChange({ label: e.target.value })}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      );
    case 'RESOLVE_CONVERSATION':
      return <p className="text-xs text-gray-400 px-1">No additional config needed.</p>;
    default:
      return null;
  }
}

export default function AutomationPage() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    trigger: 'KEYWORD',
    priority: 0,
    conditions: [emptyCondition()],
    actions: [emptyAction()],
  });

  const load = async () => {
    setLoading(true);
    try {
      const res = await automationApi.list();
      setRules(res.data as AutomationRule[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const resetForm = () => {
    setForm({ name: '', trigger: 'KEYWORD', priority: 0, conditions: [emptyCondition()], actions: [emptyAction()] });
  };

  const createRule = async () => {
    if (!form.name.trim()) return toast.error('Rule name is required');
    if (form.actions.some((a) => a.type === 'SEND_MESSAGE' && !a.payload['message']?.trim())) {
      return toast.error('Message content is required for Send Message actions');
    }
    try {
      await automationApi.create({
        name: form.name,
        trigger: form.trigger,
        priority: form.priority,
        conditions: form.conditions.filter((c) => c.value.trim()),
        actions: form.actions,
      });
      setShowCreate(false);
      resetForm();
      await load();
      toast.success('Automation rule created');
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Failed'
        : 'Failed';
      toast.error(typeof msg === 'string' ? msg : 'Failed to create rule');
    }
  };

  const toggle = async (rule: AutomationRule) => {
    try {
      await automationApi.update(rule.id, { isActive: !rule.isActive });
      setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, isActive: !r.isActive } : r));
      toast.success(rule.isActive ? 'Rule disabled' : 'Rule enabled');
    } catch { toast.error('Failed to update rule'); }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this automation rule?')) return;
    try {
      await automationApi.delete(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
      toast.success('Rule deleted');
    } catch { toast.error('Failed to delete rule'); }
  };

  const updateCondition = (i: number, patch: Partial<Condition>) => {
    setForm((f) => ({ ...f, conditions: f.conditions.map((c, idx) => idx === i ? { ...c, ...patch } : c) }));
  };

  const updateAction = (i: number, patch: Partial<Action>) => {
    setForm((f) => ({ ...f, actions: f.actions.map((a, idx) => idx === i ? { ...a, ...patch } : a) }));
  };

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Automation</h1>
            <p className="text-sm text-gray-500">Automate responses and workflows</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Plus size={16} />
            New Rule
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex justify-center pt-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" /></div>
        ) : rules.length === 0 ? (
          <div className="text-center pt-16 text-gray-400">
            <Zap size={48} className="mx-auto mb-3 opacity-30" />
            <p className="text-lg font-medium">No automation rules yet</p>
            <p className="text-sm">Create rules to automate your team&apos;s workflow</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rules.map((rule) => (
              <div key={rule.id} className={cn('bg-white border rounded-xl p-5 transition-colors', rule.isActive ? 'border-green-200' : 'border-gray-200')}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900">{rule.name}</h3>
                      {rule.isActive
                        ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Active</span>
                        : <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Inactive</span>
                      }
                    </div>
                    <p className="text-sm text-gray-500">
                      Trigger: <span className="font-medium text-gray-700">{TRIGGERS[rule.trigger] ?? rule.trigger}</span>
                    </p>
                    {rule.conditions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {rule.conditions.map((c, i) => (
                          <span key={i} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                            {c.field} {c.operator} &quot;{c.value}&quot;
                          </span>
                        ))}
                      </div>
                    )}
                    {rule.actions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {rule.actions.map((a, i) => (
                          <span key={i} className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
                            {ACTION_TYPES.find((t) => t.value === a.type)?.label ?? a.type}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-gray-400 mt-2">Executed {rule.executionCount} times · Priority {rule.priority}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <button onClick={() => { void toggle(rule); }} className={cn('transition-colors', rule.isActive ? 'text-green-600 hover:text-green-700' : 'text-gray-400 hover:text-gray-600')}>
                      {rule.isActive ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                    </button>
                    <button onClick={() => { void remove(rule.id); }} className="text-gray-400 hover:text-red-600 transition-colors">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white">
              <h2 className="text-lg font-semibold text-gray-900">New Automation Rule</h2>
              <button onClick={() => { setShowCreate(false); resetForm(); }} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rule Name</label>
                <input
                  type="text"
                  placeholder="e.g. Auto-reply to keyword"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Trigger</label>
                  <select
                    value={form.trigger}
                    onChange={(e) => setForm((f) => ({ ...f, trigger: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    {Object.entries(TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <input
                    type="number"
                    min={0}
                    value={form.priority}
                    onChange={(e) => setForm((f) => ({ ...f, priority: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Conditions <span className="text-gray-400 font-normal">(all must match)</span></label>
                  <button
                    onClick={() => setForm((f) => ({ ...f, conditions: [...f.conditions, emptyCondition()] }))}
                    className="text-xs text-green-600 hover:text-green-700 font-medium"
                  >
                    + Add condition
                  </button>
                </div>
                <div className="space-y-2">
                  {form.conditions.map((c, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <select
                        value={c.field}
                        onChange={(e) => updateCondition(i, { field: e.target.value })}
                        className="px-2 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                      >
                        {CONDITION_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                      <select
                        value={c.operator}
                        onChange={(e) => updateCondition(i, { operator: e.target.value as Condition['operator'] })}
                        className="px-2 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                      >
                        {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <input
                        type="text"
                        placeholder="Value..."
                        value={c.value}
                        onChange={(e) => updateCondition(i, { value: e.target.value })}
                        className="flex-1 px-2 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                      {form.conditions.length > 1 && (
                        <button onClick={() => setForm((f) => ({ ...f, conditions: f.conditions.filter((_, idx) => idx !== i) }))} className="text-gray-400 hover:text-red-500 mt-2">
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Actions</label>
                  <button
                    onClick={() => setForm((f) => ({ ...f, actions: [...f.actions, emptyAction()] }))}
                    className="text-xs text-green-600 hover:text-green-700 font-medium"
                  >
                    + Add action
                  </button>
                </div>
                <div className="space-y-3">
                  {form.actions.map((a, i) => (
                    <div key={i} className="border border-gray-100 rounded-lg p-3 bg-gray-50">
                      <div className="flex items-center gap-2 mb-2">
                        <select
                          value={a.type}
                          onChange={(e) => updateAction(i, { type: e.target.value, payload: {} })}
                          className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                        >
                          {ACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                        {form.actions.length > 1 && (
                          <button onClick={() => setForm((f) => ({ ...f, actions: f.actions.filter((_, idx) => idx !== i) }))} className="text-gray-400 hover:text-red-500">
                            <X size={14} />
                          </button>
                        )}
                      </div>
                      <ActionPayloadFields action={a} onChange={(payload) => updateAction(i, { payload })} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2 px-6 pb-6">
              <button onClick={() => { setShowCreate(false); resetForm(); }} className="flex-1 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => { void createRule(); }} className="flex-1 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700">Create Rule</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
