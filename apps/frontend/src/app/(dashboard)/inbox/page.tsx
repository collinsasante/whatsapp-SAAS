'use client';
import { useEffect, useState } from 'react';
import { conversationsApi } from '@/lib/api';
import { useInboxStore } from '@/store/inbox.store';
import ConversationList from '@/components/inbox/ConversationList';
import ChatWindow from '@/components/inbox/ChatWindow';
import ConversationDetails from '@/components/inbox/ConversationDetails';

export default function InboxPage() {
  const { conversations, activeConversationId, setConversations, setActiveConversation } = useInboxStore();
  const [loading, setLoading] = useState(true);

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
  }, [setConversations]);

  const activeConversation = conversations.find((c) => c.id === activeConversationId) ?? null;

  return (
    <div className="flex h-full">
      <ConversationList
        conversations={conversations}
        activeId={activeConversationId}
        onSelect={setActiveConversation}
        loading={loading}
      />
      {activeConversation ? (
        <>
          <ChatWindow conversation={activeConversation} />
          <ConversationDetails conversation={activeConversation} />
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-gray-400">
            <div className="text-6xl mb-4">💬</div>
            <p className="text-lg font-medium">Select a conversation</p>
            <p className="text-sm">Choose a conversation from the left to start messaging</p>
          </div>
        </div>
      )}
    </div>
  );
}
