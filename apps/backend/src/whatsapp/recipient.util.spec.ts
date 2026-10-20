import { recipientField } from './recipient.util';

describe('recipientField', () => {
  it.each(['GH.1115168874544553', 'US.13491208655302741918', 'US.ENT.11815799212886844830'])('addresses the Business-Scoped User ID %s by `recipient`', (id) => {
    expect(recipientField(id)).toEqual({ recipient: id });
  });

  it.each(['+233555000111', '233555000111', '+18601671151650', '', 'status', 'gh.123', 'GH.', '.123', 'GHA.123'])('addresses %p by `to`', (value) => {
    expect(recipientField(value)).toEqual({ to: value });
  });

  it('never sets both fields', () => {
    expect(Object.keys(recipientField('GH.123'))).toEqual(['recipient']);
    expect(Object.keys(recipientField('+233555000111'))).toEqual(['to']);
  });
});
