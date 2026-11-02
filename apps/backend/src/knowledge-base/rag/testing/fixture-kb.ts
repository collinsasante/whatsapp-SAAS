import { ArticleRecord, contentHashOf } from '../vector-store';
import { RetrievalArticle } from '../hybrid-retriever';

/** TEST SUPPORT ONLY. A small synthetic bakery knowledge base (fictional; no real business or customer data). */
export interface FixtureArticle extends RetrievalArticle {
  tenantId: string;
  isActive: boolean;
}

const BASE: Array<[string, string]> = [
  ['Opening hours', 'We are open Monday to Friday from 7:00 to 18:00, Saturday from 8:00 to 16:00, and closed on Sundays. On public holidays we open 9:00 to 13:00.'],
  ['Location and parking', 'Fernhill Bakery is at 12 Orchard Row, next to the clock tower. There are six free parking spaces behind the shop and street parking on Orchard Row after 9:00.'],
  ['Daily bread menu', 'Every day we bake white sourdough ($5.50), seeded wholegrain ($6.00), rye loaf ($6.50) and baguettes ($2.80). Loaves sell out by early afternoon.'],
  ['Pastries and coffee', 'Butter croissants cost $3.20, almond croissants $3.80 and cinnamon rolls $3.50. A flat white is $3.60. Oat and soy milk are available at no extra charge.'],
  ['Custom celebration cakes', 'We make custom cakes for birthdays and small weddings. Orders need at least 72 hours notice. Prices start at $38 for a 6 inch cake serving 8 to 10 people.'],
  ['How to place a cake order', 'Message us with the date, the number of guests, the flavour and any wording for the cake. We confirm within one working day and ask for a 30 percent deposit.'],
  ['Local delivery', 'We deliver within 5 km of the shop, Monday to Friday between 10:00 and 15:00. The delivery fee is $4, and it is free for orders over $60. We do not deliver on weekends.'],
  ['Allergens and dietary options', 'Our kitchen handles wheat, milk, eggs, nuts and sesame. We offer a vegan seeded loaf on Wednesdays and Saturdays. We cannot guarantee a nut free environment.'],
  ['Payment methods', 'We accept cash, major debit and credit cards, and contactless payment. Cake deposits can be paid by card over the phone.'],
  ['Cancellations and refunds', 'Cake orders can be cancelled up to 48 hours before pickup for a full deposit refund. If a product is faulty, tell us within 24 hours and we will replace it.'],
  ['Corporate and bulk orders', 'For orders of more than 30 items, such as office breakfasts, ask for our bulk price list. We need five working days notice and will send a written quote.'],
  ['Contact details', 'Email hello@fernhill-bakery.example or call (555) 010-0142 during opening hours. Messages sent outside opening hours are answered the next morning.'],
];

export function fixtureArticles(tenantId: string, idPrefix: string): FixtureArticle[] {
  return BASE.map(([title, content], i) => ({ id: `${idPrefix}${i + 1}`, tenantId, title, content, isActive: true }));
}

/** An in-memory stand-in for the articles table: tenant-scoped reads, like the real loader and the SQL join. */
export class FixtureDirectory {
  constructor(public articles: FixtureArticle[]) {}

  activeFor(tenantId: string): RetrievalArticle[] {
    return this.articles.filter((a) => a.tenantId === tenantId && a.isActive).map(({ id, title, content }) => ({ id, title, content }));
  }

  record = (tenantId: string, articleId: string): ArticleRecord | undefined => {
    const a = this.articles.find((x) => x.tenantId === tenantId && x.id === articleId);
    return a ? { title: a.title, isActive: a.isActive, contentHash: contentHashOf(a.title, a.content) } : undefined;
  };
}
