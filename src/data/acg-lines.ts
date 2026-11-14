// The planets drawn on the astrocartography map, and what each line means.
// Colours come from the site tokens, so the map follows light and dark.
// Several planets share a colour; each line is also labelled and its dash
// says the angle, so colour is never the only cue.

import type { Angle } from '../lib/acg';

export const ACG_BODIES = [
  { id: 'sun', label: 'Sun', glyph: '☉', color: 'var(--gold)', outer: false },
  { id: 'moon', label: 'Moon', glyph: '☽', color: 'var(--ink)', outer: false },
  { id: 'mercury', label: 'Mercury', glyph: '☿', color: 'var(--ocean)', outer: false },
  { id: 'venus', label: 'Venus', glyph: '♀', color: 'var(--rubric)', outer: false },
  { id: 'mars', label: 'Mars', glyph: '♂', color: 'var(--rubric)', outer: false },
  { id: 'jupiter', label: 'Jupiter', glyph: '♃', color: 'var(--gold)', outer: false },
  { id: 'saturn', label: 'Saturn', glyph: '♄', color: 'var(--ink-soft)', outer: false },
  { id: 'uranus', label: 'Uranus', glyph: '♅', color: 'var(--ocean)', outer: true },
  { id: 'neptune', label: 'Neptune', glyph: '♆', color: 'var(--ocean)', outer: true },
  { id: 'pluto', label: 'Pluto', glyph: '♇', color: 'var(--ink-faint)', outer: true },
];

export const ANGLE_LABEL: Record<Angle, string> = {
  MC: 'Midheaven', IC: 'Imum Coeli', ASC: 'Ascendant', DSC: 'Descendant',
};

export const MEANING: Record<string, string> = {
  'sun-MC': 'Recognition and leadership. A place to be seen for your work and step into authority.',
  'sun-IC': 'Roots and inner strength. Good for building a home and finding out who you are in private.',
  'sun-ASC': 'Confidence and vitality. You feel more yourself here and others notice you.',
  'sun-DSC': 'Prominent partners. Relationships and collaborations take centre stage, sometimes outshining you.',
  'moon-MC': 'Public warmth. Work in care, food, homes or the public, with a reputation that moves with feeling.',
  'moon-IC': 'Belonging. One of the strongest lines for feeling at home and close to family.',
  'moon-ASC': 'Sensitivity. Moods run nearer the surface; you feel open, intuitive and easily touched.',
  'moon-DSC': 'Nurturing ties. Partners who care for you, or who need caring for.',
  'mercury-MC': 'Voice and ideas. Good for writing, teaching, media and trading on what you know.',
  'mercury-IC': 'A busy mind at home. Study, home offices and family conversations.',
  'mercury-ASC': 'Curiosity. You come across as quick and talkative; learning comes easily.',
  'mercury-DSC': 'Meeting minds. Partnerships built on talk, contracts and shared projects.',
  'venus-MC': 'Charm at work. Success in art, beauty, diplomacy and anything that pleases people.',
  'venus-IC': 'A lovely home. Comfort, harmony in the family and a beautiful place to live.',
  'venus-ASC': 'Attractiveness. You feel at ease, look your best and are easy to like.',
  'venus-DSC': 'Love. One of the classic lines for romance and happy partnerships.',
  'mars-MC': 'Ambition and competition. Drive to achieve, with conflict along the way.',
  'mars-IC': 'Energy at home. Renovations and action, but also friction in the household.',
  'mars-ASC': 'Courage and heat. Physical energy and boldness, with a shorter temper.',
  'mars-DSC': 'Passionate partners and rivals. Strong attraction and open disputes.',
  'jupiter-MC': 'Opportunity. A place where career doors open and good fortune finds your work.',
  'jupiter-IC': 'A generous home. Space, family blessings and property that grows in value.',
  'jupiter-ASC': 'Optimism. You feel expansive, lucky and welcome; watch the waistline.',
  'jupiter-DSC': 'Helpful others. Benefactors, good partners and fair deals.',
  'saturn-MC': 'Hard-won standing. Slow, serious career progress that lasts.',
  'saturn-IC': 'Heavy foundations. Duty to family or home; good for building something lasting, rarely light.',
  'saturn-ASC': 'Discipline. You feel the weight of responsibility; good for focus, hard for ease.',
  'saturn-DSC': 'Committed ties. Older or serious partners and long contracts; loneliness is the risk.',
  'uranus-MC': 'Breakthroughs at work. Unusual careers, technology and sudden changes of direction.',
  'uranus-IC': 'Restless home. Frequent moves and unconventional households.',
  'uranus-ASC': 'Freedom. You feel unlike your usual self: original, unsettled and awake.',
  'uranus-DSC': 'Surprising partners. Exciting meetings and relationships that need space.',
  'neptune-MC': 'Inspiration and fog. Good for art, healing and spirit; careers can be unclear.',
  'neptune-IC': 'A dreamy home. Retreats by water and spiritual roots; keep the practical side in view.',
  'neptune-ASC': 'Openness. Imagination and empathy rise, and so does confusion about boundaries.',
  'neptune-DSC': 'Idealised partners. Soulful bonds, with a risk of seeing what you wish to see.',
  'pluto-MC': 'Power and transformation. Intense career change and dealings with power.',
  'pluto-IC': 'Deep roots. Family secrets and inner change; a place to rebuild from the ground up.',
  'pluto-ASC': 'Intensity. A place that changes you; you come across as magnetic and private.',
  'pluto-DSC': 'Transforming relationships. Deep, consuming partnerships and power struggles.',
};
