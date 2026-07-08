import { deriveLifecycleStage, LifecycleInput } from './lifecycle.util';

const NOTHING: LifecycleInput = {
  hasWhatsappNumber: false,
  hasApprovedTemplate: false,
  hasFirstEngagement: false,
  hasInvitedTeammate: false,
  everConvertedToPaid: false,
  activeLast7Days: false,
};

describe('deriveLifecycleStage', () => {
  it('is signed_up when nothing else has happened', () => {
    expect(deriveLifecycleStage(NOTHING)).toBe('signed_up');
  });

  it('progresses to whatsapp_connected once a number is connected', () => {
    expect(deriveLifecycleStage({ ...NOTHING, hasWhatsappNumber: true })).toBe('whatsapp_connected');
  });

  it('progresses to template_approved once a template is approved', () => {
    expect(deriveLifecycleStage({ ...NOTHING, hasWhatsappNumber: true, hasApprovedTemplate: true })).toBe('template_approved');
  });

  it('progresses to first_engagement on a broadcast or handled conversation', () => {
    expect(deriveLifecycleStage({ ...NOTHING, hasWhatsappNumber: true, hasApprovedTemplate: true, hasFirstEngagement: true })).toBe('first_engagement');
  });

  it('progresses to team_invited once a teammate joins', () => {
    expect(deriveLifecycleStage({ ...NOTHING, hasFirstEngagement: true, hasInvitedTeammate: true })).toBe('team_invited');
  });

  it('reaches converted_paid once the subscription has ever gone ACTIVE, even without a teammate', () => {
    expect(deriveLifecycleStage({ ...NOTHING, everConvertedToPaid: true })).toBe('converted_paid');
  });

  it('does not un-convert on churn -- everConvertedToPaid stays true even if currently canceled', () => {
    expect(deriveLifecycleStage({ ...NOTHING, everConvertedToPaid: true, activeLast7Days: false })).toBe('converted_paid');
  });

  it('reaches the final stage only when paying AND active in the last 7 days', () => {
    expect(deriveLifecycleStage({ ...NOTHING, everConvertedToPaid: true, activeLast7Days: true })).toBe('active_last_7_days');
  });

  it('does not skip ahead to active_last_7_days on activity alone without ever paying', () => {
    expect(deriveLifecycleStage({ ...NOTHING, hasInvitedTeammate: true, activeLast7Days: true })).toBe('team_invited');
  });
});
