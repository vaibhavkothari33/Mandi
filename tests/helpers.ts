import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Points DB_PATH at a throwaway file before any module imports the client,
 * so each test file gets an isolated database.
 */
export function freshDb(): { dir: string; cleanup: () => Promise<void> } {
  const dir = mkdtempSync(join(tmpdir(), 'mandi-test-'))
  process.env.DB_PATH = join(dir, 'test.db')
  const cleanup = async () => {
    const { close } = await import('../lib/db/client.ts')
    close()
    rmSync(dir, { recursive: true, force: true })
  }

  return { dir, cleanup }
}

export const ADDRESS = {
  name: 'A Buyer',
  line1: '12 Residency Road',
  city: 'Bengaluru',
  state: 'KA',
  postal_code: '560025',
  country: 'IN',
}
