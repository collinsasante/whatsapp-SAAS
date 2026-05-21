"use client";
import { useEffect, useState } from "react";
import {
  Plus,
  Zap,
  ToggleLeft,
  ToggleRight,
  Trash2,
  X,
  Edit2,
  ArrowRight,
  MessageSquare,
  UserCheck,
  Tag,
  CheckCircle,
  Clock,
  Link,
  FileText,
  ChevronDown,
  ChevronUp,
  Play,
} from "lucide-react";
import { automationApi } from "@/lib/api";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";

interface Condition {
  field: string;
  operator: "equals" | "contains" | "starts_with" | "ends_with" | "matches";
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
  createdAt?: string;
}

const TRIGGERS: Record<
  string,
  { label: string; description: string; color: string }
> = {
  KEYWORD: {
    label: "Keyword Match",
    description: "When message contains a keyword",
    color: "bg-blue-100 text-blue-700 border-blue-200",
  },
  FIRST_MESSAGE: {
    label: "First Message",
    description: "When a contact messages for the first time",
    color: "bg-purple-100 text-purple-700 border-purple-200",
  },
  CONVERSATION_CREATED: {
    label: "Conversation Created",
    description: "When a new conversation starts",
    color: "bg-teal-100 text-teal-700 border-teal-200",
  },
  CONVERSATION_RESOLVED: {
    label: "Conversation Resolved",
    description: "When a conversation is closed",
    color: "bg-green-100 text-green-700 border-green-200",
  },
  LABEL_ADDED: {
    label: "Label Added",
    description: "When a label is added to conversation",
    color: "bg-orange-100 text-orange-700 border-orange-200",
  },
  NO_REPLY_TIMEOUT: {
    label: "No Reply Timeout",
    description: "When no agent reply after X minutes",
    color: "bg-red-100 text-red-700 border-red-200",
  },
  CAMPAIGN_RESPONSE: {
    label: "Campaign Response",
    description: "When contact replies to a campaign",
    color: "bg-yellow-100 text-yellow-700 border-yellow-200",
  },
};

const ACTION_ICONS: Record<string, React.ReactNode> = {
  SEND_MESSAGE: <MessageSquare size={12} />,
  ASSIGN_AGENT: <UserCheck size={12} />,
  ADD_LABEL: <Tag size={12} />,
  RESOLVE_CONVERSATION: <CheckCircle size={12} />,
  SEND_TEMPLATE: <FileText size={12} />,
  WEBHOOK_CALL: <Link size={12} />,
  WAIT_DELAY: <Clock size={12} />,
};

const ACTION_TYPES = [
  { value: "SEND_MESSAGE", label: "Send Message" },
  { value: "ASSIGN_AGENT", label: "Assign Agent" },
  { value: "ADD_LABEL", label: "Add Label" },
  { value: "RESOLVE_CONVERSATION", label: "Close Conversation" },
  { value: "SEND_TEMPLATE", label: "Send Template" },
  { value: "WEBHOOK_CALL", label: "Webhook Call" },
  { value: "WAIT_DELAY", label: "Wait Delay (minutes)" },
];

const CONDITION_FIELDS = [
  { value: "message_content", label: "Message Content" },
  { value: "contact_phone", label: "Contact Phone" },
  { value: "contact_name", label: "Contact Name" },
  { value: "label", label: "Label" },
];

const OPERATORS = [
  { value: "contains", label: "contains" },
  { value: "equals", label: "equals" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "matches", label: "matches regex" },
];

const emptyCondition = (): Condition => ({
  field: "message_content",
  operator: "contains",
  value: "",
});
const emptyAction = (): Action => ({
  type: "SEND_MESSAGE",
  payload: { message: "" },
});

