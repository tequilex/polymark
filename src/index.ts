import { config } from './config';
import { logger } from './logger';

// Базовый каркас процесса: дальше сюда подключатся worker и API.
logger.info({ port: config.port, env: config.nodeEnv }, 'service bootstrapped');
