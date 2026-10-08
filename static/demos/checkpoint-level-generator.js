// Construct valid packets first, then inject compatible defects. No model outputs are fabricated.
import { TODAY } from './checkpoint-common.js';
import { LEVELS, DOCUMENTS, CITIES } from './checkpoint-levels.js';

const BASIC_FAULTS = ['missing-passport', 'missing-permit', 'expired-passport', 'expired-permit', 'future-permit',
  'holder-mismatch', 'number-mismatch', 'purpose-mismatch', 'missing-letter', 'unsigned-letter', 'withdrawn-employment', 'invalid-calendar-date'];
const STANDARD_FAULTS = ['appearance-mismatch', 'height-mismatch', 'weight-mismatch', 'stay-too-long'];
const WORK_FAULTS = ['missing-letter', 'unsigned-letter', 'withdrawn-employment', 'missing-work-pass', 'expired-work-pass', 'work-employer-mismatch', 'work-sector-mismatch'];
export const LEVEL_FAULTS = {
  easy: BASIC_FAULTS,
  medium: [...BASIC_FAULTS, ...STANDARD_FAULTS, 'missing-identity', 'expired-identity', 'identity-number', 'unknown-city', 'forged-seal', ...WORK_FAULTS.slice(3)],
  hard: [...BASIC_FAULTS, ...STANDARD_FAULTS, 'unknown-city', 'forged-seal', ...WORK_FAULTS.slice(3),
    'missing-vaccination', 'old-vaccination', 'future-vaccination', 'wrong-vaccine', 'vaccination-number',
    'missing-identity-record', 'registry-fingerprint', 'unregistered-alias', 'disputed-identity',
    'diplomatic-destination', 'diplomatic-country', 'asylum-birth-date', 'asylum-fingerprint', 'entry-status-mismatch'],
};
export const JOBS = [
  { sector: 'industry', role: 'engine mechanic', employer: 'Aster Harbor Works' },
  { sector: 'industry', role: 'electrician', employer: 'North Dock Services' },
  { sector: 'health', role: 'nurse', employer: 'Transit Station Clinic' },
  { sector: 'health', role: 'physician', employer: 'Vela Medical Center' },
  { sector: 'transport', role: 'cargo coordinator', employer: 'Vela Logistics' },
  { sector: 'transport', role: 'truck driver', employer: 'Orion Freight' },
  { sector: 'education', role: 'school teacher', employer: 'Aster Academy' },
  { sector: 'education', role: 'college lecturer', employer: 'Lyra College' },
  { sector: 'technology', role: 'software engineer', employer: 'Lyra Systems' },
  { sector: 'technology', role: 'computer programmer', employer: 'Nova Computing' },
  { sector: 'hospitality', role: 'restaurant chef', employer: 'Altair Catering' },
  { sector: 'hospitality', role: 'kitchen assistant', employer: 'Mira Restaurant' },
];
const HAIR = {
  short: ['Hair closely cropped above the ears.', 'Short hair, neatly trimmed.'],
  long: ['Long hair reaching the shoulders.', 'Shoulder-length hair worn loose.'],
  bald: ['Bald head, with no hair.', 'The scalp is completely bald.'],
  covered: ['Hair covered by a headscarf.', 'A hat covers the hair.'],
};
const DIPLOMATIC_TEXT = ['Authorized for official diplomatic duties at the embassy in Aster.',
  'Accredited diplomat. This authorization covers an official embassy posting.',
  'The holder represents our government on a diplomatic mission.'];
const ASYLUM_TEXT = ['Refugee protection is granted. Entry is authorized under asylum provisions.',
  'This grant recognizes the holder as a refugee seeking protected residence.',
  'Admission is authorized for asylum and refugee protection.'];
const VACCINES = ['Polio vaccination recorded. Vaccine: inactivated poliovirus.',
  'Immunization against poliomyelitis has been administered.', 'Polio immunization complete.'];
const REGISTRY = ['The registered names below identify one person. The second name is a recognized alias.',
  'Civil registry confirms these names belong to the same individual.',
  'The listed names are certified aliases for one person in the identity database.'];
