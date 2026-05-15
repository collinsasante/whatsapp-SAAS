import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkspaceService } from './workspace.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload, UserRole } from '@whatsapp-platform/shared-types';

@ApiTags('Workspace')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('workspace')
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  // ─── Members ────────────────────────────────────────────────────────────────

  @Get('members')
  @ApiOperation({ summary: 'List all workspace members with user info' })
  listMembers(@CurrentTenant() tenantId: string) {
    return this.workspaceService.listMembers(tenantId);
  }

  @Patch('members/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Edit member profile, role, or department' })
  editMember(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: {
      name?: string; email?: string; phone?: string; avatarUrl?: string;
      role?: string; department?: string; status?: string;
    },
  ) {
    return this.workspaceService.editMember(tenantId, id, user.sub, body);
  }

  @Patch('members/:id/suspend')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Suspend a workspace member' })
  suspendMember(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.workspaceService.suspendMember(tenantId, id, user.sub);
  }

  @Patch('members/:id/reactivate')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Reactivate a suspended workspace member' })
  reactivateMember(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.workspaceService.reactivateMember(tenantId, id, user.sub);
  }

  @Post('members/:id/force-logout')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Force logout a member — invalidate sessions + disconnect socket' })
  forceLogout(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.workspaceService.forceLogout(tenantId, id, user.sub);
  }

  @Post('members/:id/reset-password')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin-initiated password reset for a member' })
  resetPassword(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { newPassword: string },
  ) {
    return this.workspaceService.resetMemberPassword(tenantId, id, user.sub, body.newPassword);
  }

  @Get('members/:id/activity')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get activity stats for a member' })
  getMemberActivity(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.workspaceService.getMemberActivity(tenantId, id);
  }

  @Get('members/:id/conversations')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get conversation counts for a member' })
  getMemberConversations(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.workspaceService.getMemberConversations(tenantId, id);
  }

  @Delete('members/:id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a member — optionally reassign their conversations' })
  removeMember(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { reassignToId?: string },
  ) {
    return this.workspaceService.removeMember(tenantId, id, user.sub, body.reassignToId);
  }

  // ─── Invitations ────────────────────────────────────────────────────────────

  @Post('invite')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create an invitation link' })
  createInvitation(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { email: string; role?: string; name?: string },
  ) {
    return this.workspaceService.createInvitation(
      tenantId, user.sub, body.email, body.role ?? 'AGENT', body.name,
    );
  }

  @Get('invitations')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'List pending invitations' })
  listInvitations(@CurrentTenant() tenantId: string) {
    return this.workspaceService.listInvitations(tenantId);
  }

  @Delete('invitations/:id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel an invitation' })
  cancelInvitation(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.workspaceService.cancelInvitation(tenantId, id);
  }
}
