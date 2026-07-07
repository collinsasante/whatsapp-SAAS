import 'bootstrap/dist/css/bootstrap.min.css';
import '@/styles/landing.css';
import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp">
      <Navbar />
      {children}
      <Footer />
    </div>
  );
}
