'use client';
import { useEffect, useState, useCallback } from 'react';
import { conversationsApi } from '@/lib/api';
import { useInboxStore } from '@/store/inbox.store';
import type { StatusCounts } from '@/store/inbox.store';
import ConversationList from '@/components/inbox/ConversationList';
import ChatWindow from '@/components/inbox/ChatWindow';
import ConversationDetails from '@/components/inbox/ConversationDetails';

export default function InboxPage() {
  const { conversations, activeConversationId, setConversations, setActiveConversation, markConversationRead, statusCounts, setStatusCounts } = useInboxStore();
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [resolvedConversations, setResolvedConversations] = useState<Parameters<typeof setConversations>[0]>([]);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');

  const loadCounts = useCallback(async () => {
    try {
      const res = await conversationsApi.getCounts();
      setStatusCounts(res.data as StatusCounts);
    } catch { /* silent */ }
  }, [setStatusCounts]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await conversationsApi.list({ limit: 50 });
        setConversations((res.data as { data: unknown[] }).data as Parameters<typeof setConversations>[0]);
      } catch (err) {
        console.error('Failed to load conversations:', err);
      } finally {
        setLoading(false);
      }
    };
    void load();
    void loadCounts();
  }, [setConversations, loadCounts]);

  // Refresh counts when conversation_state_changed socket events fire
  useEffect(() => {
    const handler = () => { void loadCounts(); };
    window.addEventListener('conversation:state-changed', handler);
    return () => window.removeEventListener('conversation:state-changed', handler);
  }, [loadCounts]);

  // Background polling fallback when socket is disconnected
  useEffect(() => {
    const pollHandler = async () => {
      try {
        const [convRes, countsRes] = await Promise.all([
          conversationsApi.list({ limit: 50 }),
          conversationsApi.getCounts(),
        ]);
        setConversations((convRes.data as { data: unknown[] }).data as Parameters<typeof setConversations>[0]);
        setStatusCounts(countsRes.data as StatusCounts);
      } catch { /* silent */ }
    };
    window.addEventListener('socket:reconnect-poll', pollHandler);
    return () => window.removeEventListener('socket:reconnect-poll', pollHandler);
  }, [setConversations, setStatusCounts]);

  // Close details panel when switching conversations
  useEffect(() => { setShowDetails(false); }, [activeConversationId]);

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversation(id);
    markConversationRead(id);
    setMobileView('chat');
    void conversationsApi.markRead(id).catch(() => {});
  }, [setActiveConversation, markConversationRead]);

  // Open conversation from toast notification click
  useEffect(() => {
    const handler = (e: Event) => {
      const { conversationId } = (e as CustomEvent<{ conversationId: string }>).detail;
      if (conversationId) setActiveConversation(conversationId);
    };
    window.addEventListener('inbox:open-conversation', handler);
    return () => window.removeEventListener('inbox:open-conversation', handler);
  }, [setActiveConversation]);

  const activeConversation = conversations.find((c) => c.id === activeConversationId)
    ?? resolvedConversations.find((c) => c.id === activeConversationId)
    ?? null;

  return (
    <div className="flex h-full">
      <ConversationList
        conversations={conversations}
        activeId={activeConversationId}
        onSelect={handleSelectConversation}
        loading={loading}
        statusCounts={statusCounts}
        onResolvedLoaded={(convs) => setResolvedConversations(convs as Parameters<typeof setConversations>[0])}
        mobileHidden={mobileView === 'chat'}
      />
      {activeConversation ? (
        <div className={`${mobileView === 'list' ? 'hidden md:flex' : 'flex'} flex-1 min-h-0 overflow-hidden`}>
          <ChatWindow
            conversation={activeConversation}
            showDetails={showDetails}
            onToggleDetails={() => setShowDetails((v) => !v)}
            onMobileBack={() => setMobileView('list')}
          />
          {showDetails && <ConversationDetails conversation={activeConversation} />}
        </div>
      ) : (
        <div className={`${mobileView === 'list' ? 'hidden md:flex' : 'flex'} flex-1 items-center justify-center bg-gray-50 min-h-0`}>
          <div className="text-center flex flex-col items-center">
            {/* Envelope empty-state illustration */}
            <svg width="160" height="140" viewBox="0 0 160 140" fill="none" xmlns="http://www.w3.org/2000/svg" className="mb-6">
              {/* Sparkle top-left */}
              <line x1="22" y1="18" x2="22" y2="8" stroke="#5BC4F5" strokeWidth="4" strokeLinecap="round"/>
              <line x1="17" y1="23" x2="27" y2="23" stroke="#5BC4F5" strokeWidth="4" strokeLinecap="round"/>
              {/* Sparkle top-right */}
              <line x1="138" y1="14" x2="138" y2="4" stroke="#5BC4F5" strokeWidth="4" strokeLinecap="round"/>
              <line x1="133" y1="19" x2="143" y2="19" stroke="#5BC4F5" strokeWidth="4" strokeLinecap="round"/>
              {/* Envelope body */}
              <rect x="20" y="42" width="108" height="82" rx="4" fill="white" stroke="#1E5FAD" strokeWidth="3.5"/>
              {/* Envelope flap lines */}
              <path d="M20 46 L74 82 L128 46" stroke="#1E5FAD" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              {/* Shadow / accent block */}
              <rect x="28" y="50" width="108" height="82" rx="4" fill="#5BC4F5" opacity="0.25"/>
              {/* Document popping out */}
              <rect x="58" y="16" width="52" height="66" rx="3" fill="white" stroke="#1E5FAD" strokeWidth="3"/>
              {/* Document fold corner */}
              <path d="M94 16 L110 32" stroke="#1E5FAD" strokeWidth="3" strokeLinecap="round"/>
              <path d="M94 16 L94 32 L110 32" fill="#E8F4FD" stroke="#1E5FAD" strokeWidth="2.5"/>
              {/* Question mark */}
              <text x="84" y="64" textAnchor="middle" fontSize="24" fontWeight="700" fill="#1E5FAD" fontFamily="serif">?</text>
              {/* Question mark dot */}
              <circle cx="84" cy="74" r="2.5" fill="#1E5FAD"/>
              {/* Left side bar accent */}
              <rect x="20" y="72" width="6" height="22" rx="2" fill="#5BC4F5"/>
            </svg>
            <p className="text-lg font-semibold text-gray-700 mb-1">No message found!</p>
            <p className="text-sm text-gray-400">Select a conversation from the left to start messaging</p>
          </div>
        </div>
      )}
    </div>
  );
}
