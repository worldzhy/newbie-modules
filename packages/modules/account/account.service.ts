import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { UpdateMeDto } from "./account.dto";
import { UserRequest } from "@modules/security/security.interface";
import { buildUiAvatarsUrl } from "./helpers/ui-avatar";

const nameFields = ["name", "firstName", "middleName", "lastName"] as const;

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  async me(request: UserRequest) {
    // The JWT strategy already verified the session and loaded the user's
    // roles into request.user, so only the profile lookup is needed here.
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: request.user.userId },
      select: {
        id: true,
        email: true,
        phone: true,
        twoFactorMethod: true,
        name: true,
        firstName: true,
        middleName: true,
        lastName: true,
        avatarFileId: true,
        roles: {
          select: {
            role: {
              select: {
                name: true,
                rolePermissionGroups: {
                  include: {
                    permissionGroup: {
                      select: { id: true, name: true, routePath: true, navGroup: true, navLabel: true, navIcon: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const roles = user.roles.map((ur) => ur.role.name);

    // Union of all PermissionGroups across every held role, deduplicated by id.
    // ADMIN seed intentionally binds no PermissionGroup (the wildcard *:Manage
    // covers everything); frontend detects ADMIN in roles and renders every
    // nav entry regardless of this list.
    const seenGroupIds = new Set<number>();
    const permissionGroups: {
      id: number;
      name: string;
      routePath: string;
      navGroup: string;
      navLabel: string;
      navIcon: string | null;
    }[] = [];
    for (const ur of user.roles) {
      for (const rpg of ur.role.rolePermissionGroups) {
        const pg = rpg.permissionGroup;
        if (!seenGroupIds.has(pg.id)) {
          seenGroupIds.add(pg.id);
          permissionGroups.push({
            id: pg.id,
            name: pg.name,
            routePath: pg.routePath,
            navGroup: pg.navGroup,
            navLabel: pg.navLabel,
            navIcon: pg.navIcon,
          });
        }
      }
    }

    return {
      ...user,
      roles,
      permissionGroups,
    };
  }

  async updateMe(request: UserRequest, body: UpdateMeDto) {
    // The transformed DTO instance carries every declared field as an own
    // property even when the client omitted it (it is undefined then), so a
    // name change must be detected by value, never with the `in` operator or
    // Object.keys.
    const changedName = nameFields.some((field) => body[field] !== undefined);
    const requestedAvatarFileId = body.avatarFileId;

    const { dateOfBirth, ...restFields } = body;
    // Keep only values the client actually sent, so the update does not carry
    // a set of undefined DTO fields.
    const scalarFields = Object.fromEntries(
      Object.entries(restFields).filter(([, value]) => value !== undefined),
    ) as Prisma.UserUpdateInput;

    // Current state is needed to merge the name fields and to tell whether a
    // real uploaded avatar already exists.
    const existingUser = await this.prisma.user.findUniqueOrThrow({
      where: { id: request.user.userId },
      select: {
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        avatarFileId: true,
      },
    });

    const updateData: Prisma.UserUpdateInput = {
      ...scalarFields,
      ...(dateOfBirth !== undefined ? { dateOfBirth: new Date(dateOfBirth) } : {}),
      ...(requestedAvatarFileId !== undefined ? { avatarFileId: requestedAvatarFileId } : {}),
    };

    // A name change must also refresh the generated initial-avatar; the URL
    // encodes the name, so leaving it stale would keep showing the old name.
    // Never overwrite an uploaded avatar, including one set in this same
    // request.
    const effectiveAvatarFileId = requestedAvatarFileId ?? existingUser.avatarFileId;
    if (changedName && !effectiveAvatarFileId) {
      updateData.uiAvatarsUrl = buildUiAvatarsUrl({
        name: (scalarFields.name as string | undefined) ?? existingUser.name,
        firstName: (scalarFields.firstName as string | undefined) ?? existingUser.firstName,
        lastName: (scalarFields.lastName as string | undefined) ?? existingUser.lastName,
        fallback: existingUser.email?.split("@")[0] ?? "user",
      });
    }

    // Only whitelisted fields reach here: the DTO has been stripped of
    // unknown properties by the global ValidationPipe, and the identity comes
    // from the authenticated session (request.user), never from the body.
    return await this.prisma.user.update({
      where: { id: request.user.userId },
      data: updateData,
    });
  }

  /* End */
}