function ActionPayloadFields({
  action,
  onChange,
}: {
  action: Action;
  onChange: (p: Record<string, string>) => void;
}) {
  switch (action.type) {
    case "SEND_MESSAGE":
      return (
        <textarea
          placeholder="Message to send..."
          value={action.payload["message"] ?? ""}
          onChange={(e) => onChange({ message: e.target.value })}
          rows={2}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
        />
      );
    case "ASSIGN_AGENT":
      return (
        <input
          type="text"
          placeholder="Agent ID"
          value={action.payload["agentId"] ?? ""}
          onChange={(e) => onChange({ agentId: e.target.value })}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      );
    case "ADD_LABEL":
      return (
        <input
          type="text"
          placeholder="Label name (e.g. vip)"
          value={action.payload["label"] ?? ""}
          onChange={(e) => onChange({ label: e.target.value })}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      );
    case "RESOLVE_CONVERSATION":
      return (
        <p className="text-xs text-gray-400 px-1">
          No additional configuration needed.
        </p>
      );
    case "SEND_TEMPLATE":
      return (
        <input
          type="text"
          placeholder="Template ID"
          value={action.payload["templateId"] ?? ""}
          onChange={(e) => onChange({ templateId: e.target.value })}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      );
    case "WEBHOOK_CALL":
      return (
        <div className="space-y-2">
          <input
            type="text"
            placeholder="Webhook URL (https://...)"
            value={action.payload["url"] ?? ""}
            onChange={(e) =>
              onChange({ ...action.payload, url: e.target.value })
            }
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <select
            value={action.payload["method"] ?? "POST"}
            onChange={(e) =>
              onChange({ ...action.payload, method: e.target.value })
            }
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="POST">POST</option>
            <option value="GET">GET</option>
          </select>
        </div>
      );
    case "WAIT_DELAY":
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            placeholder="Minutes"
            value={action.payload["minutes"] ?? ""}
            onChange={(e) => onChange({ minutes: e.target.value })}
            className="w-32 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <span className="text-sm text-gray-500">minutes delay</span>
        </div>
      );
    default:
      return null;
  }
}

