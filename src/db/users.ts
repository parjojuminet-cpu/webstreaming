import { db } from './index.ts';
import { users } from './schema.ts';

export async function getOrCreateSqlUser(uid: string, email: string | null) {
  try {
    const safeEmail = (email || '').slice(0, 160);
    const result = await db
      .insert(users)
      .values({
        uid,
        email: safeEmail,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: safeEmail,
        },
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error('Failed to upsert SQL user:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
}
