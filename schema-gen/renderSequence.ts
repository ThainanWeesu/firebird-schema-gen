import { formatIdentifier } from './identifier';

export const renderSequence = (name: string): string => `create sequence ${formatIdentifier(name)};\n`;
