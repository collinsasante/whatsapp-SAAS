import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MyDigitalSelf } from '@/lib/digital-self';

const mocks = vi.hoisted(() => ({
  mine: vi.fn(), decideConsent: vi.fn(), eraseMine: vi.fn(), showConfirm: vi.fn(), role: { current: 'AGENT' as string | undefined },
  toastOk: vi.fn(), toastErr: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ digitalSelfApi: { mine: mocks.mine, decideConsent: mocks.decideConsent, eraseMine: mocks.eraseMine } }));
vi.mock('@/store/auth.store', () => ({ useAuthStore: (sel: (s: { user: { role?: string } | null }) => unknown) => sel({ user: mocks.role.current ? { role: mocks.role.current } : null }) }));
vi.mock('@/store/confirm.store', () => ({ showConfirm: mocks.showConfirm }));
vi.mock('react-hot-toast', () => ({ default: { success: mocks.toastOk, error: mocks.toastErr } }));

import { DigitalSelfConsentPrompt } from './DigitalSelfConsentPrompt';
import { DigitalSelfAccountCard } from './DigitalSelfAccountCard';

const V = 'ds-consent-v1';
const state = (over: Partial<MyDigitalSelf> = {}): { data: MyDigitalSelf } => ({
  data: {
    eligible: true, workspaceAvailable: true, promptRequired: true, consentVersion: V,
    consent: { status: 'PENDING', decidedAt: null, need: 'decide' },
    learned: { evidenceCount: 0, lastLearnedAt: null, summary: null },
    ...over,
  },
});
const granted = (extra: Partial<MyDigitalSelf> = {}) => state({ promptRequired: false, consent: { status: 'GRANTED', decidedAt: '2026-11-05T09:00:00Z', need: 'none' }, learned: { evidenceCount: 12, lastLearnedAt: '2026-11-05T10:00:00Z', summary: null }, ...extra });

beforeEach(() => { vi.clearAllMocks(); mocks.role.current = 'AGENT'; mocks.showConfirm.mockResolvedValue(true); });

