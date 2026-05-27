import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query,
  Req, Res, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateProfileDto, ChangePasswordDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload } from '@whatsapp-platform/shared-types';

const COOKIE_NAME = 'refresh_token';
const COOKIE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  private setRefreshCookie(res: Response, token: string) {
    const isProd = this.configService.get<string>('app.nodeEnv') === 'production';
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'strict' : 'lax',
      path: '/',
      maxAge: COOKIE_MAX_AGE_MS,
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(COOKIE_NAME, { path: '/' });
  }

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Register a new workspace and admin user' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email address via token from email link' })
  verifyEmail(@Body() body: { token: string }) {
    if (!body?.token) throw new Error('token is required');
    return this.authService.verifyEmail(body.token);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Resend email verification link' })
  resendVerification(@Body() body: { email: string }) {
    if (!body?.email) throw new Error('email is required');
    return this.authService.resendVerification(body.email);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Login with email and password — returns requiresPin, requiresPinSetup, requiresWorkspaceSelection, or full tokens' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip ?? req.socket?.remoteAddress;
    const result = await this.authService.login(dto, ip);

    if ('requiresPin' in result || 'requiresPinSetup' in result || 'requiresWorkspaceSelection' in result) return result;

    // Full tokens path (SKIP_2FA=true or similar)
    this.setRefreshCookie(res, (result as { refreshToken: string }).refreshToken);
    const { refreshToken: _, ...safe } = result as typeof result & { refreshToken: string };
    return safe;
  }

  @Post('setup-pin')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Set login PIN for the first time after password verification' })
  async setupPin(
    @Body() body: { tempToken: string; pin: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip ?? req.socket?.remoteAddress;
    const result = await this.authService.setupPin(body.tempToken, body.pin, ip);
    this.setRefreshCookie(res, result.refreshToken);
    const { refreshToken: _, ...safe } = result;
    return safe;
  }

  @Post('select-workspace')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Complete login by selecting a workspace (multi-workspace accounts)' })
  async selectWorkspace(
    @Body() body: { tempToken: string; tenantId: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip ?? req.socket?.remoteAddress;
    const result = await this.authService.selectWorkspace(body.tempToken, body.tenantId, ip);
    this.setRefreshCookie(res, result.refreshToken);
    const { refreshToken: _, ...safe } = result;
    return safe;
  }

  @Post('verify-2fa')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify login PIN and complete sign-in' })
  async verify2FA(
    @Body() body: { tempToken: string; code: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip ?? req.socket?.remoteAddress;
    const result = await this.authService.verify2FA(body.tempToken, body.code, ip);
    this.setRefreshCookie(res, result.refreshToken);
    const { refreshToken: _, ...safe } = result;
    return safe;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Silently refresh access token via HttpOnly cookie' })
  async refresh(
    @Req() req: Request & { cookies: Record<string, string> },
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies[COOKIE_NAME] as string | undefined;
    if (!token) {
      res.status(HttpStatus.UNAUTHORIZED).json({ message: 'No refresh token' });
      return;
    }
    const result = await this.authService.refreshTokens(token);
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user and tenant' })
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.getMe(user.sub);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user profile (name, avatarUrl)' })
  updateMe(@CurrentUser() user: JwtPayload, @Body() dto: UpdateProfileDto) {
    return this.authService.updateMe(user.sub, dto);
  }

  @Patch('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change current user password' })
  changePassword(@CurrentUser() user: JwtPayload, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.sub, dto);
  }

  @Patch('me/pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change or set login PIN' })
  changePin(@CurrentUser() user: JwtPayload, @Body() body: { currentPin?: string; newPin: string }) {
    return this.authService.changePin(user.sub, body);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout current user and clear session cookie' })
  async logout(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user.sub);
    this.clearRefreshCookie(res);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Request a password reset link' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using token' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  // ─── Google OAuth ────────────────────────────────────────────────────────────

  @Get('google')
  @ApiOperation({ summary: 'Initiate Google OAuth login' })
  googleAuth(@Res() res: Response) {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');

    if (!clientId) {
      return res.redirect(`${frontendUrl}/login?error=google_not_configured`);
    }

    const apiUrl = this.configService.get<string>('API_URL', 'http://localhost:3001/api/v1');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${apiUrl}/auth/google/callback`,
      response_type: 'code',
      scope: 'email profile',
      access_type: 'offline',
      prompt: 'select_account',
    });

    return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  }

  // ─── Workspace / Multi-workspace ─────────────────────────────────────────────

  @Get('workspaces')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all workspaces the authenticated user belongs to' })
  getWorkspaces(@CurrentUser() user: JwtPayload) {
    return this.authService.getWorkspaces(user.sub);
  }

  @Post('switch-workspace')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Switch active workspace and receive new tokens' })
  async switchWorkspace(
    @CurrentUser() user: JwtPayload,
    @Body() body: { workspaceId: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.switchWorkspace(user.sub, body.workspaceId);
    this.setRefreshCookie(res as unknown as import('express').Response, result.refreshToken);
    return { accessToken: result.accessToken, expiresIn: result.expiresIn, user: result.user, tenant: result.tenant };
  }

  @Get('invite/verify/:token')
  @ApiOperation({ summary: 'Verify an invitation token (public)' })
  verifyInvite(@Param('token') token: string) {
    return this.authService.verifyInvite(token);
  }

  @Post('invite/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an invitation and create/link account' })
  async acceptInvite(
    @Body() body: { token: string; name?: string; password?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.acceptInvite(body.token, { name: body.name, password: body.password });
    this.setRefreshCookie(res as unknown as import('express').Response, result.refreshToken);
    const { refreshToken: _, ...safe } = result;
    return safe;
  }

  @Get('google/callback')
  @ApiOperation({ summary: 'Google OAuth callback' })
  async googleCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');

    if (error || !code) {
      return res.redirect(`${frontendUrl}/login?error=google_auth_failed`);
    }

    try {
      const result = await this.authService.loginWithGoogle(code);
      // Set refresh token in HttpOnly cookie — never expose in URL
      this.setRefreshCookie(res, result.refreshToken);

      const user = result.user as Record<string, string>;
      const tenant = result.tenant as Record<string, string>;
      // Only access token goes in URL — it's short-lived (15m) and not a long-lived secret
      const params = new URLSearchParams({
        access_token: result.accessToken,
        user: Buffer.from(JSON.stringify(user)).toString('base64'),
        tenant: Buffer.from(JSON.stringify(tenant)).toString('base64'),
      });
      return res.redirect(`${frontendUrl}/auth/callback?${params.toString()}`);
    } catch {
      return res.redirect(`${frontendUrl}/login?error=google_auth_failed`);
    }
  }
}
