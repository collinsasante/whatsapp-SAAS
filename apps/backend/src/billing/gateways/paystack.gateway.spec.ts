import { ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { PaystackGateway } from './paystack.gateway';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function gateway(secret: string) {
  return new PaystackGateway({ get: (key: string, fallback: string) => (key === 'PAYSTACK_SECRET_KEY' ? secret : fallback) } as never);
}

const init = { email: 'buyer@example.com', amountMajorUnits: 10, currency: 'GHS', tenantId: 't1' };

describe('PaystackGateway without a secret key', () => {
  beforeEach(() => jest.resetAllMocks());

  it('refuses locally with a 503 the user can act on, and never calls Paystack with an empty bearer token', async () => {
    await expect(gateway('').initializeTransaction(init)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('does the same when verifying a transaction', async () => {
    await expect(gateway('').verifyTransaction('ref-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('the message does not mention keys or internals', async () => {
    await expect(gateway('').initializeTransaction(init)).rejects.toThrow(/not available right now/i);
    await expect(gateway('').initializeTransaction(init)).rejects.not.toThrow(/key|secret|PAYSTACK/i);
  });
});

describe('PaystackGateway with a secret key', () => {
  beforeEach(() => jest.resetAllMocks());

  it('sends the bearer token and returns the access code', async () => {
    mockedAxios.post.mockResolvedValue({ data: { data: { access_code: 'ac', authorization_url: 'https://checkout.paystack.com/ac', reference: 'ref' } } });
    const out = await gateway('sk_test_value').initializeTransaction(init);
    expect(out).toMatchObject({ accessCode: 'ac', gatewayReference: 'ref' });
    expect(mockedAxios.post.mock.calls[0]![2]).toMatchObject({ headers: { Authorization: 'Bearer sk_test_value' } });
  });
});
