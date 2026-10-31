import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl } from "class-validator";

export class CreateWebhookDto {
  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  @IsNotEmpty()
  url!: string;

  @IsString()
  @IsNotEmpty()
  event!: string;

  @IsString()
  @IsOptional()
  contentType?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  secret?: string;
}

export class UpdateWebhookDto {
  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  @IsOptional()
  url?: string;

  @IsString()
  @IsOptional()
  event?: string;

  @IsString()
  @IsOptional()
  contentType?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  secret?: string;
}

export class ReplaceWebhookDto {
  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  @IsNotEmpty()
  url!: string;

  @IsString()
  @IsNotEmpty()
  event!: string;

  @IsString()
  @IsOptional()
  contentType!: string;

  @IsBoolean()
  @IsOptional()
  isActive!: boolean;

  @IsString()
  @IsOptional()
  secret!: string;
}
