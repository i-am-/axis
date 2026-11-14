// Plain-language meanings for the Hellenistic reading on /natal-chart/.
// Short by design: one to three sentences each, for a visitor, not a scholar.

import type { Planet7, Dignity } from './dignities';
import type { SectRoles } from '../lib/hellenistic';

export const INTRO =
  'Hellenistic astrology is the form practised in the Greek-speaking Mediterranean two thousand years ago. ' +
  'It reads houses by whole signs, asks whether you were born by day or by night, and times life in chapters ' +
  'rather than single events.';

export const NO_TIME = 'Sect, lots, profections and releasing need your birth time.';

export const SECT = {
  day: 'You were born by day. The Sun leads your chart: you tend to grow by visible effort, aims and being seen to do things well.',
  night: 'You were born by night. The Moon leads your chart: you tend to grow by attunement, care and reading what the moment needs.',
};

export const ROLES: Record<keyof SectRoles, string> = {
  light: 'The sect light: the planet that sets the chart’s tone and vitality.',
  benefic: 'The benefic of sect: the most reliable source of help and good fortune.',
  malefic: 'The malefic of sect: difficulty that is workable, even shaping.',
  contrary: 'The malefic out of sect: the harder edge; where you need the most care.',
};

export const DIGNITY: Record<Dignity, string> = {
  domicile: 'At home: acts freely, with its own resources.',
  exaltation: 'Honoured: acts with confidence and gets noticed.',
  detriment: 'Far from home: works hard with unfamiliar tools.',
  fall: 'Unseen: its efforts go under-recognised and need patience.',
  peregrine: 'A guest: depends on the planets it meets.',
};

export const LOTS = {
  fortune: 'The Lot of Fortune: your body, health and the circumstances that happen to you.',
  spirit: 'The Lot of Spirit: your mind, choices and the actions you take, career above all.',
};

/** The topic each house brings to the year it is profected to. */
export const HOUSE = [
  'A year about you: your body, appearance and the direction you set out in.',
  'A year about resources: income, savings and what you can rely on.',
  'A year about your near world: siblings, neighbours, writing, short trips and daily practices.',
  'A year about foundations: home, family, parents and where you put down roots.',
  'A year about joy: children, creativity, romance and what you make for pleasure.',
  'A year about work and health: routines, service, strain and repair.',
  'A year about others: partners, agreements and open rivals.',
  'A year about what is shared and what ends: debts, inheritances, fears and letting go.',
  'A year about horizons: travel, study, teaching and what you believe.',
  'A year about action and standing: career, reputation and what you are known for.',
  'A year about allies: friends, groups, patrons and hopes for the future.',
  'A year about the hidden: rest, solitude, behind-the-scenes work and what you have been avoiding.',
];

/** The lord of the year: the planet whose condition colours it. */
export const LORD: Record<Planet7, string> = {
  Sun: 'The Sun as lord of the year asks for visibility, leadership and a clear purpose.',
  Moon: 'The Moon as lord of the year brings change, sensitivity and attention to the body and home.',
  Mercury: 'Mercury as lord of the year favours learning, trade, paperwork and many conversations.',
  Venus: 'Venus as lord of the year brings relationships, pleasure, art and making peace.',
  Mars: 'Mars as lord of the year brings drive, conflict and decisive cuts; pace yourself.',
  Jupiter: 'Jupiter as lord of the year opens doors: growth, generosity and good counsel.',
  Saturn: 'Saturn as lord of the year asks for structure, patience and commitments that last.',
};

export const ZR = {
  intro: 'Zodiacal releasing divides your life into chapters, each ruled by a sign. It shows when the chapters turn and which of them peak.',
  spirit: 'Released from Spirit: the chapters of your career and the actions you choose.',
  fortune: 'Released from Fortune: the chapters of your body, health and circumstances.',
  peak: 'Peak period: a chapter angular to Fortune, when activity and visibility rise.',
  tenth: 'The strongest peak: the 10th sign from Fortune, often a career high point.',
  lb: 'Loosing of the bond: a sudden turn mid-chapter, often a change of direction that later makes sense.',
};
