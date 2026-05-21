import 'bootstrap/dist/css/bootstrap.min.css';
import '@/styles/landing.css';
import Footer from '@/components/landing/Footer';

export default function BookDemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp">
      {children}
      <Footer />
    </div>
  );
}
