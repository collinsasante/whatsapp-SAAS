import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'VerzChat — WhatsApp Business Inbox for Teams';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #0f766e 0%, #134e4a 60%, #0c2820 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '72px 80px',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'rgba(255,255,255,0.12)',
            borderRadius: 100,
            padding: '8px 18px',
            marginBottom: 32,
          }}
        >
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#34d399', display: 'flex' }} />
          <span style={{ fontSize: 16, color: '#a7f3d0', fontWeight: 600, letterSpacing: 0.5 }}>
            Official Meta Business Partner
          </span>
        </div>

        {/* Headline */}
        <div
          style={{
            fontSize: 68,
            fontWeight: 800,
            color: '#ffffff',
            lineHeight: 1.1,
            marginBottom: 20,
            maxWidth: 780,
          }}
        >
          WhatsApp Inbox for Your Team
        </div>

        {/* Sub */}
        <div
          style={{
            fontSize: 26,
            color: '#99f6e4',
            fontWeight: 400,
            maxWidth: 680,
            lineHeight: 1.4,
            marginBottom: 48,
          }}
        >
          Handle every customer message from one shared inbox. Teams live in under 20 minutes.
        </div>

        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: 'rgba(255,255,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
              fontWeight: 800,
              color: '#fff',
            }}
          >
            V
          </div>
          <span style={{ fontSize: 28, fontWeight: 700, color: '#ffffff' }}>VerzChat</span>
          <span style={{ fontSize: 18, color: '#5eead4', marginLeft: 8 }}>verzchat.com</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
