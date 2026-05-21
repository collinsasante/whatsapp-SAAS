const REVIEWS = [
  {
    name: 'Amara Diallo',
    biz: 'Kente Couture, Ghana',
    init: 'A',
    stars: 5,
    text: 'Before VerzChat, two of us were sharing one WhatsApp phone. Now our whole team of 6 handles every order and question from one screen. Response time went from hours to under 3 minutes.',
  },
  {
    name: 'Chidi Okonkwo',
    biz: 'QuickFix Logistics, Nigeria',
    init: 'C',
    stars: 5,
    text: 'The broadcast campaigns alone were worth switching. We sent delivery updates to 8,000 customers last week — all delivered, all tracked. No more copy-pasting into WhatsApp one by one.',
  },
  {
    name: 'Fatima Al-Rashid',
    biz: 'Blossom Pharmacy, Kenya',
    init: 'F',
    stars: 5,
    text: 'The chatbot handles prescription refill requests automatically. Our pharmacists only step in for the complex cases. It\'s honestly changed how we operate.',
  },
  {
    name: 'Kwame Asante',
    biz: 'Urban Eats GH, Accra',
    init: 'K',
    stars: 5,
    text: 'Setup was genuinely under 20 minutes. The whole team was live on the same inbox by lunchtime. The analytics showing our response time and CSAT are something our old setup never had.',
  },
];

function Stars({ n }: { n: number }) {
  return (
    <div className="stars">
      {Array.from({ length: n }).map((_, i) => (
        <span key={i}>★</span>
      ))}
    </div>
  );
}

export default function Proof() {
  const left  = REVIEWS.filter((_, i) => i % 2 === 0);
  const right = REVIEWS.filter((_, i) => i % 2 !== 0);

  return (
    <section className="py-20 bg-gray-50/40" style={{ borderTop: '1px solid #f3f4f6' }}>
      <div className="container">
        <div className="text-center sec_title" data-aos="fade-up">
          <span className="sec_badge">Testimonials</span>
          <h2>Teams That Switched, Never Looked Back</h2>
          <p>Businesses across Africa use VerzChat to manage every customer conversation on WhatsApp.</p>
        </div>

        <div className="row g-4">
          <div className="col-lg-6">
            {left.map((r) => (
              <div key={r.name} className="rev_card" data-aos="fade-right">
                <div className="rev_top">
                  <div className="rev_info">
                    <div className="av">{r.init}</div>
                    <div>
                      <p className="rev_name">{r.name}</p>
                      <p className="rev_biz">{r.biz}</p>
                    </div>
                  </div>
                  <Stars n={r.stars} />
                </div>
                <p className="rev_text">&ldquo;{r.text}&rdquo;</p>
              </div>
            ))}
          </div>
          <div className="col-lg-6">
            {right.map((r) => (
              <div key={r.name} className="rev_card" data-aos="fade-left">
                <div className="rev_top">
                  <div className="rev_info">
                    <div className="av" style={{ background: '#104a25' }}>{r.init}</div>
                    <div>
                      <p className="rev_name">{r.name}</p>
                      <p className="rev_biz">{r.biz}</p>
                    </div>
                  </div>
                  <Stars n={r.stars} />
                </div>
                <p className="rev_text">&ldquo;{r.text}&rdquo;</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
