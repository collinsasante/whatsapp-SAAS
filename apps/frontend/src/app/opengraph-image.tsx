import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'VerzChat: WhatsApp shared inbox with AI for teams';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#104a25',
          color: '#ffffff',
          padding: '72px 80px',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', fontSize: 34, fontWeight: 800, letterSpacing: -0.5 }}>VerzChat</div>

        <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 860 }}>
          <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.02, letterSpacing: -2 }}>
            A customer messages at 9 pm. Who answers?
          </div>
          <div style={{ fontSize: 30, marginTop: 28, color: '#bcd9c4', lineHeight: 1.35 }}>
            One shared inbox for WhatsApp, with every chat owned by an agent or Verz AI.
          </div>
        </div>

        <svg width="260" height="156" viewBox="0 0 200 120" fill="none" style={{ position: 'absolute', right: 56, bottom: 36 }}>
          <path d="M14 66l38 38L118 18" stroke="#17612f" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M84 98l6 6L186 18" stroke="#17612f" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
