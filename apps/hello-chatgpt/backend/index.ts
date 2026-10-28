import {
  router,
  json,
  error,
  db,
  increment,
  isAppDatabaseError,
} from '@appdeploy/sdk';

type Receipt = { kind: string };
type Counter = { value: number };

async function readTotal() {
  const [counter] = await db.get<Counter>('counters', ['global'], {
    consistent: true,
  });
  return counter?.value ?? 0;
}

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ message: 'Success' })],
  'GET /api/visits': [async () => json({ total: await readTotal() })],
  'POST /api/visits': [
    async ({ body }) => {
      const requestId = (body as { requestId?: unknown } | null)?.requestId;
      if (
        typeof requestId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          requestId
        )
      ) {
        return error('A valid visit request ID is required.', 400);
      }
      const lookup = async () => {
        const [receipt] = await db.get<Receipt>('visit_receipts', [requestId], {
          consistent: true,
        });
        return receipt?.kind === 'page_visit';
      };
      if (!(await lookup())) {
        await db.tx.add('counters', [{ id: 'global', value: 0 }]);
        const receipt = db.tx.add('visit_receipts', [
          { id: requestId, kind: 'page_visit' },
        ]);
        const counter = db.tx.update(
          'counters',
          [
            {
              id: 'global',
              record: { value: increment(1) },
            },
          ],
          { patch: true }
        );
        try {
          await db.transact([receipt, counter]);
        } catch (cause: unknown) {
          if (
            !(
              isAppDatabaseError(cause) &&
              (cause.code === 'AppDatabaseDuplicateId' ||
                cause.code === 'AppDatabaseUnknownOutcome') &&
              (await lookup())
            )
          ) {
            throw cause;
          }
        }
      }
      return json({ total: await readTotal() });
    },
  ],
});