describe('consent prompt', () => {
  it('appears when the server says a decision is due, explaining what is learned, how it is used and how to withdraw', async () => {
    mocks.mine.mockResolvedValue(state());
    render(<DigitalSelfConsentPrompt />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Let Verz AI learn how you write?' })).toBeInTheDocument();
    for (const heading of ['What it learns', 'How it is used', 'Withdrawing']) expect(screen.getByText(heading)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
  });

  it.each([
    ['the agent has already decided', state({ promptRequired: false, consent: { status: 'GRANTED', decidedAt: 'x', need: 'none' } })],
    ['the workspace has not made it available', state({ promptRequired: false, workspaceAvailable: false })],
    ['the user is not eligible', state({ eligible: false, promptRequired: false, consent: null, learned: null })],
  ])('does not appear when %s', async (_l, res) => {
    mocks.mine.mockResolvedValue(res);
    render(<DigitalSelfConsentPrompt />);
    await waitFor(() => expect(mocks.mine).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('never even asks the server for a viewer or someone not signed in', async () => {
    mocks.role.current = 'VIEWER';
    render(<DigitalSelfConsentPrompt />);
    mocks.role.current = undefined;
    render(<DigitalSelfConsentPrompt />);
    await act(async () => { await Promise.resolve(); });
    expect(mocks.mine).not.toHaveBeenCalled();
  });

  it('asks again with different words when the wording changed', async () => {
    mocks.mine.mockResolvedValue(state({ consent: { status: 'GRANTED', decidedAt: 'x', need: 'reconfirm' } }));
    render(<DigitalSelfConsentPrompt />);
    expect(await screen.findByRole('heading', { name: 'Our Digital Self wording changed' })).toBeInTheDocument();
  });

  it('Accept sends the wording version the agent was shown, once, and the prompt goes away', async () => {
    mocks.mine.mockResolvedValue(state());
    mocks.decideConsent.mockResolvedValue(granted());
    render(<DigitalSelfConsentPrompt />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.decideConsent).toHaveBeenCalledTimes(1);
    expect(mocks.decideConsent).toHaveBeenCalledWith('ACCEPT', { version: V });
    expect(mocks.toastOk).toHaveBeenCalled();
  });

  it('Decline sends no version and no data, and the prompt goes away', async () => {
    mocks.mine.mockResolvedValue(state());
    mocks.decideConsent.mockResolvedValue(state({ promptRequired: false, consent: { status: 'DECLINED', decidedAt: 'x', need: 'none' } }));
    render(<DigitalSelfConsentPrompt />);
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.decideConsent).toHaveBeenCalledWith('DECLINE', {});
  });

  it('cannot decide twice: rapid clicks on both buttons send one request, and both are disabled meanwhile', async () => {
    mocks.mine.mockResolvedValue(state());
    let finish: (v: unknown) => void = () => undefined;
    mocks.decideConsent.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    render(<DigitalSelfConsentPrompt />);
    const accept = await screen.findByRole('button', { name: 'Accept' });
    const decline = screen.getByRole('button', { name: 'Decline' });
    await act(async () => { fireEvent.click(accept); fireEvent.click(accept); fireEvent.click(decline); });
    expect(mocks.decideConsent).toHaveBeenCalledTimes(1);
    expect(accept).toBeDisabled();
    expect(decline).toBeDisabled();
    await act(async () => { finish(granted()); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a failure keeps the prompt open with a message and lets the agent try again', async () => {
    mocks.mine.mockResolvedValue(state());
    mocks.decideConsent.mockRejectedValueOnce({ response: { data: { message: 'The consent wording has changed. Reload the page and read it again before agreeing.' } } }).mockResolvedValueOnce(granted());
    render(<DigitalSelfConsentPrompt />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('wording has changed');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.decideConsent).toHaveBeenCalledTimes(2);
  });

  it('closing is not a decision: Escape does not dismiss it and nothing is sent', async () => {
    mocks.mine.mockResolvedValue(state());
    render(<DigitalSelfConsentPrompt />);
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mocks.decideConsent).not.toHaveBeenCalled();
  });

  it('the dialog is accessible: modal, labelled by its heading, focus moves inside', async () => {
    mocks.mine.mockResolvedValue(state());
    render(<DigitalSelfConsentPrompt />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe('Account card', () => {
  it('is not shown to someone with nothing to decide or manage (workspace off, never decided, nothing learned)', async () => {
    mocks.mine.mockResolvedValue(state({ promptRequired: false, workspaceAvailable: false }));
    render(<DigitalSelfAccountCard />);
    await waitFor(() => expect(mocks.mine).toHaveBeenCalled());
    expect(screen.queryByTestId('digital-self-card')).toBeNull();
  });

  it('is still shown after the workspace switches it off, when the agent has data to manage', async () => {
    mocks.mine.mockResolvedValue(granted({ workspaceAvailable: false }));
    render(<DigitalSelfAccountCard />);
    expect(await screen.findByTestId('digital-self-card')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete what was learned' })).toBeInTheDocument();
  });

  it('shows an agreed state with the number of replies learned, and offers withdrawal and deletion', async () => {
    mocks.mine.mockResolvedValue(granted());
    render(<DigitalSelfAccountCard />);
    expect(await screen.findByText('Agreed')).toBeInTheDocument();
    expect(screen.getByText(/12 replies learned from/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw consent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete what was learned' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agree' })).toBeNull();
  });

  it('withdrawing asks first; cancelling sends nothing, confirming sends WITHDRAW for the caller only', async () => {
    mocks.mine.mockResolvedValueOnce(granted()).mockResolvedValue(state({ promptRequired: false, consent: { status: 'WITHDRAWN', decidedAt: 'x', need: 'none' }, learned: { evidenceCount: 12, lastLearnedAt: null, summary: null } }));
    mocks.decideConsent.mockResolvedValue({});
    render(<DigitalSelfAccountCard />);
    const button = await screen.findByRole('button', { name: 'Withdraw consent' });
    mocks.showConfirm.mockResolvedValueOnce(false);
    fireEvent.click(button);
    await act(async () => { await Promise.resolve(); });
    expect(mocks.decideConsent).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(mocks.decideConsent).toHaveBeenCalledWith('WITHDRAW'));
    expect(await screen.findByText('Withdrawn')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agree' })).toBeInTheDocument();
    expect(mocks.decideConsent.mock.calls[0]).toHaveLength(1); // no id of anyone else is ever sent
  });

  it('deleting what was learned is a destructive confirmation, then one request that changes nothing about consent', async () => {
    mocks.mine.mockResolvedValue(granted());
    mocks.eraseMine.mockResolvedValue({});
    render(<DigitalSelfAccountCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete what was learned' }));
    await waitFor(() => expect(mocks.eraseMine).toHaveBeenCalledTimes(1));
    expect(mocks.showConfirm).toHaveBeenCalledWith('Delete everything learned about you?', expect.objectContaining({ danger: true }));
    expect(mocks.decideConsent).not.toHaveBeenCalled();
  });

  it('after declining, the agent can change their mind and agree with the current wording', async () => {
    mocks.mine.mockResolvedValue(state({ promptRequired: false, consent: { status: 'DECLINED', decidedAt: 'x', need: 'none' } }));
    mocks.decideConsent.mockResolvedValue({});
    render(<DigitalSelfAccountCard />);
    expect(await screen.findByText('Declined')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Agree' }));
    await waitFor(() => expect(mocks.decideConsent).toHaveBeenCalledWith('ACCEPT', { version: V }));
  });

  it('cannot agree while the workspace has it switched off', async () => {
    mocks.mine.mockResolvedValue(state({ promptRequired: false, workspaceAvailable: false, consent: { status: 'WITHDRAWN', decidedAt: 'x', need: 'none' }, learned: { evidenceCount: 3, lastLearnedAt: null, summary: null } }));
    render(<DigitalSelfAccountCard />);
    expect(await screen.findByRole('button', { name: 'Agree' })).toBeDisabled();
  });

  it('a failed request shows an error and leaves the state as it was', async () => {
    mocks.mine.mockResolvedValue(granted());
    mocks.decideConsent.mockRejectedValue(new Error('Network Error'));
    render(<DigitalSelfAccountCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw consent' }));
    await waitFor(() => expect(mocks.toastErr).toHaveBeenCalled());
    expect(screen.getByText('Agreed')).toBeInTheDocument();
  });
});
