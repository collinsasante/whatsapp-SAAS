'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Mail, Lock, User, Phone, ArrowRight, Loader2, Search, ChevronDown } from 'lucide-react';
import { authApi } from '@/lib/api';

function PasswordStrength({ password }: { password: string }) {
  const checks = [password.length >= 8, /[A-Z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)];
  const score = checks.filter(Boolean).length;
  const colors = ['bg-gray-200', 'bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-green-500'];
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  if (!password) return null;
  return (
    <div className="mt-2">
      <div className="flex gap-1 mb-1">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i < score ? colors[score] : 'bg-gray-200'}`} />)}
      </div>
      <p className={`text-xs ${score <= 1 ? 'text-red-500' : score === 2 ? 'text-orange-500' : score === 3 ? 'text-yellow-600' : 'text-green-600'}`}>{labels[score]}</p>
    </div>
  );
}

const COUNTRY_CODES = [
  { code: '+1', label: '🇺🇸 US +1' }, { code: '+1', label: '🇨🇦 CA +1' }, { code: '+44', label: '🇬🇧 GB +44' },
  { code: '+93', label: '🇦🇫 AF +93' }, { code: '+355', label: '🇦🇱 AL +355' }, { code: '+213', label: '🇩🇿 DZ +213' },
  { code: '+376', label: '🇦🇩 AD +376' }, { code: '+244', label: '🇦🇴 AO +244' }, { code: '+1', label: '🇦🇬 AG +1' },
  { code: '+54', label: '🇦🇷 AR +54' }, { code: '+374', label: '🇦🇲 AM +374' }, { code: '+61', label: '🇦🇺 AU +61' },
  { code: '+43', label: '🇦🇹 AT +43' }, { code: '+994', label: '🇦🇿 AZ +994' }, { code: '+1', label: '🇧🇸 BS +1' },
  { code: '+973', label: '🇧🇭 BH +973' }, { code: '+880', label: '🇧🇩 BD +880' }, { code: '+1', label: '🇧🇧 BB +1' },
  { code: '+375', label: '🇧🇾 BY +375' }, { code: '+32', label: '🇧🇪 BE +32' }, { code: '+501', label: '🇧🇿 BZ +501' },
  { code: '+229', label: '🇧🇯 BJ +229' }, { code: '+975', label: '🇧🇹 BT +975' }, { code: '+591', label: '🇧🇴 BO +591' },
  { code: '+387', label: '🇧🇦 BA +387' }, { code: '+267', label: '🇧🇼 BW +267' }, { code: '+55', label: '🇧🇷 BR +55' },
  { code: '+673', label: '🇧🇳 BN +673' }, { code: '+359', label: '🇧🇬 BG +359' }, { code: '+226', label: '🇧🇫 BF +226' },
  { code: '+257', label: '🇧🇮 BI +257' }, { code: '+238', label: '🇨🇻 CV +238' }, { code: '+855', label: '🇰🇭 KH +855' },
  { code: '+237', label: '🇨🇲 CM +237' }, { code: '+236', label: '🇨🇫 CF +236' }, { code: '+235', label: '🇹🇩 TD +235' },
  { code: '+56', label: '🇨🇱 CL +56' }, { code: '+86', label: '🇨🇳 CN +86' }, { code: '+57', label: '🇨🇴 CO +57' },
  { code: '+269', label: '🇰🇲 KM +269' }, { code: '+242', label: '🇨🇬 CG +242' }, { code: '+243', label: '🇨🇩 CD +243' },
  { code: '+506', label: '🇨🇷 CR +506' }, { code: '+385', label: '🇭🇷 HR +385' }, { code: '+53', label: '🇨🇺 CU +53' },
  { code: '+357', label: '🇨🇾 CY +357' }, { code: '+420', label: '🇨🇿 CZ +420' }, { code: '+45', label: '🇩🇰 DK +45' },
  { code: '+253', label: '🇩🇯 DJ +253' }, { code: '+1', label: '🇩🇲 DM +1' }, { code: '+1', label: '🇩🇴 DO +1' },
  { code: '+593', label: '🇪🇨 EC +593' }, { code: '+20', label: '🇪🇬 EG +20' }, { code: '+503', label: '🇸🇻 SV +503' },
  { code: '+240', label: '🇬🇶 GQ +240' }, { code: '+291', label: '🇪🇷 ER +291' }, { code: '+372', label: '🇪🇪 EE +372' },
  { code: '+268', label: '🇸🇿 SZ +268' }, { code: '+251', label: '🇪🇹 ET +251' }, { code: '+679', label: '🇫🇯 FJ +679' },
  { code: '+358', label: '🇫🇮 FI +358' }, { code: '+33', label: '🇫🇷 FR +33' }, { code: '+241', label: '🇬🇦 GA +241' },
  { code: '+220', label: '🇬🇲 GM +220' }, { code: '+995', label: '🇬🇪 GE +995' }, { code: '+49', label: '🇩🇪 DE +49' },
  { code: '+233', label: '🇬🇭 GH +233' }, { code: '+30', label: '🇬🇷 GR +30' }, { code: '+1', label: '🇬🇩 GD +1' },
  { code: '+502', label: '🇬🇹 GT +502' }, { code: '+224', label: '🇬🇳 GN +224' }, { code: '+245', label: '🇬🇼 GW +245' },
  { code: '+592', label: '🇬🇾 GY +592' }, { code: '+509', label: '🇭🇹 HT +509' }, { code: '+504', label: '🇭🇳 HN +504' },
  { code: '+36', label: '🇭🇺 HU +36' }, { code: '+354', label: '🇮🇸 IS +354' }, { code: '+91', label: '🇮🇳 IN +91' },
  { code: '+62', label: '🇮🇩 ID +62' }, { code: '+98', label: '🇮🇷 IR +98' }, { code: '+964', label: '🇮🇶 IQ +964' },
  { code: '+353', label: '🇮🇪 IE +353' }, { code: '+972', label: '🇮🇱 IL +972' }, { code: '+39', label: '🇮🇹 IT +39' },
  { code: '+1', label: '🇯🇲 JM +1' }, { code: '+81', label: '🇯🇵 JP +81' }, { code: '+962', label: '🇯🇴 JO +962' },
  { code: '+7', label: '🇷🇺 RU +7' }, { code: '+7', label: '🇰🇿 KZ +7' }, { code: '+254', label: '🇰🇪 KE +254' },
  { code: '+686', label: '🇰🇮 KI +686' }, { code: '+383', label: '🇽🇰 XK +383' }, { code: '+965', label: '🇰🇼 KW +965' },
  { code: '+996', label: '🇰🇬 KG +996' }, { code: '+856', label: '🇱🇦 LA +856' }, { code: '+371', label: '🇱🇻 LV +371' },
  { code: '+961', label: '🇱🇧 LB +961' }, { code: '+266', label: '🇱🇸 LS +266' }, { code: '+231', label: '🇱🇷 LR +231' },
  { code: '+218', label: '🇱🇾 LY +218' }, { code: '+423', label: '🇱🇮 LI +423' }, { code: '+370', label: '🇱🇹 LT +370' },
  { code: '+352', label: '🇱🇺 LU +352' }, { code: '+261', label: '🇲🇬 MG +261' }, { code: '+265', label: '🇲🇼 MW +265' },
  { code: '+60', label: '🇲🇾 MY +60' }, { code: '+960', label: '🇲🇻 MV +960' }, { code: '+223', label: '🇲🇱 ML +223' },
  { code: '+356', label: '🇲🇹 MT +356' }, { code: '+692', label: '🇲🇭 MH +692' }, { code: '+222', label: '🇲🇷 MR +222' },
  { code: '+230', label: '🇲🇺 MU +230' }, { code: '+52', label: '🇲🇽 MX +52' }, { code: '+691', label: '🇫🇲 FM +691' },
  { code: '+373', label: '🇲🇩 MD +373' }, { code: '+377', label: '🇲🇨 MC +377' }, { code: '+976', label: '🇲🇳 MN +976' },
  { code: '+382', label: '🇲🇪 ME +382' }, { code: '+212', label: '🇲🇦 MA +212' }, { code: '+258', label: '🇲🇿 MZ +258' },
  { code: '+264', label: '🇳🇦 NA +264' }, { code: '+674', label: '🇳🇷 NR +674' }, { code: '+977', label: '🇳🇵 NP +977' },
  { code: '+31', label: '🇳🇱 NL +31' }, { code: '+64', label: '🇳🇿 NZ +64' }, { code: '+505', label: '🇳🇮 NI +505' },
  { code: '+227', label: '🇳🇪 NE +227' }, { code: '+234', label: '🇳🇬 NG +234' }, { code: '+389', label: '🇲🇰 MK +389' },
  { code: '+47', label: '🇳🇴 NO +47' }, { code: '+968', label: '🇴🇲 OM +968' }, { code: '+92', label: '🇵🇰 PK +92' },
  { code: '+680', label: '🇵🇼 PW +680' }, { code: '+970', label: '🇵🇸 PS +970' }, { code: '+507', label: '🇵🇦 PA +507' },
  { code: '+675', label: '🇵🇬 PG +675' }, { code: '+595', label: '🇵🇾 PY +595' }, { code: '+51', label: '🇵🇪 PE +51' },
  { code: '+63', label: '🇵🇭 PH +63' }, { code: '+48', label: '🇵🇱 PL +48' }, { code: '+351', label: '🇵🇹 PT +351' },
  { code: '+974', label: '🇶🇦 QA +974' }, { code: '+40', label: '🇷🇴 RO +40' }, { code: '+250', label: '🇷🇼 RW +250' },
  { code: '+1', label: '🇰🇳 KN +1' }, { code: '+1', label: '🇱🇨 LC +1' }, { code: '+1', label: '🇻🇨 VC +1' },
  { code: '+685', label: '🇼🇸 WS +685' }, { code: '+378', label: '🇸🇲 SM +378' }, { code: '+239', label: '🇸🇹 ST +239' },
  { code: '+966', label: '🇸🇦 SA +966' }, { code: '+221', label: '🇸🇳 SN +221' }, { code: '+381', label: '🇷🇸 RS +381' },
  { code: '+248', label: '🇸🇨 SC +248' }, { code: '+232', label: '🇸🇱 SL +232' }, { code: '+65', label: '🇸🇬 SG +65' },
  { code: '+421', label: '🇸🇰 SK +421' }, { code: '+386', label: '🇸🇮 SI +386' }, { code: '+677', label: '🇸🇧 SB +677' },
  { code: '+252', label: '🇸🇴 SO +252' }, { code: '+27', label: '🇿🇦 ZA +27' }, { code: '+211', label: '🇸🇸 SS +211' },
  { code: '+34', label: '🇪🇸 ES +34' }, { code: '+94', label: '🇱🇰 LK +94' }, { code: '+249', label: '🇸🇩 SD +249' },
  { code: '+597', label: '🇸🇷 SR +597' }, { code: '+46', label: '🇸🇪 SE +46' }, { code: '+41', label: '🇨🇭 CH +41' },
  { code: '+963', label: '🇸🇾 SY +963' }, { code: '+886', label: '🇹🇼 TW +886' }, { code: '+992', label: '🇹🇯 TJ +992' },
  { code: '+255', label: '🇹🇿 TZ +255' }, { code: '+66', label: '🇹🇭 TH +66' }, { code: '+670', label: '🇹🇱 TL +670' },
  { code: '+228', label: '🇹🇬 TG +228' }, { code: '+676', label: '🇹🇴 TO +676' }, { code: '+1', label: '🇹🇹 TT +1' },
  { code: '+216', label: '🇹🇳 TN +216' }, { code: '+90', label: '🇹🇷 TR +90' }, { code: '+993', label: '🇹🇲 TM +993' },
  { code: '+688', label: '🇹🇻 TV +688' }, { code: '+256', label: '🇺🇬 UG +256' }, { code: '+380', label: '🇺🇦 UA +380' },
  { code: '+971', label: '🇦🇪 AE +971' }, { code: '+598', label: '🇺🇾 UY +598' }, { code: '+998', label: '🇺🇿 UZ +998' },
  { code: '+678', label: '🇻🇺 VU +678' }, { code: '+39', label: '🇻🇦 VA +39' }, { code: '+58', label: '🇻🇪 VE +58' },
  { code: '+84', label: '🇻🇳 VN +84' }, { code: '+967', label: '🇾🇪 YE +967' }, { code: '+260', label: '🇿🇲 ZM +260' },
  { code: '+263', label: '🇿🇼 ZW +263' },
];

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', phoneNumber: '', countryCode: '+1' });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeSearch, setCodeSearch] = useState('');
  const codeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (codeRef.current && !codeRef.current.contains(e.target as Node)) setCodeOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredCodes = COUNTRY_CODES.filter((c) =>
    c.label.toLowerCase().includes(codeSearch.toLowerCase())
  );
  const selectedLabel = COUNTRY_CODES.find((c) => c.code === form.countryCode)?.label ?? form.countryCode;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) { toast.error('Passwords do not match'); return; }
    setLoading(true);
    const fullPhone = form.phoneNumber ? `${form.countryCode}${form.phoneNumber.replace(/^\+/, '')}` : '';
    try {
      const res = await authApi.register(form.name, form.email, form.password, fullPhone || undefined);
      const data = res.data as { requiresEmailVerification: boolean; email: string };
      if (data.requiresEmailVerification) {
        router.push(`/verify-email/pending?email=${encodeURIComponent(data.email)}`);
      } else {
        toast.success('Account created! Please sign in.');
        router.push('/login');
      }
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Registration failed'
        : 'Registration failed';
      toast.error(typeof message === 'string' ? message : 'Registration failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="w-full max-w-[420px]">
      <div className="lg:hidden flex items-center mb-8 justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="VerzChat" className="h-9" />
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Create your account</h1>
          <p className="text-gray-500 text-sm mt-1">Get started in under 2 minutes. No credit card needed.</p>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="text" required placeholder="Jane Smith" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors bg-gray-50 focus:bg-white" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Work Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="email" required placeholder="jane@company.com" value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors bg-gray-50 focus:bg-white" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone Number <span className="text-gray-400 font-normal">(optional)</span></label>
            <div className="flex gap-2">
              <div ref={codeRef} className="relative flex-shrink-0">
                <button type="button" onClick={() => { setCodeOpen((v) => !v); setCodeSearch(''); }}
                  className="w-28 flex items-center justify-between gap-1 px-2 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 hover:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors">
                  <span className="truncate">{selectedLabel}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                </button>
                {codeOpen && (
                  <div className="absolute z-50 top-full mt-1 left-0 w-64 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                    <div className="p-2 border-b border-gray-100">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                        <input autoFocus type="text" placeholder="Search country…" value={codeSearch}
                          onChange={(e) => setCodeSearch(e.target.value)}
                          className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-teal-500" />
                      </div>
                    </div>
                    <ul className="max-h-48 overflow-y-auto">
                      {filteredCodes.length === 0 && (
                        <li className="px-3 py-2 text-sm text-gray-400">No results</li>
                      )}
                      {filteredCodes.map((c, i) => (
                        <li key={`${c.label}-${i}`}>
                          <button type="button"
                            onClick={() => { setForm((f) => ({ ...f, countryCode: c.code })); setCodeOpen(false); setCodeSearch(''); }}
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${form.countryCode === c.code ? 'bg-teal-50 text-teal-700 font-medium' : 'text-gray-700'}`}>
                            {c.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="relative flex-1">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="tel" placeholder="234 567 8900" value={form.phoneNumber}
                  onChange={(e) => setForm((f) => ({ ...f, phoneNumber: e.target.value }))}
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors bg-gray-50 focus:bg-white" />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type={showPassword ? 'text' : 'password'} required minLength={8} placeholder="Min 8 characters"
                value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="w-full pl-9 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors bg-gray-50 focus:bg-white" />
              <button type="button" onClick={() => setShowPassword((v) => !v)} tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <PasswordStrength password={form.password} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type={showConfirm ? 'text' : 'password'} required placeholder="Repeat password"
                value={form.confirmPassword} onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                className={`w-full pl-9 pr-10 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-colors bg-gray-50 focus:bg-white ${form.confirmPassword && form.password !== form.confirmPassword ? 'border-red-300 focus:ring-red-500/20 focus:border-red-500' : 'border-gray-200 focus:ring-teal-500/20 focus:border-teal-500'}`} />
              <button type="button" onClick={() => setShowConfirm((v) => !v)} tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {form.confirmPassword && form.password !== form.confirmPassword && (
              <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
            )}
          </div>

          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-teal-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors mt-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating account...</> : <><span>Create Account</span><ArrowRight className="w-4 h-4" /></>}
          </button>
        </form>
      </div>

      <p className="text-center text-sm text-gray-500 mt-5">
        Already have an account?{' '}
        <Link href="/login" className="text-teal-600 font-semibold hover:underline">Sign in</Link>
      </p>
    </div>
  );
}
