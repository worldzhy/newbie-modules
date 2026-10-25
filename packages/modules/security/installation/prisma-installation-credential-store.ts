import { InstallationCredentialRecord, InstallationCredentialStore } from "./installation-credential";

/**
 * Minimal shape of a Prisma model delegate the credential mechanism needs.
 * Declared structurally so security never imports Prisma: any model whose
 * table carries a unique `tokenHash` column and a `revokedAt` column matches.
 */
export interface PrismaInstallationDelegate<TRow> {
  create(args: { data: unknown }): Promise<TRow>;
  findUnique(args: { where: { tokenHash: string } }): Promise<TRow | null>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
}

/**
 * Bind the credential store to a collector's Prisma delegate (ADR-019). This
 * is the single place the four table operations are written: collectors pass
 * their delegate and receive a fully wired store, so the unique-tokenHash
 * lookup and the lifecycle updates cannot drift between collectors.
 */
export function prismaInstallationCredentialStore<TDraft, TRow extends InstallationCredentialRecord>(
  delegate: PrismaInstallationDelegate<TRow>,
): InstallationCredentialStore<TDraft, TRow> {
  return {
    create: (draft) => delegate.create({ data: draft }),
    findByTokenHash: (tokenHash) => delegate.findUnique({ where: { tokenHash } }),
    replaceTokenHash: async (id, tokenHash) => {
      await delegate.update({ where: { id }, data: { tokenHash } });
    },
    setRevokedAt: async (id, revokedAt) => {
      await delegate.update({ where: { id }, data: { revokedAt } });
    },
  };
}
