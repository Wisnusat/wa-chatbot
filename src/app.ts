import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import { serve as swaggerServe, setup as swaggerSetup } from 'swagger-ui-express';
import { logger } from './utils/logger.ts';
import { healthRouter } from './routes/health.route.ts';
import { messagesRouter } from './routes/messages.route.ts';
import { sessionRouter } from './routes/session.route.ts';
import { logsRouter } from './routes/logs.route.ts';
import { swaggerSpec } from './docs/swagger.ts';

export const app = express();

app.use(cors());
app.use(express.json());

app.use('/api-docs', swaggerServe, swaggerSetup(swaggerSpec));

app.use(healthRouter);
app.use(messagesRouter);
app.use(sessionRouter);
app.use(logsRouter);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  logger.error(err, 'Unhandled request error');
  res.status(500).json({ error: 'Internal server error' });
};

app.use(errorHandler);
