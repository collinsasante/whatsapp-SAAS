import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

// The page's own collaborators are replaced; the page, the CodeInput and the PIN logic are the real ones.
const mocks = vi.hoisted(() => ({
  login: vi.fn(), verify2FA: vi.fn(), setupPin: vi.fn(), setAuth: vi.fn(), replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/api', () => ({ authApi: { login: mocks.login, verify2FA: mocks.verify2FA, setupPin: mocks.setupPin, resendVerification: vi.fn(), selectWorkspace: vi.fn(), googleLogin: vi.fn() } }));
vi.mock('@/lib/firebase', () => ({ auth: {}, googleProvider: {} }));
vi.mock('firebase/auth', () => ({ signInWithPopup: vi.fn() }));
vi.mock('@/lib/socket', () => ({ disconnectSocket: vi.fn() }));
vi.mock('@/store/auth.store', () => ({ useAuthStore: () => ({ setAuth: mocks.setAuth }) }));

import LoginPage from './page';

const session = { accessToken: 'jwt', user: { id: 'u1', email: 'a@b.co', name: 'Ama', role: 'AGENT', tenantId: 't1' }, tenant: { id: 't1', name: 'Acme', onboardingCompleted: true } };
const httpError = (message: string) => ({ response: { data: { message } } });
const pinField = () => screen.getByLabelText('6-digit PIN') as HTMLInputElement;

async function reachStep(kind: 'requiresPin' | 'requiresPinSetup') {
  mocks.login.mockResolvedValueOnce({ data: { [kind]: true, tempToken: 'temp-1' } });
  render(<LoginPage />);
  fireEvent.change(screen.getByPlaceholderText('you@company.com'), { target: { value: 'a@b.co' } });
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'secret-pass' } });
  await act(async () => { fireEvent.submit(screen.getByPlaceholderText('you@company.com').closest('form')!); });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('PIN screen after login', () => {
  it('puts the cursor in the PIN field as soon as it appears, with no extra click', async () => {
    await reachStep('requiresPin');
    await waitFor(() => expect(pinField()).toBeInTheDocument());
    expect(document.activeElement).toBe(pinField());
    expect(pinField()).toHaveAttribute('autocomplete', 'one-time-code');
  });

  it('submits by itself the moment the sixth digit is in, with the temp token and the code, and signs the user in', async () => {
    mocks.verify2FA.mockResolvedValueOnce({ data: session });
    await reachStep('requiresPin');
    await waitFor(() => expect(pinField()).toBeInTheDocument());
    await act(async () => { fireEvent.change(pinField(), { target: { value: '123456' } }); });
    await waitFor(() => expect(mocks.setAuth).toHaveBeenCalledTimes(1));
    expect(mocks.verify2FA).toHaveBeenCalledTimes(1);
    expect(mocks.verify2FA).toHaveBeenCalledWith('temp-1', '123456');
    expect(mocks.replace).toHaveBeenCalledWith('/dashboard');
  });

  it('an autofilled or pasted code is accepted whole and submitted once', async () => {
    mocks.verify2FA.mockResolvedValueOnce({ data: session });
    await reachStep('requiresPin');
    await waitFor(() => expect(pinField()).toBeInTheDocument());
    await act(async () => { fireEvent.paste(pinField(), { clipboardData: { getData: () => '654 321' } }); });
    await waitFor(() => expect(mocks.verify2FA).toHaveBeenCalledWith('temp-1', '654321'));
    expect(mocks.verify2FA).toHaveBeenCalledTimes(1);
  });

  it('does not submit a short code, and typing digits one at a time submits only on the sixth', async () => {
    mocks.verify2FA.mockResolvedValueOnce({ data: session });
    await reachStep('requiresPin');
    await waitFor(() => expect(pinField()).toBeInTheDocument());
    for (const v of ['1', '12', '123', '1234', '12345']) await act(async () => { fireEvent.change(pinField(), { target: { value: v } }); });
    expect(mocks.verify2FA).not.toHaveBeenCalled();
    await act(async () => { fireEvent.change(pinField(), { target: { value: '123456' } }); });
    await waitFor(() => expect(mocks.verify2FA).toHaveBeenCalledTimes(1));
  });

  it('cannot be submitted twice while the first attempt is still verifying (paste, Enter and typing are all ignored)', async () => {
    let finish: (v: unknown) => void = () => undefined;
    mocks.verify2FA.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await reachStep('requiresPin');
    await waitFor(() => expect(pinField()).toBeInTheDocument());
    await act(async () => { fireEvent.change(pinField(), { target: { value: '123456' } }); });
    expect(pinField()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Verifying')).toBeInTheDocument();
    await act(async () => {
      fireEvent.paste(pinField(), { clipboardData: { getData: () => '123456' } });
      fireEvent.keyDown(pinField(), { key: 'Enter' });
      fireEvent.change(pinField(), { target: { value: '000000' } });
    });
    expect(mocks.verify2FA).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ data: session }); });
    await waitFor(() => expect(mocks.setAuth).toHaveBeenCalledTimes(1));
    expect(mocks.verify2FA).toHaveBeenCalledTimes(1);
  });

  it('two completions inside the same tick (autofill then Enter, before the screen re-renders) still send one request', async () => {
    mocks.verify2FA.mockResolvedValueOnce({ data: session });
    await reachStep('requiresPin');
    await waitFor(() => expect(pinField()).toBeInTheDocument());
    await act(async () => {
      fireEvent.change(pinField(), { target: { value: '123456' } });
      fireEvent.keyDown(pinField(), { key: 'Enter' });
      fireEvent.keyDown(pinField(), { key: 'Enter' });
    });
    await waitFor(() => expect(mocks.setAuth).toHaveBeenCalledTimes(1));
    expect(mocks.verify2FA).toHaveBeenCalledTimes(1);
  });

  it('a wrong PIN shows the server message, marks the field invalid, clears the tiles and allows another attempt', async () => {
    mocks.verify2FA.mockRejectedValueOnce(httpError('Incorrect PIN')).mockResolvedValueOnce({ data: session });
    await reachStep('requiresPin');
    await waitFor(() => expect(pinField()).toBeInTheDocument());
    await act(async () => { fireEvent.change(pinField(), { target: { value: '111111' } }); });
    await waitFor(() => expect(screen.getByText('Incorrect PIN')).toBeInTheDocument());
    expect(pinField()).toHaveAttribute('aria-invalid', 'true');
    expect(mocks.setAuth).not.toHaveBeenCalled();
    await waitFor(() => expect(pinField().value).toBe(''), { timeout: 1500 });
    await waitFor(() => expect(pinField()).toHaveAttribute('aria-invalid', 'false'));
    await act(async () => { fireEvent.change(pinField(), { target: { value: '222222' } }); });
    await waitFor(() => expect(mocks.verify2FA).toHaveBeenCalledTimes(2));
    expect(mocks.verify2FA).toHaveBeenLastCalledWith('temp-1', '222222');
    await waitFor(() => expect(mocks.setAuth).toHaveBeenCalledTimes(1));
  });

  it('an unreadable server failure still gives a useful message', async () => {
    mocks.verify2FA.mockRejectedValueOnce(new Error('Network Error'));
    await reachStep('requiresPin');
    await waitFor(() => expect(pinField()).toBeInTheDocument());
    await act(async () => { fireEvent.change(pinField(), { target: { value: '123456' } }); });
    await waitFor(() => expect(screen.getByText('Incorrect PIN')).toBeInTheDocument());
  });
});