function randomFor(seed, index) {
  let value = 2166136261;
  for (const c of `${seed}:levels:${index}`) value = Math.imul(value ^ c.charCodeAt(0), 16777619);
  return () => { value = (value + 0x6D2B79F5) | 0; let n = Math.imul(value ^ value >>> 15, 1 | value);
    n ^= n + Math.imul(n ^ n >>> 7, 61 | n); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}
const dateOffset = days => { const d = new Date(TODAY + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

export function generateLevelCase(seed, index, { difficulty, invalidRate = 0.5, maxFaults = 3 }, baseGenerator) {
  if (!Object.hasOwn(LEVELS, difficulty)) throw new RangeError('Choose easy, medium or hard difficulty.');
  if (!Number.isInteger(index) || index < 0) throw new RangeError('Arrival index must be a nonnegative integer.');
  if (!Number.isFinite(invalidRate) || invalidRate < 0 || invalidRate > 1) throw new RangeError('Invalid-document rate must be between 0 and 1.');
  if (![1, 3].includes(maxFaults)) throw new RangeError('Choose one fault or up to three faults.');
  const random = randomFor(String(seed), index), pick = list => list[Math.floor(random() * list.length)];
  const integer = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
  const primary = random() < invalidRate ? pick(LEVEL_FAULTS[difficulty]) : null;
  const forcedWork = WORK_FAULTS.includes(primary);
  const forcedOrdinary = forcedWork || [...STANDARD_FAULTS, 'purpose-mismatch'].includes(primary);
  const route = difficulty !== 'hard' || forcedOrdinary ? 'ordinary' : primary?.startsWith('diplomatic-') ? 'diplomatic'
    : primary?.startsWith('asylum-') ? 'asylum' : random() < 0.6 ? 'ordinary' : pick(['diplomatic', 'asylum']);
  let item, attempt = 0;
  do { item = baseGenerator(`${seed}:level-base:${attempt++}`, index, { invalidRate: 0, maxFaults: 1 }); }
  while (forcedWork && item.annotation.declared !== 'work');
  const kind = item.annotation.declared, holder = item.passport.holder, number = item.passport.number;
  const job = pick(JOBS), appearance = pick(Object.keys(HAIR)), otherHair = pick(Object.keys(HAIR).filter(key => key !== appearance));
  const heightCm = integer(150, 200), weightKg = integer(48, 115), stayDays = integer(3, 60);
  const fingerprint = `FP-${integer(100000, 999999)}-${index + 1}`;
  item.difficulty = difficulty;
  item.passport.city = pick(CITIES[item.passport.country]); item.passport.birthDate = `${integer(1960, 2005)}-${String(integer(1, 12)).padStart(2, '0')}-${String(integer(1, 28)).padStart(2, '0')}`;
  const dates = () => ({ issued: dateOffset(-integer(0, 30)), expires: dateOffset(integer(1, 180)) });
  const doc = (id, fields) => ({ holder, passportNumber: number, ...dates(), seal: DOCUMENTS[id].seal, ...fields });
  item.permit = { ...item.permit, maxStayDays: stayDays + integer(0, 30), seal: DOCUMENTS.permit.seal };
  item.declaration = { ...item.declaration, stayDays, heightCm, weightKg, appearance: pick(HAIR[appearance]), fingerprint };
  if (kind === 'work') {
    item.permit.text = `Paid employment as a ${job.role} with ${job.employer} is authorized.`;
    item.declaration.text = pick([`I have been hired as a ${job.role} at ${job.employer} for a monthly salary.`,
      `This trip is for a paid ${job.role} position with ${job.employer}.`, `I am starting salaried employment as a ${job.role} at ${job.employer}.`]);
    item.letter = { holder, issuer: job.employer, signed: true, text: pick([
      `We confirm a current paid job as a ${job.role} for this traveler at ${job.employer}.`,
      `The traveler is our salaried ${job.role}. Their employment at ${job.employer} is confirmed.`,
      `Our personnel office confirms that this traveler is employed as a paid ${job.role} at ${job.employer}.`]) };
  }
  if (difficulty === 'easy') {
    delete item.passport.city; delete item.passport.birthDate;
    for (const key of ['heightCm', 'weightKg', 'appearance', 'fingerprint']) delete item.declaration[key];
  } else if (difficulty === 'medium') delete item.declaration.fingerprint;
  item.packet = ['passport', 'permit', 'declaration', ...(kind === 'work' ? ['letter'] : [])];
  if (difficulty === 'medium') {
    item.identity = doc('identity', { heightCm, weightKg, appearance: pick(HAIR[appearance]) }); item.packet.splice(2, 0, 'identity');
  }
  if (difficulty !== 'easy' && kind === 'work' && route === 'ordinary') {
    item.workPass = doc('workPass', { employer: job.employer, text: `Authorized paid occupation: ${job.role}.` }); item.packet.push('workPass');
  }
  const readings = {
    passport: { country: item.passport.country }, permit: { purpose: kind },
    declaration: { purpose: kind, appearance, route }, letter: { employment: kind === 'work', sector: job.sector },
    identity: { appearance }, workPass: { sector: job.sector }, access: { purpose: kind, appearance },
    diplomatic: { route: 'diplomatic' }, asylum: { route: 'asylum' }, vaccination: { coverage: 'polio' }, identityRecord: { identity: 'confirmed' },
  };
  if (difficulty === 'hard') {
    const alias = `${holder.split(' ')[0]} ${holder.split(' ')[1]}-Reed`;
    item.identityRecord = doc('identityRecord', { aliases: [holder, alias], fingerprint, text: pick(REGISTRY) });
    item.vaccination = doc('vaccination', { vaccinated: dateOffset(-integer(0, 1000)), text: pick(VACCINES) });
    // A vaccination certificate records an administration date, not a permit-validity interval.
    delete item.vaccination.issued; delete item.vaccination.expires;
    if (route === 'ordinary') {
      item.access = doc('access', { ...item.permit, heightCm, weightKg, appearance: pick(HAIR[appearance]) });
      item.packet = item.packet.map(id => id === 'permit' ? 'access' : id);
    } else {
      item[route] = doc(route, route === 'diplomatic' ? { country: item.passport.country, destinations: ['Aster', 'Vela', 'Orion'], text: pick(DIPLOMATIC_TEXT) }
        : { birthDate: item.passport.birthDate, fingerprint, text: pick(ASYLUM_TEXT) });
      item.declaration.text = route === 'diplomatic' ? 'I am an accredited diplomat reporting to the embassy for an official diplomatic mission.'
        : 'I am a refugee seeking asylum and protected residence.';
      item.letter = null; item.workPass = null; item.packet = ['passport', route, 'declaration'];
    }
    item.permit = null; item.packet.push('vaccination', 'identityRecord');
    // Some valid packets use a registered name on the primary document; name inequality alone is insufficient.
    if (random() < 0.25) item[item.access ? 'access' : route].holder = alias;
  }
  item.annotation = { ...item.annotation, readings };
  item.generation = { seed: String(seed), index, difficulty, faults: [] };
  const entryId = item.access ? 'access' : item.diplomatic ? 'diplomatic' : item.asylum ? 'asylum' : 'permit';
  const appearanceId = item.identity ? 'identity' : 'access';
  function applyFault(fault) {
    const entry = item[entryId];
    switch (fault) {
      case 'missing-passport': item.passport = null; break;
      case 'missing-permit': item[entryId] = null; break;
      case 'expired-passport': item.passport.expires = dateOffset(-integer(1, 365)); break;
      case 'invalid-calendar-date': item.passport.expires = '2027-02-30'; break;
      case 'expired-permit': entry.expires = dateOffset(-integer(1, 90)); break;
      case 'future-permit': entry.issued = dateOffset(integer(1, 30)); break;
      case 'holder-mismatch': item.declaration.holder = holder + '-Other'; break;
      case 'number-mismatch': entry.passportNumber = number + '-X'; break;
      case 'purpose-mismatch': {
        const other = pick(['work', 'tourism', 'transit', 'study'].filter(value => value !== kind));
        entry.text = { work: 'Paid employment is authorized.', tourism: 'Leisure holidays and sightseeing are authorized.', transit: 'Transit to an onward destination is authorized.', study: 'Academic enrollment as a student is authorized.' }[other];
        readings[entryId].purpose = other; break;
      }
      case 'missing-letter': item.letter = null; break;
      case 'unsigned-letter': item.letter.signed = false; break;
      case 'withdrawn-employment': item.letter.text = 'The proposed job was withdrawn. This traveler has no paid position with our company.'; readings.letter.employment = false; break;
      case 'missing-identity': item.identity = null; break;
      case 'expired-identity': item.identity.expires = dateOffset(-1); break;
      case 'identity-number': item.identity.passportNumber += '-X'; break;
      case 'appearance-mismatch': item[appearanceId].appearance = pick(HAIR[otherHair]); readings[appearanceId].appearance = otherHair; break;
      case 'height-mismatch': item[appearanceId].heightCm += integer(5, 15); break;
      case 'weight-mismatch': item[appearanceId].weightKg += integer(5, 15); break;
      case 'stay-too-long': item.declaration.stayDays = entry.maxStayDays + integer(1, 10); break;
      case 'unknown-city': item.passport.city = 'Unregistered City'; break;
      case 'forged-seal': entry.seal = 'MOA-71'; break;
      case 'missing-work-pass': item.workPass = null; break;
      case 'expired-work-pass': item.workPass.expires = dateOffset(-1); break;
      case 'work-employer-mismatch': item.workPass.employer += ' West'; break;
      case 'work-sector-mismatch': {
        const other = pick(JOBS.filter(other => other.sector !== job.sector)); item.workPass.text = `Authorized paid occupation: ${other.role}.`; readings.workPass.sector = other.sector; break;
      }
      case 'missing-vaccination': item.vaccination = null; break;
      case 'old-vaccination': item.vaccination.vaccinated = dateOffset(-1500); break;
      case 'future-vaccination': item.vaccination.vaccinated = dateOffset(1); break;
      case 'wrong-vaccine': item.vaccination.text = pick(['Vaccinations recorded: measles and tetanus.', 'Cholera immunization administered.']); readings.vaccination.coverage = 'other'; break;
      case 'vaccination-number': item.vaccination.passportNumber += '-X'; break;
      case 'missing-identity-record': item.identityRecord = null; break;
      case 'registry-fingerprint': item.identityRecord.fingerprint += '-X'; break;
      case 'unregistered-alias': entry.holder = holder + '-Unknown'; break;
      case 'disputed-identity': item.identityRecord.text = 'The listed names identify two different people. These are separate identities, not aliases for one individual.'; readings.identityRecord.identity = 'disputed'; break;
      case 'diplomatic-destination': item.diplomatic.destinations = ['Vela', 'Orion']; break;
      case 'diplomatic-country': item.diplomatic.country = item.passport.country === 'Vela' ? 'Orion' : 'Vela'; break;
      case 'asylum-birth-date': item.asylum.birthDate = '1951-01-01'; break;
      case 'asylum-fingerprint': item.asylum.fingerprint += '-X'; break;
      case 'entry-status-mismatch': {
        const other = route === 'diplomatic' ? 'asylum' : 'diplomatic';
        item.declaration.text = other === 'asylum' ? 'I am a refugee seeking asylum and protected residence.' : 'I am an accredited diplomat reporting for official embassy duties.';
        readings.declaration.route = other; break;
      }
      default: throw new Error('Unknown fault: ' + fault);
    }
    item.generation.faults.push(fault);
  }
  if (primary) {
    applyFault(primary);
    // Further defects touch independent fields and cannot remove/repair the primary fault.
    const candidates = ['holder-mismatch', 'number-mismatch', 'expired-passport'].filter(fault => fault !== primary &&
      (fault !== 'number-mismatch' || item[entryId]) && (fault !== 'expired-passport' || (item.passport && primary !== 'invalid-calendar-date')));
    const limit = difficulty === 'easy' ? 1 : maxFaults;
    const count = integer(0, limit - 1);
    for (let n = 0; n < count && candidates.length; n++) { const fault = pick(candidates); candidates.splice(candidates.indexOf(fault), 1); applyFault(fault); }
  }
  return item;
}
