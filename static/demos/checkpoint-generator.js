// Seeded, lazy document generation. Annotations describe constructed truth for scoring only.
import { TODAY, DECK, PURPOSES } from './checkpoint.js';
import { generateLevelCase } from './checkpoint-level-generator.js';
import { LEVELS } from './checkpoint-levels.js';

export const MAX_SHIFT_SIZE = 10000;
const KINDS = Object.keys(PURPOSES);
const FIRST = ['Mara', 'Soren', 'Nia', 'Eli', 'Rina', 'Darin', 'Iris', 'Oren', 'Tessa', 'Luka', 'Ada', 'Finn',
  'Lea', 'Noah', 'Milo', 'Juno', 'Cora', 'Anya', 'Ravi', 'Zara', 'Omar', 'Esme', 'Theo', 'Lena', 'Yara', 'Kian', 'Vera', 'Sana', 'Arlo', 'Mina', 'Ivo', 'Nora'];
const LAST = ['Voss', 'Vale', 'Arden', 'Ward', 'Sol', 'Holt', 'Noll', 'Pike', 'Reed', 'Moss', 'Wynn', 'Hale',
  'Stone', 'Park', 'Rook', 'Kerr', 'Lane', 'Shaw', 'Quill', 'Dane', 'Ash', 'Moon', 'Cole', 'West', 'Lark', 'Grey', 'Bell', 'Hart', 'Lake', 'Nash', 'Snow', 'Wren'];
const COUNTRIES = ['Aster', 'Vela', 'Orion', 'Lyra', 'Nova', 'Corvus', 'Altair', 'Mira', 'Deneb', 'Solara'];
const JOBS = ['repair technician', 'engine mechanic', 'cargo coordinator', 'kitchen assistant', 'medical technician',
  'warehouse clerk', 'electrician', 'software engineer', 'maintenance worker', 'translator', 'shipwright', 'laboratory assistant'];
const EMPLOYERS = ['Aster Harbor Works', 'North Dock Services', 'Vela Logistics', 'Orion Research', 'Nova Shipyards',
  'Transit Station Clinic', 'Lyra Systems', 'Altair Catering'];
const SIGHTS = ['the observatory', 'the old harbor', 'the botanical gardens', 'the maritime museum', 'the night market',
  'the lighthouse', 'the riverfront', 'the mountain temples', 'the historic quarter', 'the art galleries'];
const DESTINATIONS = ['the mining colony', 'Vela City', 'the outer settlements', 'Northport', 'the orbital terminal',
  'the southern islands', 'Lyra Station', 'the coastal capital'];
const COURSES = ['navigation', 'medicine', 'engineering', 'astronomy', 'languages', 'botany', 'computer science', 'architecture'];
const RELATIONS = ['sister', 'brother', 'parents', 'cousin', 'old friend', 'grandmother'];