describe('PIN setup on first login', () => {
  const choose = () => screen.getByLabelText('Choose a 6-digit PIN') as HTMLInputElement;
  const confirm = () => screen.getByLabelText('Confirm your 6-digit PIN') as HTMLInputElement;

  it('focuses the first field, moves to the second when the PIN is complete, and submits when the confirmation is complete', async () => {
    mocks.setupPin.mockResolvedValueOnce({ data: session });
    await reachStep('requiresPinSetup');
    await waitFor(() => expect(choose()).toBeInTheDocument());
    expect(document.activeElement).toBe(choose());
    await act(async () => { fireEvent.change(choose(), { target: { value: '482913' } }); });
    expect(document.activeElement).toBe(confirm());
    expect(mocks.setupPin).not.toHaveBeenCalled();
    await act(async () => { fireEvent.change(confirm(), { target: { value: '482913' } }); });
    await waitFor(() => expect(mocks.setupPin).toHaveBeenCalledTimes(1));
    expect(mocks.setupPin).toHaveBeenCalledWith('temp-1', '482913');
    await waitFor(() => expect(mocks.setAuth).toHaveBeenCalledTimes(1));
  });

  it('a mismatch is reported on the confirmation, nothing is sent, and the confirmation is cleared for another try', async () => {
    await reachStep('requiresPinSetup');
    await waitFor(() => expect(choose()).toBeInTheDocument());
    await act(async () => { fireEvent.change(choose(), { target: { value: '482913' } }); });
    await act(async () => { fireEvent.change(confirm(), { target: { value: '482914' } }); });
    await waitFor(() => expect(screen.getByText("PINs don't match")).toBeInTheDocument());
    expect(mocks.setupPin).not.toHaveBeenCalled();
    await waitFor(() => expect(confirm().value).toBe(''), { timeout: 1500 });
    expect(choose().value).toBe('482913');
    expect(document.activeElement).toBe(confirm());
  });

  it('a failure from the server clears only the confirmation and allows a retry', async () => {
    mocks.setupPin.mockRejectedValueOnce(httpError('PIN is too easy to guess')).mockResolvedValueOnce({ data: session });
    await reachStep('requiresPinSetup');
    await waitFor(() => expect(choose()).toBeInTheDocument());
    await act(async () => { fireEvent.change(choose(), { target: { value: '123456' } }); });
    await act(async () => { fireEvent.change(confirm(), { target: { value: '123456' } }); });
    await waitFor(() => expect(screen.getByText('PIN is too easy to guess')).toBeInTheDocument());
    await waitFor(() => expect(confirm().value).toBe(''), { timeout: 1500 });
    await act(async () => { fireEvent.change(confirm(), { target: { value: '123456' } }); });
    await waitFor(() => expect(mocks.setupPin).toHaveBeenCalledTimes(2));
  });
});
