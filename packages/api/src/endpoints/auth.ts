import type { AxiosInstance } from 'axios';

export function createAuthApi(client: AxiosInstance) {
  return {
    login: (email: string, password: string) =>
      client.post('/auth/login', { email, password }),
    verify2FA: (tempToken: string, code: string) =>
      client.post('/auth/verify-2fa', { tempToken, code }),
    setupPin: (tempToken: string, pin: string) =>
      client.post('/auth/setup-pin', { tempToken, pin }),
    selectWorkspace: (tempToken: string, tenantId: string) =>
      client.post('/auth/select-workspace', { tempToken, tenantId }),
    // Mobile variants: same underlying auth logic, but the response includes
    // a refreshToken in the body instead of an HttpOnly cookie (no cookie jar
    // on React Native) -- see auth.controller.ts's "Mobile" section.
    loginMobile: (email: string, password: string) =>
      client.post('/auth/mobile/login', { email, password }),
    verify2FAMobile: (tempToken: string, code: string) =>
      client.post('/auth/mobile/verify-2fa', { tempToken, code }),
    setupPinMobile: (tempToken: string, pin: string) =>
      client.post('/auth/mobile/setup-pin', { tempToken, pin }),
    selectWorkspaceMobile: (tempToken: string, tenantId: string) =>
      client.post('/auth/mobile/select-workspace', { tempToken, tenantId }),
    register: (name: string, email: string, password: string, phoneNumber?: string) =>
      client.post('/auth/register', { name, email, password, ...(phoneNumber ? { phoneNumber } : {}) }),
    verifyEmail: (token: string) =>
      client.post('/auth/verify-email', { token }),
    resendVerification: (email: string) =>
      client.post('/auth/resend-verification', { email }),
    logout: () => client.post('/auth/logout'),
    forgotPassword: (email: string) => client.post('/auth/forgot-password', { email }),
    resetPassword: (token: string, password: string) =>
      client.post('/auth/reset-password', { token, password }),
    firebaseLogin: (idToken: string) => client.post('/auth/firebase', { idToken }),
    firebaseLoginMobile: (idToken: string) => client.post('/auth/mobile/firebase', { idToken }),
    googleMobileLogin: (accessToken: string) => client.post('/auth/google/mobile', { accessToken }),
    getWorkspaces: () => client.get('/auth/workspaces'),
    switchWorkspace: (workspaceId: string) =>
      client.post('/auth/switch-workspace', { workspaceId }),
    verifyInvite: (token: string) => client.get(`/auth/invite/verify/${token}`),
    acceptInvite: (token: string, name?: string, password?: string) =>
      client.post('/auth/invite/accept', { token, name, password }),
    getMe: () => client.get('/auth/me'),
    updateMe: (data: { name?: string; avatarUrl?: string }) =>
      client.patch('/auth/me', data),
    changePassword: (currentPassword: string, newPassword: string) =>
      client.patch('/auth/me/password', { currentPassword, newPassword }),
    changePin: (currentPin: string | undefined, newPin: string) =>
      client.patch('/auth/me/pin', { ...(currentPin ? { currentPin } : {}), newPin }),
  };
}
