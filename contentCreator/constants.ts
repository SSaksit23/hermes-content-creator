
import { Language, Tone, ContentType } from './types';

export const CONTENT_TYPES: ContentType[] = [
  ContentType.CITY,
  ContentType.ATTRACTION,
  ContentType.SOCIAL_MEDIA_POST,
];

export const INPUT_LANGUAGES: Language[] = [
  Language.EN,
  Language.TH,
  Language.ZH,
];

export const OUTPUT_LANGUAGES: Language[] = [
  Language.TH,
  Language.EN,
  Language.ZH,
];

export const TONES: Tone[] = [
  'Default',
  'Formal',
  'Informal',
  'Adventurous',
  'Luxurious',
  'Custom',
];