// Deliberately authored paraphrases: generation does not call an LLM or modify inference policy.
const PERMITS = {
  tourism: [
    'Leisure visits and sightseeing only. Paid employment is not permitted.',
    'Permission to enter for a holiday and visits to friends or family. No paid work.',
    'Tourist entry: recreational travel and sightseeing. Employment is excluded.',
    'This visitor may tour local attractions and stay with relatives. This is a leisure permit.',
    'Authorized for a vacation of {days} days, including visits to {sight}.',
    'Family visits and holidays are permitted. This document does not authorize taking a job.',
    'Admission for tourism, including museums, guided tours and recreational activities.',
    'The holder may spend {days} days here as a holiday visitor, without working.',
  ],
  work: [
    'Paid employment in repair and maintenance services.',
    'The holder is authorized to take a salaried job with {employer}.',
    'Work entry permit: paid employment as a {job}.',
    'Permission to enter for employment. The holder may undertake paid duties for {employer}.',
    'Authorized to work for wages as a {job} during this visit.',
    'Entry for a contracted paid position with {employer}.',
    'This permit allows employment and paid professional duties for {days} days.',
    'The holder may enter to take up a salaried role as a {job}.',
  ],
  transit: [
    'Transit through the station en route to another destination.',
    'Permission to pass through on a connecting journey to {destination}.',
    'Transit only: change transport here and continue to {destination}.',
    'The holder may cross this territory while traveling onward to {destination}.',
    'Authorized for a brief stop between connecting transport services. Final destination: {destination}.',
    'Entry is permitted solely to transfer to the next departure for {destination}.',
    'Through-travel authorization. The holder must continue to another destination.',
    'This is a transit permit for an onward journey, not a local stay.',
  ],
  study: [
    'Enrollment in an academic course. Employment is not authorized.',
    'Student entry permit for a course in {course}.',
    'The holder may enter to attend classes and pursue academic study.',
    'Authorized for a semester of {course} at the local academy.',
    'Admission for academic enrollment and attending lectures. No paid employment.',
    'Permission to reside temporarily as a student taking a {course} course.',
    'Education permit: full-time academic study in {course}.',
    'The holder is admitted to study at an educational institution.',
  ],
};
const DECLARATIONS = {
  tourism: [
    'I want to visit {sight}, see {otherSight}, and enjoy a quiet holiday.',
    'I am spending my vacation here with my {relation}. I will return home in {days} days.',
    'My trip is for sightseeing. I have booked a tour of {sight}.',
    'I am here on holiday to visit my {relation}. I am not taking a job or enrolling in a course.',
    'I want to see {sight} and enjoy the local food during my holiday.',
    'I am visiting an old friend for a leisurely break of {days} days.',
    'I have booked a hotel for a vacation. My plans are museums, walks and sightseeing.',
    'I am here to spend time with my {relation} and explore {sight} as a tourist.',
  ],
  work: [
    'I have been hired as a {job} at {employer} for a monthly salary.',
    'I am starting a paid job with {employer}. My role is {job}.',
    'I am coming to work as a {job}. The company will pay me wages.',
    'I have accepted a salaried position at {employer}, and I start work this week.',
    'My employer is expecting me for paid duties as a {job}.',
    'I have a contract to work for {employer} for {days} days, with regular pay.',
    'I am relocating temporarily to take a paid {job} position.',
    'This trip is for employment at {employer}, not for a holiday or a course.',
  ],
  transit: [
    'I am changing ships here on my way to {destination}.',
    'I have a connecting train to {destination}. I am only passing through.',
    'My final destination is {destination}; this station is just a transfer stop.',
    'I need to cross this territory to reach {destination}. I will not stay here.',
    'I am waiting for my onward departure to {destination}.',
    'I am transferring between transport services before continuing to {destination}.',
    'I am traveling through on an onward journey, not visiting locally.',
    'I only need to change transport here. My journey ends in {destination}.',
  ],
  study: [
    'I am beginning a semester of {course} at the academy.',
    'I have enrolled as a student in a {course} course.',
    'I am here to attend lectures and complete my academic studies in {course}.',
    'I will be studying {course} full time at the local college.',
    'My university term begins this week. I am taking classes in {course}.',
    'I am coming as a student to pursue a degree in {course}.',
    'I have a place on an academic {course} program. I am not here to work.',
    'I am attending an educational institution for a semester of {course}.',
  ],
};
const CONFIRMATIONS = [
  'We confirm that this traveler is employed as a {job} at {employer}. Their position is paid.',
  'This traveler has accepted a salaried {job} position with our company. We confirm their employment.',
  'We employ the named traveler as a {job}. They receive wages from {employer}.',
  'The traveler holds a paid employment contract with {employer} as a {job}.',
  'Our personnel office confirms a current paid job for this traveler. Their role is {job}.',
  'This letter verifies employment at {employer}. The traveler is a salaried member of staff.',
];
const WITHDRAWALS = [
  'The job offer has been withdrawn. We cannot confirm employment; there is no position available for this traveler.',
  'We canceled this traveler\'s employment contract. They have no job with {employer}.',
  'This traveler is not employed by us. Their application was rejected.',
  'The proposed {job} position was withdrawn before the traveler joined. No employment exists.',
  'This is a notice of rejection, not confirmation of employment. We have not hired this traveler.',
  'We no longer offer this traveler a paid position. The earlier offer is canceled.',
];

export const FAULTS = [
  'missing-passport', 'missing-permit', 'expired-passport', 'expired-permit', 'future-permit',
  'holder-mismatch', 'number-mismatch', 'purpose-mismatch', 'missing-letter', 'unsigned-letter',
  'withdrawn-employment', 'invalid-calendar-date',
];
const LETTER_FAULTS = new Set(['missing-letter', 'unsigned-letter', 'withdrawn-employment']);

