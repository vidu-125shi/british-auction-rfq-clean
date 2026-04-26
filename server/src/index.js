import express from 'express';
import cors from 'cors';
import { openDatabase } from './db.js';
import { attachUser } from './auth.js';
import { usersRouter } from './routes/users.js';
import { rfqsRouter } from './routes/rfqs.js';
import { bidsRouter } from './routes/bids.js';
import { makeRfqRepo } from './repos/rfqRepo.js';
import { makeBidRepo } from './repos/bidRepo.js';
import { makeActivityRepo } from './repos/activityRepo.js';
import { errorMiddleware } from './validators.js';

export function createApp(db) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(attachUser(db));

  const rfqRepo = makeRfqRepo(db);
  const bidRepo = makeBidRepo(db);
  const activityRepo = makeActivityRepo(db);

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/users', usersRouter(db));
  app.use('/api/rfqs', rfqsRouter({ rfqRepo, bidRepo, activityRepo, db }));
  app.use('/api/rfqs/:rfqId/bids', bidsRouter({ rfqRepo, bidRepo, activityRepo, db }));

  app.use(errorMiddleware);
  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const db = openDatabase();
  const app = createApp(db);
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
}
