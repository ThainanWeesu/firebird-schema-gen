import dotenv from 'dotenv';
import path from 'path';

export const PACKAGE_ROOT = path.resolve(__dirname, '..');
export const ENV_PATH = path.join(PACKAGE_ROOT, '.env');

const result = dotenv.config({ path: ENV_PATH });

export const envFileLoaded = result.error === undefined;
