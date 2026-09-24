import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {PermissionAction, Prisma, UserRole} from '@generated/prisma/client';
import {CommonListResponseDto} from '@devbie/newbie/common.dto';
import {IsBoolean, IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID} from 'class-validator';

/**
 * Request DTO for creating a permission.
 * Mirrors the writable scalar columns of the Permission model.
 */
export class CreatePermissionDto {
  @ApiProperty({enum: PermissionAction, description: 'The action allowed or forbidden by this rule.'})
  @IsEnum(PermissionAction)
  action: PermissionAction;

  @ApiProperty({type: String, description: 'The resource (Prisma model name) the rule applies to.'})
  @IsString()
  @IsNotEmpty()
  resource: string;

  @ApiPropertyOptional({
    type: Object,
    additionalProperties: true,
    description: 'Optional Prisma where expression stored as JSON.',
  })
  @IsObject()
  @IsOptional()
  where?: Prisma.InputJsonValue;

  @ApiPropertyOptional({type: Boolean, description: 'Whether the rule forbids (true) rather than allows.'})
  @IsBoolean()
  @IsOptional()
  inverted?: boolean;

  @ApiPropertyOptional({type: String, description: 'Message explaining why the action is forbidden.'})
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiPropertyOptional({type: String, description: 'Scopes the rule to a specific trusted user id.'})
  @IsUUID()
  @IsOptional()
  trustedUserId?: string;

  @ApiPropertyOptional({enum: UserRole, description: 'Scopes the rule to a specific trusted user role.'})
  @IsEnum(UserRole)
  @IsOptional()
  trustedUserRole?: UserRole;

  @ApiPropertyOptional({type: Number, description: 'Scopes the rule to a specific trusted membership id.'})
  @IsInt()
  @IsOptional()
  trustedMembershipId?: number;
}

/**
 * Request DTO for updating a permission. All fields are optional.
 */
export class UpdatePermissionDto {
  @ApiPropertyOptional({enum: PermissionAction})
  @IsEnum(PermissionAction)
  @IsOptional()
  action?: PermissionAction;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  resource?: string;

  @ApiPropertyOptional({type: Object, additionalProperties: true})
  @IsObject()
  @IsOptional()
  where?: Prisma.InputJsonValue;

  @ApiPropertyOptional({type: Boolean})
  @IsBoolean()
  @IsOptional()
  inverted?: boolean;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiPropertyOptional({type: String})
  @IsUUID()
  @IsOptional()
  trustedUserId?: string;

  @ApiPropertyOptional({enum: UserRole})
  @IsEnum(UserRole)
  @IsOptional()
  trustedUserRole?: UserRole;

  @ApiPropertyOptional({type: Number})
  @IsInt()
  @IsOptional()
  trustedMembershipId?: number;
}

/**
 * Response DTO for a single Permission record.
 */
export class PermissionResponseDto {
  @ApiProperty({type: Number})
  id: number;

  @ApiProperty({enum: PermissionAction})
  action: PermissionAction;

  @ApiProperty({type: String})
  resource: string;

  @ApiPropertyOptional({type: Object})
  where?: object | null;

  @ApiPropertyOptional({type: Boolean})
  inverted?: boolean | null;

  @ApiPropertyOptional({type: String})
  reason?: string | null;

  @ApiPropertyOptional({type: String})
  trustedUserId?: string | null;

  @ApiPropertyOptional({enum: UserRole})
  trustedUserRole?: UserRole | null;

  @ApiPropertyOptional({type: Number})
  trustedMembershipId?: number | null;

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;
}

/**
 * Paginated list response for permissions.
 */
export class PermissionListResponseDto extends CommonListResponseDto {
  @ApiProperty({type: PermissionResponseDto, isArray: true})
  declare records: PermissionResponseDto[];
}
