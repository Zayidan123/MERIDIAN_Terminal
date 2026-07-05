import { PrismaClient } from '@prisma/client'

// Bump this whenever the Prisma schema changes in dev. Turbopack HMR
// preserves `globalThis` across reloads, so the singleton PrismaClient
// would otherwise keep running the previously-generated client (which
// doesn't know about newly-added fields). The version check forces a
// fresh PrismaClient instance after a schema push + `prisma generate`.
const SCHEMA_VERSION = 2

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  __prismaSchemaVersion?: number
}

if (
  globalForPrisma.prisma &&
  globalForPrisma.__prismaSchemaVersion !== SCHEMA_VERSION
) {
  // Schema changed since the singleton was created — discard it so a new
  // PrismaClient (with the regenerated type/field metadata) is built.
  void globalForPrisma.prisma.$disconnect().catch(() => {})
  globalForPrisma.prisma = undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
  globalForPrisma.__prismaSchemaVersion = SCHEMA_VERSION
}