function RuleCard({
  rule,
  onToggle,
  onEdit,
  onDelete,
}: {
  rule: AutomationRule;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const trigger = TRIGGERS[rule.trigger];

  return (
    <div
      className={cn(
        "bg-white border rounded-xl transition-all",
        rule.isActive ? "border-teal-200" : "border-gray-200",
      )}
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div
              className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
                rule.isActive ? "bg-teal-100" : "bg-gray-100",
              )}
            >
              <Zap
                size={16}
                className={rule.isActive ? "text-teal-600" : "text-gray-400"}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-gray-900">{rule.name}</h3>
                <span
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full font-medium",
                    rule.isActive
                      ? "bg-teal-100 text-teal-700"
                      : "bg-gray-100 text-gray-500",
                  )}
                >
                  {rule.isActive ? "Active" : "Inactive"}
                </span>
                {rule.priority > 0 && (
                  <span className="text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full">
                    Priority {rule.priority}
                  </span>
                )}
              </div>

              {/* Visual flow */}
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <span
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-lg border font-medium flex items-center gap-1.5",
                    trigger?.color ??
                      "bg-gray-100 text-gray-600 border-gray-200",
                  )}
                >
                  <Play size={10} />
                  {trigger?.label ?? rule.trigger}
                </span>

                {rule.conditions.length > 0 && (
                  <>
                    <ArrowRight
                      size={12}
                      className="text-gray-300 flex-shrink-0"
                    />
                    <div className="flex items-center gap-1 flex-wrap">
                      {rule.conditions.slice(0, 2).map((c, i) => (
                        <span
                          key={i}
                          className="text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2 py-1 rounded-lg"
                        >
                          {c.field} {c.operator} &ldquo;{c.value}&rdquo;
                        </span>
                      ))}
                      {rule.conditions.length > 2 && (
                        <span className="text-xs text-gray-400">
                          +{rule.conditions.length - 2}
                        </span>
                      )}
                    </div>
                  </>
                )}

                {rule.actions.length > 0 && (
                  <>
                    <ArrowRight
                      size={12}
                      className="text-gray-300 flex-shrink-0"
                    />
                    <div className="flex items-center gap-1 flex-wrap">
                      {rule.actions.map((a, i) => (
                        <span
                          key={i}
                          className="text-xs bg-purple-50 text-purple-700 border border-purple-100 px-2 py-1 rounded-lg flex items-center gap-1"
                        >
                          {ACTION_ICONS[a.type]}
                          {ACTION_TYPES.find((t) => t.value === a.type)
                            ?.label ?? a.type}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <p className="text-xs text-gray-400 mt-2">
                {rule.executionCount} executions
                {rule.conditions.length > 0 &&
                  ` · ${rule.conditions.length} condition${rule.conditions.length !== 1 ? "s" : ""}`}
                {rule.actions.length > 0 &&
                  ` · ${rule.actions.length} action${rule.actions.length !== 1 ? "s" : ""}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={onToggle}
              title={rule.isActive ? "Disable rule" : "Enable rule"}
              className={cn(
                "transition-colors p-1",
                rule.isActive
                  ? "text-teal-600 hover:text-teal-700"
                  : "text-gray-400 hover:text-gray-600",
              )}
            >
              {rule.isActive ? (
                <ToggleRight size={24} />
              ) : (
                <ToggleLeft size={24} />
              )}
            </button>
            <button
              onClick={onEdit}
              className="p-1.5 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
            >
              <Edit2 size={14} />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 rounded-b-xl space-y-3">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Trigger
            </p>
            <div className="text-sm text-gray-700">
              <span
                className={cn(
                  "text-xs px-2.5 py-1 rounded-lg border font-medium",
                  trigger?.color ?? "bg-gray-100 text-gray-600 border-gray-200",
                )}
              >
                {trigger?.label ?? rule.trigger}
              </span>
              {trigger?.description && (
                <span className="text-xs text-gray-500 ml-2">
                  {trigger.description}
                </span>
              )}
            </div>
          </div>
          {rule.conditions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Conditions (all must match)
              </p>
              <div className="space-y-1">
                {rule.conditions.map((c, i) => (
                  <div
                    key={i}
                    className="text-xs text-gray-600 bg-white border border-gray-200 px-3 py-1.5 rounded-lg"
                  >
                    <span className="font-medium">{c.field}</span> {c.operator}{" "}
                    &ldquo;<span className="text-teal-700">{c.value}</span>
                    &rdquo;
                  </div>
                ))}
              </div>
            </div>
          )}
          {rule.actions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Actions
              </p>
              <div className="space-y-1">
                {rule.actions.map((a, i) => (
                  <div
                    key={i}
                    className="text-xs text-gray-600 bg-white border border-gray-200 px-3 py-1.5 rounded-lg flex items-center gap-2"
                  >
                    <span className="text-purple-600">
                      {ACTION_ICONS[a.type]}
                    </span>
                    <span className="font-medium">
                      {ACTION_TYPES.find((t) => t.value === a.type)?.label ??
                        a.type}
                    </span>
                    {a.payload && Object.entries(a.payload).length > 0 && (
                      <span className="text-gray-400">
                        {Object.entries(a.payload)
                          .map(([k, v]) => `${k}: "${v}"`)
                          .join(", ")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type FormState = {
  name: string;
  trigger: string;
  priority: number;
  conditions: Condition[];
  actions: Action[];
};

export default function AutomationPage() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    name: "",
    trigger: "KEYWORD",
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

  useEffect(() => {
    void load();
  }, []);

  const resetForm = () => {
    setForm({
      name: "",
      trigger: "KEYWORD",
      priority: 0,
      conditions: [emptyCondition()],
      actions: [emptyAction()],
    });
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setShowModal(true);
  };

  const openEdit = (rule: AutomationRule) => {
    setForm({
      name: rule.name,
      trigger: rule.trigger,
      priority: rule.priority,
      conditions:
        rule.conditions.length > 0 ? rule.conditions : [emptyCondition()],
      actions: rule.actions.length > 0 ? rule.actions : [emptyAction()],
    });
    setEditingId(rule.id);
    setShowModal(true);
  };

  const saveRule = async () => {
    if (!form.name.trim()) return toast.error("Rule name is required");
    if (
      form.actions.some(
        (a) => a.type === "SEND_MESSAGE" && !a.payload["message"]?.trim(),
      )
    ) {
      return toast.error(
        "Message content is required for Send Message actions",
      );
    }
    const payload = {
      name: form.name,
      trigger: form.trigger,
      priority: form.priority,
      conditions: form.conditions.filter((c) => c.value.trim()),
      actions: form.actions,
    };
    try {
      if (editingId) {
        await automationApi.update(editingId, payload);
        toast.success("Rule updated");
      } else {
        await automationApi.create(payload);
        toast.success("Automation rule created");
      }
      setShowModal(false);
      resetForm();
      await load();
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { message?: string } } }).response
              ?.data?.message
          : undefined;
      toast.error(typeof msg === "string" ? msg : "Failed to save rule");
    }
  };

  const toggle = async (rule: AutomationRule) => {
    try {
      await automationApi.update(rule.id, { isActive: !rule.isActive });
      setRules((prev) =>
        prev.map((r) =>
          r.id === rule.id ? { ...r, isActive: !r.isActive } : r,
        ),
      );
      toast.success(rule.isActive ? "Rule disabled" : "Rule enabled");
    } catch {
      toast.error("Failed to update rule");
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this automation rule? This cannot be undone.")) return;
    try {
      await automationApi.delete(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
      toast.success("Rule deleted");
    } catch {
      toast.error("Failed to delete rule");
    }
  };

  const updateCondition = (i: number, patch: Partial<Condition>) =>
    setForm((f) => ({
      ...f,
      conditions: f.conditions.map((c, idx) =>
        idx === i ? { ...c, ...patch } : c,
      ),
    }));

  const updateAction = (i: number, patch: Partial<Action>) =>
    setForm((f) => ({
      ...f,
      actions: f.actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)),
    }));

  const activeCount = rules.filter((r) => r.isActive).length;
  const totalExecutions = rules.reduce(
    (s, r) => s + (r.executionCount ?? 0),
    0,
  );

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Automation</h1>
            <p className="text-sm text-gray-500">
              Build rules to automate responses and workflows
            </p>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
          >
            <Plus size={16} />
            New Rule
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 px-6 py-4">
        {[
          { label: "Total Rules", value: rules.length },
          { label: "Active Rules", value: activeCount },
          {
            label: "Total Executions",
            value: totalExecutions.toLocaleString(),
          },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white border border-gray-200 rounded-xl p-4"
          >
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-sm text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Rules list */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        {loading ? (
          <div className="flex justify-center pt-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
          </div>
        ) : rules.length === 0 ? (
          <div className="text-center pt-16 text-gray-400">
            <Zap size={48} className="mx-auto mb-3 opacity-30" />
            <p className="text-lg font-medium">No automation rules yet</p>
            <p className="text-sm mb-6">
              Create rules to automate your team&apos;s workflow
            </p>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
            >
              <Plus size={16} />
              Create First Rule
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {rules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                onToggle={() => {
                  void toggle(rule);
                }}
                onEdit={() => openEdit(rule)}
                onDelete={() => {
                  void remove(rule.id);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-xl z-10">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingId ? "Edit Rule" : "New Automation Rule"}
              </h2>
              <button
                onClick={() => {
                  setShowModal(false);
                  resetForm();
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Rule Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Auto-reply to greeting"
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* Trigger + Priority */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Trigger
                  </label>
                  <select
                    value={form.trigger}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, trigger: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    {Object.entries(TRIGGERS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                  {TRIGGERS[form.trigger] && (
                    <p className="text-xs text-gray-400 mt-1">
                      {TRIGGERS[form.trigger].description}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Priority
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={form.priority}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        priority: parseInt(e.target.value) || 0,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Higher runs first
                  </p>
                </div>
              </div>

              {/* Conditions */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <label className="text-sm font-medium text-gray-700">
                      Conditions
                    </label>
                    <span className="text-xs text-gray-400 ml-1">
                      (all must match)
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        conditions: [...f.conditions, emptyCondition()],
                      }))
                    }
                    className="text-xs text-teal-600 hover:text-teal-700 font-medium"
                  >
                    + Add condition
                  </button>
                </div>
                <div className="space-y-2">
                  {form.conditions.map((c, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <select
                        value={c.field}
                        onChange={(e) =>
                          updateCondition(i, { field: e.target.value })
                        }
                        className="px-2 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                      >
                        {CONDITION_FIELDS.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={c.operator}
                        onChange={(e) =>
                          updateCondition(i, {
                            operator: e.target.value as Condition["operator"],
                          })
                        }
                        className="px-2 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                      >
                        {OPERATORS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        placeholder="Value..."
                        value={c.value}
                        onChange={(e) =>
                          updateCondition(i, { value: e.target.value })
                        }
                        className="flex-1 px-2 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                      {form.conditions.length > 1 && (
                        <button
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              conditions: f.conditions.filter(
                                (_, idx) => idx !== i,
                              ),
                            }))
                          }
                          className="text-gray-400 hover:text-red-500"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">
                    Actions <span className="text-red-500">*</span>
                  </label>
                  <button
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        actions: [...f.actions, emptyAction()],
                      }))
                    }
                    className="text-xs text-teal-600 hover:text-teal-700 font-medium"
                  >
                    + Add action
                  </button>
                </div>
                <div className="space-y-3">
                  {form.actions.map((a, i) => (
                    <div
                      key={i}
                      className="border border-gray-200 rounded-xl p-3 bg-gray-50"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs text-gray-500 font-medium w-4 flex-shrink-0">
                          {i + 1}.
                        </span>
                        <select
                          value={a.type}
                          onChange={(e) =>
                            updateAction(i, {
                              type: e.target.value,
                              payload: {},
                            })
                          }
                          className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                        >
                          {ACTION_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                        {form.actions.length > 1 && (
                          <button
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                actions: f.actions.filter(
                                  (_, idx) => idx !== i,
                                ),
                              }))
                            }
                            className="text-gray-400 hover:text-red-500"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                      <ActionPayloadFields
                        action={a}
                        onChange={(payload) => updateAction(i, { payload })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 px-6 pb-6 sticky bottom-0 bg-white border-t border-gray-100 pt-4">
              <button
                onClick={() => {
                  setShowModal(false);
                  resetForm();
                }}
                className="flex-1 py-2.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void saveRule();
                }}
                className="flex-1 py-2.5 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium"
              >
                {editingId ? "Save Changes" : "Create Rule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
