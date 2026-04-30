
export enum ContentType {
  CITY = 'City Description',
  ATTRACTION = 'Attraction Description',
  SOCIAL_MEDIA_POST = 'Social Media Post',
  MEAL_DESCRIPTION = 'Meal Description',
}

export enum Language {
  EN = 'English',
  TH = 'Thai',
  ZH = 'Chinese',
}

export type Tone = 'Default' | 'Formal' | 'Informal' | 'Adventurous' | 'Luxurious' | 'Custom';

export interface Source {
  uri: string;
  title: string;
}

export interface EditableEntity {
  id: string;
  name: string;
  type: ContentType;
  disambiguationQuery: string;
  day?: string;
  socialPlatform?: string;
  talkingPoints?: string;
}

export interface GeneratedItem {
  id:string;
  name: string;
  type: ContentType;
  content: string;
  sources: Source[];
  day?: string;
  status?: 'pending' | 'generating' | 'completed' | 'error';
  disambiguationQuery?: string;
  socialPlatform?: string;
  talkingPoints?: string;
}

export interface Preset {
  id: string;
  name: string;
  contextSource: string | null;
  documentContext: string;
  documentImages: string[];
  createdAt: string; // ISO string
}