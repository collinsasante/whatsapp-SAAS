'use client';

import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import {
  ReactFlow, Background, Controls, Panel, Handle, Position,
  useNodesState, useEdgesState, addEdge, MarkerType, BackgroundVariant,
  useReactFlow, ReactFlowProvider,
  type NodeProps, type Connection, type Node, type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Plus, Bot, Play, Pause, Trash2, Edit2, Save, X, ArrowLeft,
  MessageSquare, FileImage, FileText, Mic, LayoutTemplate as LayoutIcon,
  MousePointer, List, HelpCircle, Clock, GitBranch, Shuffle, Zap, Tag,
  UserCheck, Database, Globe, Mail, Cpu, Brain, Layers, Search,
  LayoutTemplate, ChevronDown, ChevronUp,
} from 'lucide-react';
import { chatbotFlowsApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeData = Record<string, unknown> & {
  label?: string;
  content?: string;
  buttons?: string[];
  delaySeconds?: number;
  condition?: string;
  tag?: string;
  agent?: string;
  field?: string;
  fieldValue?: string;
  url?: string;
  method?: string;
  prompt?: string;
};

interface ChatbotFlow {
  id: string;
  name: string;
  description: string | null;
  trigger: string;
  keywords: string[];
  nodes: { nodes: Node<NodeData>[]; edges: Edge[] } | null;
  isActive: boolean;
  priority: number;
  executionCount: number;
  createdAt: string;
}

interface NodeConfig {
  type: string;
  label: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  group: string;
  description: string;
}

// ─── Node Palette ─────────────────────────────────────────────────────────────

const NODE_GROUPS = ['Messages', 'Interaction', 'Logic', 'CRM', 'Automation', 'AI'] as const;

const NODE_PALETTE: NodeConfig[] = [
  { type: 'text',        label: 'Text Message',   icon: MessageSquare, color: 'text-blue-600',    bg: 'bg-blue-50',    group: 'Messages',    description: 'Send a plain text message' },
  { type: 'image',       label: 'Image',          icon: FileImage,     color: 'text-indigo-600',  bg: 'bg-indigo-50',  group: 'Messages',    description: 'Send image with caption' },
  { type: 'document',    label: 'Document',       icon: FileText,      color: 'text-violet-600',  bg: 'bg-violet-50',  group: 'Messages',    description: 'Send a file or document' },
  { type: 'audio',       label: 'Audio',          icon: Mic,           color: 'text-pink-600',    bg: 'bg-pink-50',    group: 'Messages',    description: 'Send a voice note or audio' },
  { type: 'template',    label: 'WA Template',    icon: LayoutIcon,    color: 'text-rose-600',    bg: 'bg-rose-50',    group: 'Messages',    description: 'Send an approved WA template' },
  { type: 'buttons',     label: 'Quick Replies',  icon: MousePointer,  color: 'text-purple-600',  bg: 'bg-purple-50',  group: 'Interaction', description: 'Up to 3 quick-reply buttons' },
  { type: 'list',        label: 'List Menu',      icon: List,          color: 'text-fuchsia-600', bg: 'bg-fuchsia-50', group: 'Interaction', description: 'Interactive list of items' },
  { type: 'question',    label: 'Ask Question',   icon: HelpCircle,    color: 'text-cyan-600',    bg: 'bg-cyan-50',    group: 'Interaction', description: 'Ask and capture a reply' },
  { type: 'waitReply',   label: 'Wait for Reply', icon: Clock,         color: 'text-sky-600',     bg: 'bg-sky-50',     group: 'Interaction', description: 'Pause and wait for input' },
  { type: 'condition',   label: 'Condition',      icon: GitBranch,     color: 'text-green-600',   bg: 'bg-green-50',   group: 'Logic',       description: 'Branch based on a condition' },
  { type: 'split',       label: 'Random Split',   icon: Shuffle,       color: 'text-lime-600',    bg: 'bg-lime-50',    group: 'Logic',       description: 'A/B test with random split' },
  { type: 'delay',       label: 'Delay',          icon: Clock,         color: 'text-orange-600',  bg: 'bg-orange-50',  group: 'Logic',       description: 'Wait before the next step' },
  { type: 'jump',        label: 'Jump to Flow',   icon: Zap,           color: 'text-yellow-600',  bg: 'bg-yellow-50',  group: 'Logic',       description: 'Redirect to another flow' },
  { type: 'tag',         label: 'Add Tag',        icon: Tag,           color: 'text-teal-600',    bg: 'bg-teal-50',    group: 'CRM',         description: 'Tag the contact' },
  { type: 'assign',      label: 'Assign Agent',   icon: UserCheck,     color: 'text-emerald-600', bg: 'bg-emerald-50', group: 'CRM',         description: 'Assign to a team member' },
  { type: 'updateField', label: 'Update Field',   icon: Database,      color: 'text-green-700',   bg: 'bg-green-50',   group: 'CRM',         description: 'Update a contact attribute' },
  { type: 'webhook',     label: 'Webhook',        icon: Globe,         color: 'text-amber-600',   bg: 'bg-amber-50',   group: 'Automation',  description: 'Send data to a URL' },
  { type: 'email',       label: 'Send Email',     icon: Mail,          color: 'text-red-500',     bg: 'bg-red-50',     group: 'Automation',  description: 'Send an email notification' },
  { type: 'aiResponse',  label: 'AI Reply',       icon: Cpu,           color: 'text-violet-600',  bg: 'bg-violet-50',  group: 'AI',          description: 'Generate a reply with AI' },
  { type: 'aiClassify',  label: 'AI Classifier',  icon: Brain,         color: 'text-purple-700',  bg: 'bg-purple-50',  group: 'AI',          description: 'Classify intent and route' },
];

const NODE_MAP = Object.fromEntries(NODE_PALETTE.map((n) => [n.type, n])) as Record<string, NodeConfig>;

// ─── Template Data ────────────────────────────────────────────────────────────

function mn(id: string, type: string, x: number, y: number, data: NodeData): Node<NodeData> {
  return { id, type, position: { x, y }, data };
}
function me(id: string, source: string, target: string, label?: string): Edge {
  return { id, source, target, label, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' }, style: { stroke: '#94a3b8', strokeWidth: 1.5 } };
}

const FLOW_TEMPLATES = [
  {
    id: 'welcome', name: 'Welcome Flow', category: 'Onboarding', trigger: 'FIRST_MESSAGE', keywords: [] as string[],
    description: 'Greet new customers and present your main menu on first contact',
    nodes: [mn('s','start',250,0,{label:'First Message'}), mn('n1','text',200,110,{label:'Welcome',content:'Hi! 👋 Welcome. How can we help you today?'}), mn('n2','buttons',160,250,{label:'Main Menu',content:'Choose an option:',buttons:['🛍️ Shop','📞 Support','❓ FAQ']}), mn('n3','tag',170,390,{label:'Tag Lead',tag:'new-lead'}), mn('n4','end',210,490,{label:'End'})],
    edges: [me('e1','s','n1'),me('e2','n1','n2'),me('e3','n2','n3'),me('e4','n3','n4')],
  },
  {
    id: 'lead-qual', name: 'Lead Qualification', category: 'Sales', trigger: 'KEYWORD', keywords: ['interested','pricing','quote'],
    description: 'Qualify leads by collecting key info and routing to sales team',
    nodes: [mn('s','start',250,0,{label:'Keyword Trigger'}), mn('n1','text',200,110,{label:'Greeting',content:"Great! Let me get a few details to help you better."}), mn('n2','question',200,230,{label:'Company?',content:'What is your company name?'}), mn('n3','question',200,360,{label:'Budget?',content:'What is your monthly budget range?'}), mn('n4','buttons',160,490,{label:'Urgency',content:'When do you need this?',buttons:['🔥 Urgent - now','📅 Within a month','🔍 Just researching']}), mn('n5','assign',170,620,{label:'Assign Sales',agent:'sales-team'}), mn('n6','end',210,730,{label:'End'})],
    edges: [me('e1','s','n1'),me('e2','n1','n2'),me('e3','n2','n3'),me('e4','n3','n4'),me('e5','n4','n5'),me('e6','n5','n6')],
  },
  {
    id: 'support', name: 'Customer Support', category: 'Support', trigger: 'KEYWORD', keywords: ['help','support','issue','problem'],
    description: 'Triage support requests and route to the right team automatically',
    nodes: [mn('s','start',250,0,{label:'Support Keyword'}), mn('n1','text',200,110,{label:'Ack',"content":"We're here to help! Let us connect you with the right team."}), mn('n2','buttons',160,240,{label:'Issue Type',content:'What can we help with?',buttons:['🔧 Technical','💳 Billing','📦 Orders']}), mn('n3','condition',200,380,{label:'Route',condition:'button_reply'}), mn('n4','assign',30,510,{label:'Tech',agent:'tech-support'}), mn('n5','assign',200,510,{label:'Billing',agent:'billing'}), mn('n6','assign',380,510,{label:'Orders',agent:'orders'}), mn('n7','end',200,630,{label:'End'})],
    edges: [me('e1','s','n1'),me('e2','n1','n2'),me('e3','n2','n3'),me('e4','n3','n4','Tech'),me('e5','n3','n5','Billing'),me('e6','n3','n6','Orders'),me('e7','n4','n7'),me('e8','n5','n7'),me('e9','n6','n7')],
  },
  {
    id: 'abandoned-cart', name: 'Abandoned Cart Recovery', category: 'E-Commerce', trigger: 'KEYWORD', keywords: ['cart','checkout'],
    description: 'Automatically follow up with customers who abandoned their cart',
    nodes: [mn('s','start',250,0,{label:'Cart Trigger'}), mn('n1','delay',200,110,{label:'1hr Delay',delaySeconds:3600}), mn('n2','text',200,230,{label:'Reminder',content:"🛒 You left something behind! Complete your order and get 10% off with code SAVE10."}), mn('n3','buttons',160,360,{label:'CTA',content:'Ready to complete your purchase?',buttons:['✅ Complete Order','❌ Not Interested']}), mn('n4','condition',200,490,{label:'Responded?',condition:'button_reply'}), mn('n5','tag',60,610,{label:'Converted',tag:'cart-recovered'}), mn('n6','delay',320,610,{label:'24hr',delaySeconds:86400}), mn('n7','text',320,730,{label:'Final Push',content:"⏰ Last chance! Your cart expires tonight."}), mn('n8','end',200,850,{label:'End'})],
    edges: [me('e1','s','n1'),me('e2','n1','n2'),me('e3','n2','n3'),me('e4','n3','n4'),me('e5','n4','n5','Yes'),me('e6','n4','n6','No'),me('e7','n6','n7'),me('e8','n5','n8'),me('e9','n7','n8')],
  },
  {
    id: 'order-tracking', name: 'Order Tracking', category: 'E-Commerce', trigger: 'KEYWORD', keywords: ['order','track','delivery','status'],
    description: 'Let customers check order status via WhatsApp automatically',
    nodes: [mn('s','start',250,0,{label:'Order Keyword'}), mn('n1','text',200,110,{label:'Ask ID',content:"Please share your order number and we'll check the status right away!"}), mn('n2','waitReply',200,240,{label:'Capture ID'}), mn('n3','webhook',200,370,{label:'Fetch Status',url:'https://api.yourstore.com/orders/status',method:'POST'}), mn('n4','text',200,500,{label:'Status',content:"📦 Your order status: {{order.status}}\nEstimated delivery: {{order.eta}}"}), mn('n5','end',210,620,{label:'End'})],
    edges: [me('e1','s','n1'),me('e2','n1','n2'),me('e3','n2','n3'),me('e4','n3','n4'),me('e5','n4','n5')],
  },
  {
    id: 'appointment', name: 'Appointment Booking', category: 'Service', trigger: 'KEYWORD', keywords: ['book','appointment','schedule','reserve'],
    description: 'Book appointments directly through WhatsApp conversations',
    nodes: [mn('s','start',250,0,{label:'Booking Keyword'}), mn('n1','text',200,110,{label:'Welcome',content:"Great! Let's get you booked. 📅"}), mn('n2','buttons',160,240,{label:'Service',content:'Which service?',buttons:['💆 Consultation','🔧 Repair','📋 Assessment']}), mn('n3','question',200,370,{label:'Name',content:'What is your full name?'}), mn('n4','question',200,490,{label:'Date',content:'Preferred date and time? (e.g. Mon 10 AM)'}), mn('n5','text',200,620,{label:'Confirmed',content:"✅ Booked! We'll send a reminder the day before."}), mn('n6','tag',200,730,{label:'Tag',tag:'appointment-booked'}), mn('n7','end',210,830,{label:'End'})],
    edges: [me('e1','s','n1'),me('e2','n1','n2'),me('e3','n2','n3'),me('e4','n3','n4'),me('e5','n4','n5'),me('e6','n5','n6'),me('e7','n6','n7')],
  },
  {
    id: 'feedback', name: 'Feedback & CSAT', category: 'Support', trigger: 'KEYWORD', keywords: ['feedback','review','rate'],
    description: 'Collect post-interaction feedback and satisfaction scores',
    nodes: [mn('s','start',250,0,{label:'Feedback Trigger'}), mn('n1','text',200,110,{label:'Intro',content:"Thanks for reaching out! We'd love your feedback. 🌟"}), mn('n2','buttons',160,240,{label:'CSAT',content:'How satisfied are you?',buttons:['😄 Very Happy','😐 Neutral','😞 Unhappy']}), mn('n3','condition',200,380,{label:'Score?',condition:'rating'}), mn('n4','text',50,510,{label:'Promoter',content:'🎉 Wonderful! Would you mind leaving us a review?'}), mn('n5','text',250,510,{label:'Detractor',content:"We're sorry! May we ask what went wrong?"}), mn('n6','assign',250,640,{label:'Escalate',agent:'quality-team'}), mn('n7','end',200,760,{label:'End'})],
    edges: [me('e1','s','n1'),me('e2','n1','n2'),me('e3','n2','n3'),me('e4','n3','n4','Happy'),me('e5','n3','n5','Unhappy'),me('e6','n4','n7'),me('e7','n5','n6'),me('e8','n6','n7')],
  },
  {
    id: 'ai-faq', name: 'AI FAQ Bot', category: 'AI', trigger: 'FALLBACK', keywords: [],
    description: 'Answer questions using AI and route complex cases to agents',
    nodes: [mn('s','start',250,0,{label:'Any Message'}), mn('n1','aiClassify',200,120,{label:'Classify Intent',prompt:'Classify user intent: sales, support, general, or unknown'}), mn('n2','condition',200,250,{label:'Intent?',condition:'intent'}), mn('n3','aiResponse',30,380,{label:'AI Answer',prompt:'Answer the user question about our products professionally.'}), mn('n4','assign',210,380,{label:'Sales',agent:'sales-team'}), mn('n5','assign',380,380,{label:'Support',agent:'support-team'}), mn('n6','text',200,510,{label:'Fallback',content:"I'm not sure about that. Let me connect you with a team member! 👤"}), mn('n7','end',210,630,{label:'End'})],
    edges: [me('e1','s','n1'),me('e2','n1','n2'),me('e3','n2','n3','FAQ'),me('e4','n2','n4','Sales'),me('e5','n2','n5','Support'),me('e6','n2','n6','Unknown'),me('e7','n3','n7'),me('e8','n4','n7'),me('e9','n5','n7'),me('e10','n6','n7')],
  },
  {
    id: 'church', name: 'Church & Ministry', category: 'Community', trigger: 'KEYWORD', keywords: ['church','ministry','prayer','service'],
    description: 'Engage church members with events, prayer requests, and devotionals',
    nodes: [mn('s','start',250,0,{label:'Member Contact'}), mn('n1','text',200,110,{label:'Welcome',content:'Peace be with you! 🙏 Welcome to our community channel.'}), mn('n2','buttons',160,240,{label:'Menu',content:'How can we serve you today?',buttons:['📅 Events','🙏 Prayer Request','📖 Devotional']}), mn('n3','tag',200,380,{label:'Tag Member',tag:'church-member'}), mn('n4','end',210,480,{label:'End'})],
    edges: [me('e1','s','n1'),me('e2','n1','n2'),me('e3','n2','n3'),me('e4','n3','n4')],
  },
  {
    id: 'student-onboarding', name: 'Student Onboarding', category: 'Education', trigger: 'FIRST_MESSAGE', keywords: [],
    description: 'Onboard new students and direct them to the right resources',
    nodes: [mn('s','start',250,0,{label:'Student Message'}), mn('n1','text',200,110,{label:'Welcome',content:"Welcome! 🎓 We're excited to have you. Let's get you started."}), mn('n2','question',200,240,{label:'Course?',content:'Which course are you enrolled in?'}), mn('n3','buttons',160,370,{label:'Resources',content:'What do you need?',buttons:['📚 Study Materials','📅 Schedule','👤 Advisor']}), mn('n4','tag',200,500,{label:'Tag',tag:'student-onboarded'}), mn('n5','end',210,600,{label:'End'})],
    edges: [me('e1','s','n1'),me('e2','n1','n2'),me('e3','n2','n3'),me('e4','n3','n4'),me('e5','n4','n5')],
  },
  {
    id: 'real-estate', name: 'Real Estate Leads', category: 'Real Estate', trigger: 'KEYWORD', keywords: ['property','apartment','villa','rent','buy'],
    description: 'Capture and qualify property buyer and renter leads',
    nodes: [mn('s','start',250,0,{label:'Property Inquiry'}), mn('n1','text',200,110,{label:'Welcome',content:'Welcome! 🏠 Let me help you find the perfect place.'}), mn('n2','buttons',160,240,{label:'Intent',content:'Are you looking to:',buttons:['🏠 Buy','🔑 Rent','💼 Invest']}), mn('n3','question',200,370,{label:'Budget?',content:'What is your budget range?'}), mn('n4','question',200,490,{label:'Location?',content:'Preferred location or area?'}), mn('n5','assign',200,610,{label:'Assign Agent',agent:'property-agent'}), mn('n6','tag',200,720,{label:'Tag',tag:'property-lead'}), mn('n7','end',210,820,{label:'End'})],
    edges: [me('e1','s','n1'),me('e2','n1','n2'),me('e3','n2','n3'),me('e4','n3','n4'),me('e5','n4','n5'),me('e6','n5','n6'),me('e7','n6','n7')],
  },
  {
    id: 'healthcare', name: 'Healthcare Clinic', category: 'Healthcare', trigger: 'KEYWORD', keywords: ['doctor','clinic','appointment','health'],
    description: 'Handle patient inquiries and appointment booking for clinics',
    nodes: [mn('s','start',250,0,{label:'Patient Contact'}), mn('n1','text',200,110,{label:'Greeting',content:'Welcome to our clinic! 🏥 How can we assist you today?'}), mn('n2','buttons',160,240,{label:'Options',content:'Please select:',buttons:['📅 Book Appointment','💊 Prescription','❓ General Inquiry']}), mn('n3','question',200,370,{label:'Specialty?',content:'Which specialty do you need? (e.g. General, Cardiology, Pediatrics)'}), mn('n4','question',200,490,{label:'Date',content:'Preferred date and time for your appointment?'}), mn('n5','text',200,610,{label:'Confirmed',content:"✅ Appointment request received! We'll confirm shortly."}), mn('n6','end',210,720,{label:'End'})],
    edges: [me('e1','s','n1'),me('e2','n1','n2'),me('e3','n2','n3'),me('e4','n3','n4'),me('e5','n4','n5'),me('e6','n5','n6')],
  },
  {
    id: 'restaurant', name: 'Restaurant Orders', category: 'Food & Beverage', trigger: 'KEYWORD', keywords: ['order','menu','table','food','reservation'],
    description: 'Take food orders and table reservations via WhatsApp',
    nodes: [mn('s','start',250,0,{label:'Customer Contact'}), mn('n1','text',200,110,{label:'Welcome',content:'🍽️ Welcome! Would you like to order, book a table, or view our menu?'}), mn('n2','buttons',160,240,{label:'Options',content:'What would you like?',buttons:['🛒 Order Food','🪑 Book Table','📋 View Menu']}), mn('n3','question',200,370,{label:'Order',content:"Please tell us what you'd like to order and your delivery address."}), mn('n4','text',200,490,{label:'Confirmed',content:"✅ Order received! Estimated time: 30-45 mins."}), mn('n5','tag',200,600,{label:'Tag',tag:'restaurant-customer'}), mn('n6','end',210,700,{label:'End'})],
    edges: [me('e1','s','n1'),me('e2','n1','n2'),me('e3','n2','n3'),me('e4','n3','n4'),me('e5','n4','n5'),me('e6','n5','n6')],
  },
  {
    id: 'payment-reminder', name: 'Payment Reminder', category: 'Finance', trigger: 'KEYWORD', keywords: ['payment','invoice','due','bill'],
    description: 'Send payment reminders and handle payment inquiries automatically',
    nodes: [mn('s','start',250,0,{label:'Payment Keyword'}), mn('n1','text',200,110,{label:'Reminder',content:'💳 Hi! You have a pending payment. Please review your invoice details.'}), mn('n2','buttons',160,240,{label:'Options',content:'How would you like to proceed?',buttons:['✅ Pay Now','📅 Pay Later','❓ Dispute']}), mn('n3','condition',200,380,{label:'Choice?',condition:'button_reply'}), mn('n4','webhook',60,510,{label:'Process Payment',url:'https://api.payments.com/process',method:'POST'}), mn('n5','text',60,640,{label:'Receipt',content:'🎉 Payment successful! Your receipt has been sent.'}), mn('n6','assign',320,510,{label:'Finance Team',agent:'finance-team'}), mn('n7','tag',200,760,{label:'Tag Paid',tag:'payment-received'}), mn('n8','end',210,860,{label:'End'})],
    edges: [me('e1','s','n1'),me('e2','n1','n2'),me('e3','n2','n3'),me('e4','n3','n4','Pay'),me('e5','n3','n6','Dispute'),me('e6','n4','n5'),me('e7','n5','n7'),me('e8','n6','n7'),me('e9','n7','n8')],
  },
  {
    id: 're-engagement', name: 'Re-engagement Campaign', category: 'Marketing', trigger: 'KEYWORD', keywords: ['comeback','offer','deal'],
    description: 'Win back inactive customers with targeted personalised offers',
    nodes: [mn('s','start',250,0,{label:'Re-engage Trigger'}), mn('n1','text',200,110,{label:'Miss You',content:"We've missed you! 💌 Here's a special gift just for you!"}), mn('n2','delay',200,240,{label:'Pause',delaySeconds:2}), mn('n3','buttons',160,360,{label:'Offer',content:'🎁 Get 20% off your next order!',buttons:['🛒 Claim Offer','🚫 No Thanks']}), mn('n4','condition',200,490,{label:'Accepted?',condition:'button_reply'}), mn('n5','tag',60,610,{label:'Re-engaged',tag:'re-engaged'}), mn('n6','tag',330,610,{label:'Churned',tag:'churned'}), mn('n7','end',200,720,{label:'End'})],
    edges: [me('e1','s','n1'),me('e2','n1','n2'),me('e3','n2','n3'),me('e4','n3','n4'),me('e5','n4','n5','Yes'),me('e6','n4','n6','No'),me('e7','n5','n7'),me('e8','n6','n7')],
  },
] as const;

type FlowTemplate = typeof FLOW_TEMPLATES[number];

// ─── Custom Node Components ───────────────────────────────────────────────────

function StartNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  return (
    <div className={cn('bg-teal-600 text-white rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-md min-w-[160px] text-center', selected && 'ring-2 ring-teal-300 ring-offset-1')}>
      <div className="flex items-center justify-center gap-2"><Zap size={14} /><span>{d.label ?? 'Trigger'}</span></div>
      <Handle type="source" position={Position.Bottom} className="!bg-teal-400 !w-3 !h-3 !border-2 !border-white" />
    </div>
  );
}

function EndNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  return (
    <div className={cn('bg-gray-800 text-white rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-md min-w-[140px] text-center', selected && 'ring-2 ring-gray-500 ring-offset-1')}>
      <Handle type="target" position={Position.Top} className="!bg-gray-500 !w-3 !h-3 !border-2 !border-white" />
      <div className="flex items-center justify-center gap-2"><X size={14} /><span>{d.label ?? 'End'}</span></div>
    </div>
  );
}

