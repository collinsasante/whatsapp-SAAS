import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query,
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
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload } from '@whatsapp-platform/shared-types';

const COOKIE_NAME = 'refresh_token';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
      path: '/api/v1/auth',
      maxAge: COOKIE_MAX_AGE_MS,
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(COOKIE_NAME, { path: '/api/v1/auth' });
  }

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Register a new workspace and admin user' })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(dto);
    this.setRefreshCookie(res, result.refreshToken);
    const { refreshToken: _, ...safe } = result;
    return safe;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Login with email and password' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip ?? req.socket?.remoteAddress;
    const result = await this.authService.login(dto, ip);
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
    return { accessToken: result.accessToken, expiresIn: result.expiresIn };
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
