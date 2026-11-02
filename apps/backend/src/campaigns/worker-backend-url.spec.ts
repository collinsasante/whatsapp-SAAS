import { backendApiBase } from '../../../worker/src/lib/backend-url';

/** The worker calls the backend's HTTP API (trial-expired, subscription-downgraded). The backend serves everything under /api/v1. */
describe('worker backendApiBase', () => {
  it.each([
    [undefined, 'http://backend:3001/api/v1'],
    ['', 'http://backend:3001/api/v1'],
    ['  ', 'http://backend:3001/api/v1'],
    ['http://backend:3001', 'http://backend:3001/api/v1'],
    ['http://backend:3001/', 'http://backend:3001/api/v1'],
    ['http://backend:3001/api/v1', 'http://backend:3001/api/v1'],
    ['http://backend:3001/api/v1/', 'http://backend:3001/api/v1'],
    ['https://staging.example.test:8443', 'https://staging.example.test:8443/api/v1'],
  ])('%j -> %s', (input, expected) => {
    expect(backendApiBase(input)).toBe(expected);
  });

  it('the internal routes it is used for resolve under the prefix the backend really serves', () => {
    const base = backendApiBase('http://backend:3001');
    expect(`${base}/manage/settings/ai/trial-expired`).toBe('http://backend:3001/api/v1/manage/settings/ai/trial-expired');
  });
});
