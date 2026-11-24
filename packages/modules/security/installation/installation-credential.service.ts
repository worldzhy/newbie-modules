import { ConflictException, Injectable } from "@nestjs/common";
import { Installation, InstallationKind } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  generateInstallationToken,
  hashInstallationToken,
  installationTokenFingerprint,
} from "./installation-credential";

/** Everything a collector supplies when it issues a new credential. */
export interface CreateInstallationInput {
  kind: InstallationKind;
  label: string;
  externalRef?: string | null;
  appKey?: string | null;
}

/**
 * The single installation credential store (ADR-078).
 *
 * All six collectors share this table, so issuance, rotation and revocation
 * are written once. A collector service keeps only its audit recording and
 * its fact-table projection around these calls.
 */
@Injectable()
export class InstallationCredentialService {
  constructor(private readonly prisma: PrismaService) {}

  /** Issue a credential. The plaintext token is returned exactly once. */
  async create(input: CreateInstallationInput): Promise<{ installation: Installation; token: string }> {
    const token = generateInstallationToken();
    try {
      const installation = await this.prisma.installation.create({
        data: {
          kind: input.kind,
          label: input.label,
          externalRef: input.externalRef ?? null,
          appKey: input.appKey ?? null,
          tokenHash: hashInstallationToken(token),
          tokenFingerprint: installationTokenFingerprint(token),
        },
      });
      return { installation, token };
    } catch (error) {
      // (kind, externalRef) and appKey are unique indexes: a duplicate
      // enrollment must answer a conflict instead of a 500, and no second
      // credential is minted because the insert never lands.
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new ConflictException("An installation with this identity already exists.");
      }
      throw error;
    }
  }

  /** Rotate the token; the previous hash stops working on the next request. */
  async rotate(id: string): Promise<{ id: string; token: string }> {
    const token = generateInstallationToken();
    await this.prisma.installation.update({
      where: { id },
      data: {
        tokenHash: hashInstallationToken(token),
        tokenFingerprint: installationTokenFingerprint(token),
      },
    });
    return { id, token };
  }

  /** Soft-revoke or restore. `null` clears the revocation marker. */
  async setRevokedAt(id: string, revokedAt: Date | null): Promise<void> {
    await this.prisma.installation.update({ where: { id }, data: { revokedAt } });
  }

  async findById(id: string): Promise<Installation | null> {
    return this.prisma.installation.findUnique({ where: { id } });
  }
}