function randomFor(seed, index) {
  let value = 2166136261;
  for (const char of `${seed}:${index}`) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return () => {
    value = (value + 0x6D2B79F5) | 0;
    let n = Math.imul(value ^ value >>> 15, 1 | value);
    n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}
function dateOffset(days) {
  const date = new Date(TODAY + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function generateCase(seed, index, { invalidRate = 0.5, maxFaults = 3, difficulty = null } = {}) {
  if (difficulty !== null) return generateLevelCase(seed, index, { difficulty, invalidRate, maxFaults }, generateCase);
  if (!Number.isInteger(index) || index < 0) throw new RangeError('Arrival index must be a nonnegative integer.');
  if (!Number.isFinite(invalidRate) || invalidRate < 0 || invalidRate > 1) throw new RangeError('Invalid-document rate must be between 0 and 1.');
  if (![1, 3].includes(maxFaults)) throw new RangeError('Choose one fault or up to three faults.');
  const random = randomFor(String(seed), index), pick = list => list[Math.floor(random() * list.length)];
  const integer = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
  const name = () => `${pick(FIRST)} ${pick(LAST)}`;
  const invalid = random() < invalidRate;
  const primary = invalid ? pick(FAULTS) : null;
  const kind = LETTER_FAULTS.has(primary) ? 'work' : pick(KINDS);
  const holder = name(), country = pick(COUNTRIES);
  const number = `${country.slice(0, 2).toUpperCase()}-${String(index + 1).padStart(6, '0')}-${integer(10, 99)}`;
  const sight = pick(SIGHTS);
  const vars = { job: pick(JOBS), employer: pick(EMPLOYERS), sight, otherSight: pick(SIGHTS.filter(v => v !== sight)),
    destination: pick(DESTINATIONS), course: pick(COURSES), relation: pick(RELATIONS), days: integer(3, 90) };
  const text = templates => pick(templates).replace(/\{(\w+)\}/g, (_, key) => vars[key]);
  const item = {
    id: 'arrival-' + String(index + 1).padStart(5, '0'),
    passport: { holder, country, number, expires: dateOffset(integer(0, 1825)) },
    permit: { holder, passportNumber: number, issued: dateOffset(-integer(0, 90)), expires: dateOffset(integer(0, 180)), text: text(PERMITS[kind]) },
    declaration: { holder, text: text(DECLARATIONS[kind]) },
    letter: kind === 'work' ? { holder, issuer: vars.employer, signed: true, text: text(CONFIRMATIONS) } : null,
    annotation: { declared: kind, permitted: kind, employment: kind === 'work' },
    generation: { seed: String(seed), index, faults: [] },
  };
  function applyFault(fault) {
    switch (fault) {
      case 'missing-passport': item.passport = null; break;
      case 'missing-permit': item.permit = null; break;
      case 'expired-passport': if (!item.passport) return; item.passport.expires = dateOffset(-integer(1, 365)); break;
      case 'invalid-calendar-date': if (!item.passport) return; item.passport.expires = '2027-02-30'; break;
      case 'expired-permit': if (!item.permit) return; item.permit.expires = dateOffset(-integer(1, 90)); break;
      case 'future-permit': if (!item.permit) return; item.permit.issued = dateOffset(integer(1, 30)); break;
      case 'holder-mismatch': {
        let other; do { other = name(); } while (other === holder);
        const target = pick([item.permit, item.declaration, item.letter].filter(Boolean));
        target.holder = other; break;
      }
      case 'number-mismatch': if (!item.permit || !item.passport) return; item.permit.passportNumber = number + '-X'; break;
      case 'purpose-mismatch': {
        const other = pick(KINDS.filter(k => k !== kind));
        item.permit.text = text(PERMITS[other]); item.annotation.permitted = other; break;
      }
      case 'missing-letter': item.letter = null; break;
      case 'unsigned-letter': item.letter.signed = false; break;
      case 'withdrawn-employment': item.letter.text = text(WITHDRAWALS); item.annotation.employment = false; break;
      default: throw new Error('Unknown document fault: ' + fault);
    }
    item.generation.faults.push(fault);
  }
  if (primary) {
    applyFault(primary);
    const extra = integer(0, maxFaults - 1);
    // Additional faults affect separate fields and never erase the primary defect.
    const candidates = ['expired-passport', 'number-mismatch', 'holder-mismatch'].filter(f =>
      f !== primary && (f !== 'expired-passport' || !['missing-passport', 'invalid-calendar-date'].includes(primary)) &&
      (f !== 'number-mismatch' || (item.passport && item.permit)) &&
      (f !== 'holder-mismatch' || (item.passport && item.permit)));
    for (let n = 0; n < extra && candidates.length; n++) {
      const fault = pick(candidates); candidates.splice(candidates.indexOf(fault), 1); applyFault(fault);
    }
  }
  return item;
}

// Constant-size shift descriptor: only the current arrival is built, even for 10,000 travelers.
export function createShift({ mode = 'random', size = 1000, seed = 'checkpoint', invalidRate = 0.5, maxFaults = 3, difficulty = null } = {}) {
  if (mode === 'demo') return { mode, size: DECK.length, caseAt: index => {
    if (!Number.isInteger(index) || index < 0 || index >= DECK.length) throw new RangeError('Arrival outside this shift.');
    return structuredClone(DECK[index]);
  } };
  if (mode !== 'random') throw new RangeError('Unknown shift type.');
  if (difficulty !== null && !Object.hasOwn(LEVELS, difficulty)) throw new RangeError('Choose easy, medium or hard difficulty.');
  if (!Number.isInteger(size) || size < 1 || size > MAX_SHIFT_SIZE) throw new RangeError(`Shift length must be 1–${MAX_SHIFT_SIZE}.`);
  if (!Number.isFinite(invalidRate) || invalidRate < 0 || invalidRate > 1) throw new RangeError('Invalid-document rate must be between 0 and 1.');
  if (![1, 3].includes(maxFaults)) throw new RangeError('Choose one fault or up to three faults.');
  seed = String(seed).trim();
  if (!seed.length || seed.length > 64) throw new RangeError('Seed must contain 1–64 characters.');
  return { mode, size, seed, invalidRate, maxFaults, difficulty, caseAt: index => {
    if (!Number.isInteger(index) || index < 0 || index >= size) throw new RangeError('Arrival outside this shift.');
    return generateCase(seed, index, { invalidRate, maxFaults, difficulty });
  } };
}
