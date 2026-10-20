'use client';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatMessageTime } from '@/lib/utils';
import { placePreview, type ConversationPreviewData } from '@/lib/conversation-preview';

const CARD_WIDTH = 300;
const FALLBACK_HEIGHT = 140;

interface Props {
  id: string;
  anchor: DOMRect;
  data: ConversationPreviewData;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

/**
 * Read-only preview of a conversation's latest message. Rendered in a portal because inbox rows sit inside
 * transformed (animated) parents, which would otherwise make `position: fixed` relative to the row.
 */
export function ConversationPreviewCard({ id, anchor, data, onPointerEnter, onPointerLeave }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? FALLBACK_HEIGHT;
    setPos(placePreview(anchor, { width: CARD_WIDTH, height }, { width: window.innerWidth, height: window.innerHeight }));
  }, [anchor, data.body, data.mediaLabel]);

  if (typeof document === 'undefined') return null;
  const who = data.direction === 'OUTBOUND' ? 'You' : data.direction === 'INBOUND' ? data.name : null;

  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      data-testid="conversation-preview"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: CARD_WIDTH }}
      className="z-50 bg-white rounded-xl shadow-xl border border-gray-100 p-3.5"
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-sm font-semibold text-gray-900 truncate">{data.name}</span>
        {data.time && <span className="text-xs text-gray-400 flex-shrink-0">{formatMessageTime(data.time)}</span>}
      </div>
      {data.body ? (
        <p className="text-sm text-gray-700 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
          {who && <span className="font-medium text-gray-500">{who}: </span>}
          {data.body}
        </p>
      ) : data.mediaLabel ? (
        <p className="text-sm text-gray-700">
          {who && <span className="font-medium text-gray-500">{who}: </span>}
          {data.mediaLabel}
        </p>
      ) : (
        <p className="text-sm text-gray-400">No messages to show yet.</p>
      )}
    </div>,
    document.body,
  );
}