function FlowNode({ data, selected, type }: NodeProps) {
  const d = data as NodeData;
  const cfg = NODE_MAP[type ?? ''];
  const Icon = cfg?.icon ?? MessageSquare;
  return (
    <div className={cn('bg-white border border-gray-200 rounded-2xl shadow-sm min-w-[200px] max-w-[260px] transition-all', selected && 'ring-2 ring-teal-500 ring-offset-1 shadow-md')}>
      <Handle type="target" position={Position.Top} className="!bg-gray-300 !w-3 !h-3 !border-2 !border-white" />
      <div className="px-3.5 py-3">
        <div className="flex items-center gap-2 mb-1.5">
          <div className={cn('w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0', cfg?.bg ?? 'bg-gray-100', cfg?.color ?? 'text-gray-600')}>
            <Icon size={12} />
          </div>
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{cfg?.label ?? type}</span>
        </div>
        {d.content && <p className="text-xs text-gray-700 leading-relaxed line-clamp-3">{String(d.content)}</p>}
        {d.buttons && Array.isArray(d.buttons) && (d.buttons as string[]).length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {(d.buttons as string[]).map((b, i) => <span key={i} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full border border-gray-200">{b}</span>)}
          </div>
        )}
        {type === 'delay' && d.delaySeconds && <p className="text-xs text-orange-600 font-mono mt-1">⏱ {Number(d.delaySeconds) >= 3600 ? `${Math.round(Number(d.delaySeconds)/3600)}h` : `${d.delaySeconds}s`}</p>}
        {type === 'tag' && d.tag && <p className="text-xs text-teal-600 font-mono mt-1">#{String(d.tag)}</p>}
        {type === 'assign' && d.agent && <p className="text-xs text-emerald-600 mt-1">→ {String(d.agent)}</p>}
        {type === 'webhook' && d.url && <p className="text-xs text-amber-600 font-mono truncate mt-1">{String(d.method ?? 'POST')} {String(d.url)}</p>}
        {(type === 'aiResponse' || type === 'aiClassify') && d.prompt && <p className="text-xs text-violet-600 italic line-clamp-2 mt-1">{String(d.prompt)}</p>}
        {type === 'condition' && d.condition && <p className="text-xs text-green-600 font-mono mt-1">if {String(d.condition)}</p>}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-gray-300 !w-3 !h-3 !border-2 !border-white" />
    </div>
  );
}

const nodeTypes = {
  start: StartNode, end: EndNode,
  text: FlowNode, image: FlowNode, document: FlowNode, audio: FlowNode, template: FlowNode,
  buttons: FlowNode, list: FlowNode, question: FlowNode, waitReply: FlowNode,
  condition: FlowNode, split: FlowNode, delay: FlowNode, jump: FlowNode,
  tag: FlowNode, assign: FlowNode, updateField: FlowNode,
  webhook: FlowNode, email: FlowNode,
  aiResponse: FlowNode, aiClassify: FlowNode,
};

// ─── Properties Panel ─────────────────────────────────────────────────────────

function PropertiesPanel({ node, onUpdate, onDelete }: {
  node: Node<NodeData>;
  onUpdate: (id: string, data: Partial<NodeData>) => void;
  onDelete: (id: string) => void;
}) {
  const d = node.data;
  const cfg = NODE_MAP[node.type ?? ''];
  const Icon = cfg?.icon ?? MessageSquare;
  const t = node.type ?? '';

  return (
    <div className="w-72 bg-white border-l border-gray-100 h-full overflow-y-auto flex flex-col flex-shrink-0">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center', cfg?.bg ?? 'bg-gray-100', cfg?.color ?? 'text-gray-600')}>
            <Icon size={13} />
          </div>
          <span className="text-sm font-semibold text-gray-900">{cfg?.label ?? t}</span>
        </div>
        {t !== 'start' && (
          <button onClick={() => onDelete(node.id)} className="text-gray-300 hover:text-red-500 transition-colors p-1 rounded-lg hover:bg-red-50">
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <div className="flex-1 p-4 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Label</label>
          <input value={String(d.label ?? '')} onChange={e => onUpdate(node.id, { label: e.target.value })}
            placeholder="Node label…" className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white" />
        </div>

        {['text','image','document','audio','template','question','waitReply','list'].includes(t) && (
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Message Content</label>
            <textarea rows={4} value={String(d.content ?? '')} onChange={e => onUpdate(node.id, { content: e.target.value })}
              placeholder="Enter message text… Use {{variable}} for dynamic content."
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white" />
          </div>
        )}

        {t === 'buttons' && (
          <>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Message Body</label>
              <textarea rows={3} value={String(d.content ?? '')} onChange={e => onUpdate(node.id, { content: e.target.value })}
                placeholder="Message before buttons…"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Buttons (max 3)</label>
              <div className="space-y-2">
                {((d.buttons ?? []) as string[]).map((btn, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={btn} onChange={e => {
                      const b = [...((d.buttons ?? []) as string[])]; b[i] = e.target.value;
                      onUpdate(node.id, { buttons: b });
                    }} placeholder={`Button ${i+1}`} className="flex-1 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50" />
                    <button onClick={() => onUpdate(node.id, { buttons: ((d.buttons ?? []) as string[]).filter((_, j) => j !== i) })} className="text-gray-300 hover:text-red-500 p-1"><X size={11} /></button>
                  </div>
                ))}
                {((d.buttons ?? []) as string[]).length < 3 && (
                  <button onClick={() => onUpdate(node.id, { buttons: [...((d.buttons ?? []) as string[]), ''] })}
                    className="text-xs text-teal-600 hover:text-teal-700 flex items-center gap-1"><Plus size={11} />Add button</button>
                )}
              </div>
            </div>
          </>
        )}

        {t === 'delay' && (
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Delay Duration</label>
            <div className="flex items-center gap-2">
              <input type="number" min={1} max={86400} value={Number(d.delaySeconds ?? 5)}
                onChange={e => onUpdate(node.id, { delaySeconds: Number(e.target.value) })}
                className="w-24 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50" />
              <span className="text-sm text-gray-500">seconds</span>
            </div>
          </div>
        )}

        {t === 'tag' && (
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Tag Name</label>
            <input value={String(d.tag ?? '')} onChange={e => onUpdate(node.id, { tag: e.target.value })}
              placeholder="e.g. new-lead, vip-customer"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50" />
          </div>
        )}

        {t === 'assign' && (
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Assign To</label>
            <input value={String(d.agent ?? '')} onChange={e => onUpdate(node.id, { agent: e.target.value })}
              placeholder="Team or agent name"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50" />
          </div>
        )}

        {t === 'condition' && (
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Condition</label>
            <input value={String(d.condition ?? '')} onChange={e => onUpdate(node.id, { condition: e.target.value })}
              placeholder="e.g. button == Shop"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 font-mono text-xs" />
          </div>
        )}

        {(t === 'aiResponse' || t === 'aiClassify') && (
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">AI System Prompt</label>
            <textarea rows={4} value={String(d.prompt ?? '')} onChange={e => onUpdate(node.id, { prompt: e.target.value })}
              placeholder="Instructions for the AI…"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white" />
          </div>
        )}

        {t === 'webhook' && (
          <>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">URL</label>
              <input value={String(d.url ?? '')} onChange={e => onUpdate(node.id, { url: e.target.value })}
                placeholder="https://…"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 font-mono text-xs" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Method</label>
              <select value={String(d.method ?? 'POST')} onChange={e => onUpdate(node.id, { method: e.target.value })}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-teal-500">
                {['GET','POST','PUT','PATCH'].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </>
        )}

        {t === 'updateField' && (
          <>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Field Name</label>
              <input value={String(d.field ?? '')} onChange={e => onUpdate(node.id, { field: e.target.value })}
                placeholder="e.g. status, plan"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">New Value</label>
              <input value={String(d.fieldValue ?? '')} onChange={e => onUpdate(node.id, { fieldValue: e.target.value })}
                placeholder="Value to set"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Template Library Modal ───────────────────────────────────────────────────

const TMPL_CATEGORIES = ['All', ...Array.from(new Set(FLOW_TEMPLATES.map(t => t.category)))];

function TemplateLibrary({ onSelect, onClose }: { onSelect: (t: FlowTemplate) => void; onClose: () => void }) {
  const [cat, setCat] = useState('All');
  const [q, setQ] = useState('');
  const filtered = FLOW_TEMPLATES.filter(t =>
    (cat === 'All' || t.category === cat) &&
    (t.name.toLowerCase().includes(q.toLowerCase()) || t.description.toLowerCase().includes(q.toLowerCase()))
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <LayoutTemplate size={18} className="text-teal-600" />
            <h2 className="text-base font-bold text-gray-900">Flow Templates</h2>
            <span className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full font-medium">{FLOW_TEMPLATES.length} templates</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-100"><X size={16} /></button>
        </div>
        <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search templates…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50" />
          </div>
        </div>
        <div className="px-6 py-2 border-b border-gray-100 flex items-center gap-1.5 flex-wrap flex-shrink-0">
          {TMPL_CATEGORIES.map(c => (
            <button key={c} onClick={() => setCat(c)}
              className={cn('px-3 py-1 text-xs rounded-full font-medium transition-colors', cat === c ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
              {c}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 gap-3">
          {filtered.map(t => (
            <button key={t.id} onClick={() => onSelect(t)}
              className="text-left p-4 border border-gray-200 rounded-2xl hover:border-teal-400 hover:shadow-md transition-all group">
              <div className="flex items-start justify-between mb-1.5">
                <span className="text-sm font-semibold text-gray-900 group-hover:text-teal-700 transition-colors">{t.name}</span>
                <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full flex-shrink-0 ml-2">{t.category}</span>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">{t.description}</p>
              <div className="flex items-center gap-3 mt-2.5 text-[10px] text-gray-400">
                <span>{t.nodes.length} nodes</span><span>{t.edges.length} connections</span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-2 py-12 text-center text-gray-400">
              <LayoutTemplate size={28} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No templates match your search</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Flow Builder ─────────────────────────────────────────────────────────────

const TRIGGER_OPTIONS = [
  { value: 'FIRST_MESSAGE', label: 'First Message' },
  { value: 'KEYWORD',       label: 'Keyword Match' },
  { value: 'BUTTON_REPLY',  label: 'Button Reply'  },
  { value: 'OPT_IN',        label: 'Opt-In'        },
  { value: 'FALLBACK',      label: 'Fallback'      },
];

function genId() { return Math.random().toString(36).slice(2, 9); }

function FlowBuilderInner({ flow, onSave, onBack }: {
  flow: Partial<ChatbotFlow>;
  onSave: (data: Partial<ChatbotFlow>) => Promise<void>;
  onBack: () => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const initial = useMemo(() => {
    const stored = flow.nodes as { nodes?: Node<NodeData>[]; edges?: Edge[] } | null;
    return {
      nodes: stored?.nodes ?? [mn('start', 'start', 250, 50, { label: flow.trigger ?? 'Trigger' })],
      edges: stored?.edges ?? [],
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [selectedNode, setSelectedNode] = useState<Node<NodeData> | null>(null);
  const [flowName, setFlowName] = useState(flow.name ?? 'New Flow');
  const [trigger, setTrigger] = useState(flow.trigger ?? 'KEYWORD');
  const [keywords, setKeywords] = useState<string[]>(flow.keywords ?? []);
  const [kwInput, setKwInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string>(NODE_GROUPS[0]);
  const [paletteOpen, setPaletteOpen] = useState(true);

  const onConnect = useCallback((params: Connection) => {
    setEdges(eds => addEdge({ ...params, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' }, style: { stroke: '#94a3b8', strokeWidth: 1.5 } }, eds));
  }, [setEdges]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node<NodeData>) => setSelectedNode(node), []);
  const onPaneClick = useCallback(() => setSelectedNode(null), []);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/reactflow-type');
    if (!type) return;
    const cfg = NODE_MAP[type];
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const newNode: Node<NodeData> = {
      id: genId(), type, position: pos,
      data: { label: cfg?.label ?? type, content: '', buttons: type === 'buttons' ? ['Option 1', 'Option 2'] : undefined },
    };
    setNodes(nds => [...nds, newNode]);
    setSelectedNode(newNode);
  }, [screenToFlowPosition, setNodes]);

  const updateNodeData = useCallback((id: string, data: Partial<NodeData>) => {
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, ...data } } : n));
    setSelectedNode(prev => prev?.id === id ? { ...prev, data: { ...prev.data, ...data } } : prev);
  }, [setNodes]);

  const deleteNode = useCallback((id: string) => {
    setNodes(nds => nds.filter(n => n.id !== id));
    setEdges(eds => eds.filter(e => e.source !== id && e.target !== id));
    setSelectedNode(null);
  }, [setNodes, setEdges]);

  const loadTemplate = useCallback((t: FlowTemplate) => {
    setNodes([...t.nodes] as Node<NodeData>[]);
    setEdges([...t.edges] as Edge[]);
    setFlowName(t.name);
    setTrigger(t.trigger);
    setKeywords([...t.keywords]);
    setSelectedNode(null);
    setShowTemplates(false);
    toast.success(`Template "${t.name}" loaded`);
  }, [setNodes, setEdges]);

  const handleSave = async () => {
    if (!flowName.trim()) { toast.error('Flow name is required'); return; }
    setSaving(true);
    try { await onSave({ name: flowName, trigger, keywords, nodes: { nodes, edges }, priority: flow.priority ?? 0 }); }
    finally { setSaving(false); }
  };

  const addKw = () => {
    const k = kwInput.trim().toLowerCase();
    if (k && !keywords.includes(k)) setKeywords(prev => [...prev, k]);
    setKwInput('');
  };

  const palette = NODE_PALETTE.filter(n => n.group === activeGroup);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 flex-shrink-0 z-10">
        <button onClick={onBack} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-100 flex-shrink-0">
          <ArrowLeft size={16} />
        </button>
        <input value={flowName} onChange={e => setFlowName(e.target.value)}
          className="text-base font-semibold text-gray-900 bg-transparent border-none outline-none focus:ring-0 flex-1 min-w-0" placeholder="Flow name…" />
        <div className="flex items-center gap-2 flex-shrink-0">
          <select value={trigger} onChange={e => setTrigger(e.target.value)}
            className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-teal-500">
            {TRIGGER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button onClick={() => setShowTemplates(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-xl text-gray-600 hover:border-teal-400 hover:text-teal-600 transition-colors">
            <LayoutTemplate size={12} />Templates
          </button>
          <button onClick={() => void handleSave()} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 transition-colors disabled:opacity-60">
            {saving ? <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Save size={13} />}
            Save
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <div className="w-52 bg-white border-r border-gray-100 flex flex-col flex-shrink-0 overflow-hidden">
          {/* Keywords section */}
          {trigger === 'KEYWORD' && (
            <div className="px-3 py-2.5 border-b border-gray-100 flex-shrink-0">
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Keywords</p>
              <div className="flex items-center gap-1 mb-1.5">
                <input value={kwInput} onChange={e => setKwInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKw(); } }}
                  placeholder="Add keyword…" className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-500 bg-gray-50" />
                <button onClick={addKw} className="text-teal-600 hover:text-teal-700 p-1"><Plus size={12} /></button>
              </div>
              <div className="flex flex-wrap gap-1">
                {keywords.map(k => (
                  <span key={k} className="flex items-center gap-0.5 text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full">
                    {k}<button onClick={() => setKeywords(p => p.filter(kw => kw !== k))}><X size={9} /></button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Group tabs */}
          <div className="border-b border-gray-100 flex-shrink-0">
            <button onClick={() => setPaletteOpen(p => !p)} className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-gray-500">
              <span>NODE PALETTE</span>
              {paletteOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {paletteOpen && (
              <div className="flex flex-wrap gap-0.5 px-2 pb-2">
                {NODE_GROUPS.map(g => (
                  <button key={g} onClick={() => setActiveGroup(g)}
                    className={cn('px-2 py-1 text-[9px] font-bold uppercase tracking-wide rounded-lg transition-colors', activeGroup === g ? 'bg-teal-50 text-teal-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50')}>
                    {g}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Node list */}
          {paletteOpen && (
            <div className="flex-1 overflow-y-auto py-1">
              {palette.map(cfg => (
                <div key={cfg.type} draggable
                  onDragStart={e => { e.dataTransfer.setData('application/reactflow-type', cfg.type); e.dataTransfer.effectAllowed = 'move'; }}
                  className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-grab active:cursor-grabbing transition-colors">
                  <div className={cn('w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0', cfg.bg, cfg.color)}>
                    <cfg.icon size={12} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-700 leading-tight">{cfg.label}</p>
                    <p className="text-[9px] text-gray-400 leading-tight truncate">{cfg.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Canvas */}
        <div ref={wrapperRef} className="flex-1 relative" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} onNodeClick={onNodeClick} onPaneClick={onPaneClick}
            nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.3 }}
            defaultEdgeOptions={{ type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' }, style: { stroke: '#94a3b8', strokeWidth: 1.5 } }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e2e8f0" />
            <Controls showInteractive={false} />
            <Panel position="top-right">
              <div className="bg-white border border-gray-200 rounded-xl px-3 py-1.5 text-xs text-gray-500 shadow-sm">
                <span className="font-semibold text-gray-800">{nodes.length}</span> nodes · <span className="font-semibold text-gray-800">{edges.length}</span> edges
              </div>
            </Panel>
          </ReactFlow>
          {nodes.length <= 1 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <Layers size={40} className="mx-auto text-gray-200 mb-3" />
                <p className="text-sm font-medium text-gray-400">Drag nodes from the left panel onto the canvas</p>
                <p className="text-xs text-gray-300 mt-1">or load a template to get started quickly</p>
              </div>
            </div>
          )}
        </div>

        {/* Properties panel */}
        {selectedNode && selectedNode.type !== 'start' && (
          <PropertiesPanel node={selectedNode} onUpdate={updateNodeData} onDelete={deleteNode} />
        )}
      </div>

      {showTemplates && <TemplateLibrary onSelect={loadTemplate} onClose={() => setShowTemplates(false)} />}
    </div>
  );
}

function FlowBuilder(props: Parameters<typeof FlowBuilderInner>[0]) {
  return <ReactFlowProvider><FlowBuilderInner {...props} /></ReactFlowProvider>;
}

// ─── Flow Card ────────────────────────────────────────────────────────────────

const TRIGGER_COLORS: Record<string, string> = {
  FIRST_MESSAGE: 'bg-teal-50 text-teal-700',
  KEYWORD:       'bg-blue-50 text-blue-700',
  BUTTON_REPLY:  'bg-purple-50 text-purple-700',
  OPT_IN:        'bg-green-50 text-green-700',
  FALLBACK:      'bg-orange-50 text-orange-700',
};

function FlowCard({ flow, onEdit, onToggle, onDelete }: {
  flow: ChatbotFlow; onEdit: () => void; onToggle: () => void; onDelete: () => void;
}) {
  const stored = flow.nodes as { nodes?: Node[] } | null;
  const nodeCount = stored?.nodes?.length ?? 0;
  const trigLabel = TRIGGER_OPTIONS.find(t => t.value === flow.trigger)?.label ?? flow.trigger;
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 hover:shadow-sm transition-shadow">
      <div className="flex items-start gap-4">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', flow.isActive ? 'bg-teal-50' : 'bg-gray-100')}>
          <Bot size={18} className={flow.isActive ? 'text-teal-600' : 'text-gray-400'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h3 className="text-sm font-semibold text-gray-900">{flow.name}</h3>
            <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', TRIGGER_COLORS[flow.trigger] ?? 'bg-gray-100 text-gray-600')}>{trigLabel}</span>
            {!flow.isActive && <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Paused</span>}
          </div>
          {flow.description && <p className="text-xs text-gray-500">{flow.description}</p>}
          <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs text-gray-400">
            {flow.keywords?.length > 0 && (
              <span className="flex items-center gap-1 flex-wrap">
                {flow.keywords.slice(0,4).map(k => <code key={k} className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-md font-mono text-[10px]">{k}</code>)}
                {flow.keywords.length > 4 && `+${flow.keywords.length-4}`}
              </span>
            )}
            <span>{nodeCount} nodes</span>
            <span>{flow.executionCount.toLocaleString()} runs</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={onToggle}
            className={cn('flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              flow.isActive ? 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100' : 'bg-green-50 text-green-700 hover:bg-green-100')}>
            {flow.isActive ? <Pause size={10} /> : <Play size={10} />}
            {flow.isActive ? 'Pause' : 'Activate'}
          </button>
          <button onClick={onEdit} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
            <Edit2 size={13} />
          </button>
          <button onClick={onDelete} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ChatbotPage() {
  const [flows, setFlows] = useState<ChatbotFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingFlow, setEditingFlow] = useState<Partial<ChatbotFlow> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [showTemplateLibrary, setShowTemplateLibrary] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await chatbotFlowsApi.list(); setFlows(res.data as ChatbotFlow[]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveFlow = async (data: Partial<ChatbotFlow>) => {
    if (isNew) {
      await chatbotFlowsApi.create(data as Record<string, unknown>);
      toast.success('Flow created!');
    } else if (editingFlow?.id) {
      await chatbotFlowsApi.update(editingFlow.id, data as Record<string, unknown>);
      toast.success('Flow saved!');
    }
    setEditingFlow(null);
    void load();
  };

  const toggleFlow = async (flow: ChatbotFlow) => {
    try { await chatbotFlowsApi.update(flow.id, { isActive: !flow.isActive }); toast.success(flow.isActive ? 'Flow paused' : 'Flow activated'); void load(); }
    catch { toast.error('Failed to update flow'); }
  };

  const deleteFlow = async (id: string) => {
    if (!confirm('Delete this flow?')) return;
    try { await chatbotFlowsApi.delete(id); toast.success('Flow deleted'); void load(); }
    catch { toast.error('Failed to delete flow'); }
  };

  const openFromTemplate = (t: FlowTemplate) => {
    setIsNew(true);
    setEditingFlow({ name: t.name, trigger: t.trigger, keywords: [...t.keywords], nodes: { nodes: [...t.nodes] as Node<NodeData>[], edges: [...t.edges] as Edge[] }, isActive: false, priority: 0 });
    setShowTemplateLibrary(false);
  };

  if (editingFlow !== null) {
    return <FlowBuilder flow={editingFlow} onSave={saveFlow} onBack={() => setEditingFlow(null)} />;
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-auto">
      <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center">
            <Bot size={18} className="text-teal-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Chatbot Flows</h1>
            <p className="text-xs text-gray-500">Build visual automation flows for WhatsApp</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowTemplateLibrary(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 rounded-xl text-gray-600 hover:border-teal-400 hover:text-teal-600 transition-colors">
            <LayoutTemplate size={14} />Templates
          </button>
          <button
            onClick={() => { setIsNew(true); setEditingFlow({ name: 'New Flow', trigger: 'KEYWORD', keywords: [], nodes: null, isActive: false, priority: 0 }); }}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 transition-colors">
            <Plus size={14} />New Flow
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex justify-center pt-16"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-teal-600" /></div>
        ) : flows.length === 0 ? (
          <div className="max-w-lg mx-auto mt-16 text-center">
            <div className="w-16 h-16 bg-teal-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Bot size={28} className="text-teal-600" />
            </div>
            <h3 className="text-base font-semibold text-gray-900 mb-2">No flows yet</h3>
            <p className="text-sm text-gray-500 mb-6">Build visual automation flows to handle conversations automatically — 24/7.</p>
            <div className="flex items-center gap-3 justify-center">
              <button onClick={() => setShowTemplateLibrary(true)}
                className="flex items-center gap-2 px-5 py-2.5 border border-teal-200 text-teal-700 text-sm font-semibold rounded-xl hover:bg-teal-50 transition-colors">
                <LayoutTemplate size={14} />Start from Template
              </button>
              <button onClick={() => { setIsNew(true); setEditingFlow({ name: 'New Flow', trigger: 'KEYWORD', keywords: [], nodes: null, isActive: false, priority: 0 }); }}
                className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 transition-colors">
                <Plus size={14} />Build from Scratch
              </button>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-3">
            <div className="grid grid-cols-3 gap-4 mb-6">
              {[
                { label: 'Total Flows', value: flows.length },
                { label: 'Active', value: flows.filter(f => f.isActive).length },
                { label: 'Total Runs', value: flows.reduce((a, f) => a + f.executionCount, 0).toLocaleString() },
              ].map(({ label, value }) => (
                <div key={label} className="bg-white border border-gray-200 rounded-2xl p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900">{value}</p>
                  <p className="text-xs text-gray-500 mt-1">{label}</p>
                </div>
              ))}
            </div>
            {flows.map(flow => (
              <FlowCard key={flow.id} flow={flow}
                onEdit={() => { setIsNew(false); setEditingFlow(flow); }}
                onToggle={() => void toggleFlow(flow)}
                onDelete={() => void deleteFlow(flow.id)}
              />
            ))}
          </div>
        )}
      </div>

      {showTemplateLibrary && <TemplateLibrary onSelect={openFromTemplate} onClose={() => setShowTemplateLibrary(false)} />}
    </div>
  );
}
