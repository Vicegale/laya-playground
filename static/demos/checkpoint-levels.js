// Difficulty packets: printed observations -> stock-model readings -> explicit cross-checks.
// Construction annotations are used only by expectedLevelAdmission, never by the runtime policy.
import { TODAY, PURPOSES, PURPOSE_LABELS, RULES } from './checkpoint-common.js';

export const LEVELS = {
  easy: { label: 'Easy', documents: '3–4 papers', summary: 'Identity, expiry and purpose agreement.',
    rules: RULES },
  medium: { label: 'Medium', documents: '4–6 papers', summary: 'Add identity supplements, work passes, stay limits and employment fields.',
    rules: [...RULES.slice(0, 5), 'An identity supplement is required; appearance, height and weight must match the arrival statement.',
      'Issuing cities and printed seal codes must match the authority register.', 'Declared stay cannot exceed the permit allowance.',
      'Workers also need a current work pass; its employer and job field must agree with the employer letter.', RULES[5]] },
  hard: { label: 'Hard', documents: '5–7 papers', summary: 'Access permits, health records, aliases and diplomatic/asylum exceptions.',
    rules: ['A current passport, arrival declaration, identity record and vaccination certificate are required.',
      'Ordinary visitors need an access permit; diplomats need diplomatic authorization; asylum entrants need an asylum grant.',
      'Diplomatic and asylum documents replace the access permit, not the passport, identity record or health certificate.',
      'Names and passport numbers must agree. A registered alias is allowed only with a confirmed identity record and matching fingerprint codes.',
      'Issuing cities, dates and seal codes must match the authority register.',
      'Aster must appear on diplomatic destinations; the issuing nation must match the passport.',
      'Asylum birth dates and fingerprint codes must match the passport and identity record.',
      'Polio coverage must be confirmed; the vaccination date must be within the last three calendar years.',
      'Access-permit appearance and measurements must agree with the arrival declaration; stay must fit the allowance.',
      'Work visits need a signed employment letter and current work pass with matching employer and job field.', RULES[5]] },
};

export const COUNTRIES = ['Aster', 'Vela', 'Orion', 'Lyra', 'Nova', 'Corvus', 'Altair', 'Mira', 'Deneb', 'Solara'];
export const CITIES = Object.fromEntries(COUNTRIES.map(country => [country, [`${country} City`, `${country} Port`]]));
export const SECTORS = { industry: 'manufacturing, mechanical repair and electrical trades', health: 'medicine and clinical care',
  transport: 'cargo handling, shipping and logistics', education: 'teaching and academic instruction',
  technology: 'software development and computing', hospitality: 'restaurants, kitchens and catering' };
export const APPEARANCES = { short: 'short or closely cropped hair', long: 'long hair reaching the shoulders',
  bald: 'bald head without hair', covered: 'hair covered by a hat or headscarf' };
export const ROUTES = { ordinary: 'Ordinary civilian travel for personal reasons or a paid job.',
  diplomatic: 'Official diplomatic service at an embassy.', asylum: 'Refugee protection and asylum.' };
const ENTRY_STATUS_QUESTION = 'Which type of entry is described?';
export const LABELS = { ...PURPOSE_LABELS, ...Object.fromEntries(COUNTRIES.map(c => [c, c])),
  industry: 'Industry', health: 'Healthcare', transport: 'Transport', education: 'Education', technology: 'Technology', hospitality: 'Hospitality',
  short: 'Short hair', long: 'Long hair', bald: 'Bald', covered: 'Covered hair', ordinary: 'Ordinary entry', diplomatic: 'Diplomatic entry', asylum: 'Asylum',
  polio: 'Polio covered', other: 'Other vaccine only', confirmed: 'Identity confirmed', disputed: 'Identity disputed' };
const READING_LABELS = { country: 'issuing country', purpose: 'visit purpose', route: 'entry status', appearance: 'appearance',
  employment: 'employment confirmation', sector: 'job field', coverage: 'vaccination coverage', identity: 'identity confirmation' };
const f = (key, label, type = 'text') => ({ key, label, type });
const holder = f('holder', 'Holder'), number = f('passportNumber', 'Passport no.'), issued = f('issued', 'Valid from', 'date'), expires = f('expires', 'Until', 'date');
const seal = f('seal', 'Authority seal code'), text = f('text', 'Printed statement', 'textarea');
const biometrics = [f('heightCm', 'Height · cm', 'number'), f('weightKg', 'Weight · kg', 'number'), f('appearance', 'Appearance', 'textarea')];
export const DOCUMENTS = {
  passport: { title: 'Passport', authority: 'Passport office', fields: [holder, f('number', 'Passport no.'), f('country', 'Nationality'), f('city', 'Issuing city'), f('birthDate', 'Date of birth', 'date'), expires] },
  declaration: { title: 'Arrival declaration', authority: 'Signed at arrival', fields: [holder, f('stayDays', 'Declared stay · days', 'number'), ...biometrics, f('fingerprint', 'Arrival fingerprint code'), text] },
  permit: { title: 'Entry permit', authority: 'Ministry of transit', seal: 'MOA-17', fields: [holder, number, issued, expires, f('maxStayDays', 'Maximum stay · days', 'number'), seal, text] },
  identity: { title: 'Identity supplement', authority: 'Identity bureau', seal: 'ID-08', fields: [holder, number, issued, expires, ...biometrics, seal] },
  workPass: { title: 'Work pass', authority: 'Labor bureau', seal: 'LAB-02', fields: [holder, number, f('employer', 'Employer'), issued, expires, seal, text] },
  letter: { title: 'Employer letter', authority: 'Personnel office', fields: [holder, f('issuer', 'Employer'), f('signed', 'Signed', 'checkbox'), text] },
  access: { title: 'Access permit', authority: 'Ministry of transit', seal: 'MOA-17', fields: [holder, number, issued, expires, f('maxStayDays', 'Maximum stay · days', 'number'), ...biometrics, seal, text] },
  diplomatic: { title: 'Diplomatic authorization', authority: 'Foreign affairs', seal: 'DIP-11', fields: [holder, number, f('country', 'Issuing nation'), f('destinations', 'Authorized countries', 'list'), issued, expires, seal, text] },
  asylum: { title: 'Grant of asylum', authority: 'Protection bureau', seal: 'ASY-06', fields: [holder, number, f('birthDate', 'Date of birth', 'date'), f('fingerprint', 'Fingerprint code'), issued, expires, seal, text] },
  vaccination: { title: 'Vaccination certificate', authority: 'Public health bureau', seal: 'HLT-03', fields: [holder, number, f('vaccinated', 'Vaccination date', 'date'), seal, text] },
  identityRecord: { title: 'Identity record', authority: 'Civil registry', seal: 'REG-04', fields: [holder, number, f('aliases', 'Registered names', 'list'), f('fingerprint', 'Fingerprint code'), issued, expires, seal, text] },
};

export const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.trim().length > 0 &&
  a.normalize('NFC').trim().toLocaleLowerCase('en') === b.normalize('NFC').trim().toLocaleLowerCase('en');
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const current = doc => validDate(doc.issued) && doc.issued <= TODAY && validDate(doc.expires) && doc.expires >= TODAY;
const supplied = item => Object.keys(DOCUMENTS).filter(id => item[id]);
export function printedDocument(item, id) {
  const doc = item[id], spec = DOCUMENTS[id];
  return [spec.title, ...spec.fields.filter(field => doc[field.key] !== undefined).map(field =>
    `${field.label}: ${Array.isArray(doc[field.key]) ? doc[field.key].join(', ') : typeof doc[field.key] === 'boolean' ? (doc[field.key] ? 'Yes' : 'No') : doc[field.key]}`)].join('\n');
}

export function levelChecks(item) {
  const checks = [], add = (id, label, ok, detail, fields) => checks.push({ id, label, ok: !!ok, detail, fields });
  for (const id of ['passport', 'declaration', ...(item.difficulty === 'medium' ? ['identity'] : item.difficulty === 'hard' ? ['identityRecord', 'vaccination'] : [])]) {
    add(id, `${DOCUMENTS[id].title} present`, item[id], item[id] ? 'Submitted.' : 'Required document missing.', [id]);
  }
  const primary = item.difficulty === 'hard' ? ['access', 'diplomatic', 'asylum'] : ['permit'];
  add('entry_document', 'Required entry document', primary.filter(id => item[id]).length === 1,
    item.difficulty === 'hard' ? 'Supply exactly one access permit, diplomatic authorization or asylum grant.' : 'An entry permit is required.', primary);
  const p = item.passport;
  if (p) {
    add('passport_date', 'Passport expiry', validDate(p.expires) && p.expires >= TODAY, `Inspection date ${TODAY}; expiry ${p.expires}.`, ['passport.expires']);
    if (item.difficulty !== 'easy') add('issuing_city', 'Passport issuing city', CITIES[p.country]?.some(city => same(city, p.city)),
      `Registered cities for ${p.country}: ${(CITIES[p.country] || []).join(', ')}.`, ['passport.country', 'passport.city']);
  }
  for (const id of supplied(item)) {
    const doc = item[id], spec = DOCUMENTS[id];
    if (spec.fields.some(f => f.key === 'issued')) add(id + '_date', `${spec.title} dates`, current(doc),
      `Valid ${doc.issued || '—'} through ${doc.expires || '—'}.`, [id + '.issued', id + '.expires']);
    if (item.difficulty !== 'easy' && spec.seal) add(id + '_seal', `${spec.title} seal`, same(doc.seal, spec.seal),
      `Authority register requires ${spec.seal}; supplied ${doc.seal || '—'}.`, [id + '.seal']);
    if (p && doc.passportNumber !== undefined) add(id + '_number', `${spec.title} passport link`, same(p.number, doc.passportNumber),
      `${p.number} on passport; ${doc.passportNumber} on ${spec.title.toLowerCase()}.`, ['passport.number', id + '.passportNumber']);
    if (p && id !== 'passport') {
      const aliases = item.identityRecord?.aliases;
      const alias = item.difficulty === 'hard' && Array.isArray(aliases) && aliases.some(n => same(n, p.holder)) && aliases.some(n => same(n, doc.holder));
      add(id + '_holder', `${spec.title} holder`, same(p.holder, doc.holder) || alias,
        'Holder must match the passport or a registered name on the identity record.', ['passport.holder', id + '.holder', ...(alias ? ['identityRecord.aliases'] : [])]);
    }
  }
  const permit = item.permit || item.access;
  if (item.difficulty !== 'easy' && permit && item.declaration) {
    const id = item.access ? 'access' : 'permit';
    add('stay_limit', 'Stay within authorization', Number.isInteger(item.declaration.stayDays) && item.declaration.stayDays > 0 &&
      Number.isInteger(permit.maxStayDays) && item.declaration.stayDays <= permit.maxStayDays,
    `Declared ${item.declaration.stayDays} days; allowed ${permit.maxStayDays}.`, ['declaration.stayDays', id + '.maxStayDays']);
  }
  const identity = item.identity || item.access;
  if (identity && item.declaration && item.difficulty !== 'easy') {
    const id = item.identity ? 'identity' : 'access';
    for (const key of ['heightCm', 'weightKg']) add(key, key === 'heightCm' ? 'Height agreement' : 'Weight agreement',
      Number.isInteger(identity[key]) && identity[key] > 0 && identity[key] === item.declaration[key],
      `${identity[key]} on document; ${item.declaration[key]} on arrival declaration.`, [id + '.' + key, 'declaration.' + key]);
  }
  if (item.workPass && item.letter) add('employer', 'Employer agreement', same(item.workPass.employer, item.letter.issuer),
    'Work pass and letter must name the same employer.', ['workPass.employer', 'letter.issuer']);
  if (item.difficulty === 'hard') {
    if (item.vaccination) {
      const oldest = `${Number(TODAY.slice(0, 4)) - 3}${TODAY.slice(4)}`;
      add('vaccination_age', 'Vaccination current', validDate(item.vaccination.vaccinated) && item.vaccination.vaccinated >= oldest && item.vaccination.vaccinated <= TODAY,
        `Vaccination must fall between ${oldest} and ${TODAY}.`, ['vaccination.vaccinated']);
    }
    if (item.identityRecord && item.declaration) add('registry_fingerprint', 'Identity-record fingerprints',
      same(item.identityRecord.fingerprint, item.declaration.fingerprint), 'Registry and arrival fingerprint codes must match.', ['identityRecord.fingerprint', 'declaration.fingerprint']);
    if (item.diplomatic) {
      add('diplomatic_destination', 'Diplomatic destination', Array.isArray(item.diplomatic.destinations) && item.diplomatic.destinations.some(c => same(c, 'Aster')),
        'The authorization must grant access to Aster.', ['diplomatic.destinations']);
      if (p) add('diplomatic_country', 'Diplomatic issuing nation', same(item.diplomatic.country, p.country), 'Issuing nation must match passport nationality.', ['diplomatic.country', 'passport.country']);
    }
    if (item.asylum && p) {
      add('asylum_birth', 'Asylum birth date', validDate(item.asylum.birthDate) && same(item.asylum.birthDate, p.birthDate),
        'Asylum grant and passport must agree on birth date.', ['asylum.birthDate', 'passport.birthDate']);
      add('asylum_fingerprint', 'Asylum fingerprints', same(item.asylum.fingerprint, item.identityRecord?.fingerprint),
        'Asylum grant and identity record must have the same fingerprint code.', ['asylum.fingerprint', 'identityRecord.fingerprint']);
    }
  }
  return checks;
}

const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });
export function translateLevelDocuments(item) {
  const requests = supplied(item).map(id => {
    const questions = {};
    if (id === 'passport') questions.country = choice('Which country issued this passport?', Object.fromEntries(COUNTRIES.map(c => [c, `issued by ${c}`])));
    if (['permit', 'access'].includes(id)) questions.purpose = choice('What type of visit is permitted by this document?', PURPOSES);
    if (id === 'declaration') {
      if (!item.diplomatic && !item.asylum) questions.purpose = choice('What is the purpose of this visit?', PURPOSES);
      if (item.difficulty === 'hard') questions.route = choice(ENTRY_STATUS_QUESTION, ROUTES);
    }
    if (item.difficulty !== 'easy' && ['identity', 'access', 'declaration'].includes(id) && !(id === 'declaration' && (item.diplomatic || item.asylum))) questions.appearance = choice('How is the traveler’s hair described?', APPEARANCES);
    if (id === 'letter') {
      questions.employment = { type: 'noul', instructions: 'Does this letter confirm that the traveler has a paid job?' };
      if (item.difficulty !== 'easy') questions.sector = choice('What field is the paid job in?', SECTORS);
    }
    if (id === 'workPass') questions.sector = choice('What field of work does this pass authorize?', SECTORS);
    if (['diplomatic', 'asylum'].includes(id)) questions.route = choice(ENTRY_STATUS_QUESTION, ROUTES);
    if (id === 'vaccination') questions.coverage = choice('Which vaccination coverage is recorded?', {
      polio: 'a vaccination against polio or poliomyelitis is recorded', other: 'vaccinations for other diseases such as measles, cholera or tetanus only' });
    if (id === 'identityRecord') questions.identity = choice('What does the registry establish about the listed names?', {
      confirmed: 'registered names and aliases belong to the same person', disputed: 'the names belong to different people with separate identities' });
    return { id, title: DOCUMENTS[id].title, model: 'english', lang: 'en', state: printedDocument(item, id), questions };
  });
  return { checks: levelChecks(item), requests };
}

export function decideLevelAdmission(item, plan, responses, threshold = 0.6) {
  const reasons = [], fields = [], unsure = [], uncertaintyFields = [];
  const fail = (condition, reason, paths) => { if (!condition) { reasons.push(reason); fields.push(...paths); } };
  const read = (id, qid) => {
    const q = plan.requests.find(r => r.id === id)?.questions[qid], a = responses[id]?.answers?.[qid];
    if (!q || !a || a.type !== q.type) throw new Error(`Missing ${DOCUMENTS[id].title} ${qid} reading.`);
    const value = a.type === 'noul' ? a.noul >= 0.5 : a.choice;
    const probability = a.type === 'noul' ? Math.max(a.noul, 1 - a.noul) : a.probabilities?.[value];
    if (a.type === 'choice' && !Object.hasOwn(q.criteria, value)) throw new Error(`Unknown ${qid} choice.`);
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error(`Invalid ${qid} probability.`);
    if (probability < threshold) {
      const label = a.type === 'noul' ? (value ? 'Confirmed' : 'Not confirmed') : LABELS[value] || value;
      unsure.push(`${DOCUMENTS[id].title}: ${READING_LABELS[qid] || qid} needs review (${label}: ${(probability * 100).toFixed(2)}%; below ${(threshold * 100).toFixed(0)}%).`);
      uncertaintyFields.push(id);
    }
    return { value, certain: probability >= threshold };
  };
  const equalReadings = (a, b, reason, paths) => { if (a.certain && b.certain) fail(a.value === b.value, reason, paths); };
  // Formal failures remain decisive; model calls still run and are shown independently.
  const formal = plan.checks.filter(c => !c.ok);
  if (formal.length) return { decision: 'deny', reasons: formal.map(c => `${c.label}: failed.`), fields: formal.flatMap(c => c.fields) };
  const country = read('passport', 'country');
  if (country.certain) fail(same(country.value, item.passport.country), 'Passport country reading does not agree with its printed nationality.', ['passport.country']);
  let route = { value: 'ordinary', certain: true };
  if (item.difficulty === 'hard') {
    route = read('declaration', 'route');
    const id = item.access ? 'access' : item.diplomatic ? 'diplomatic' : 'asylum';
    const authorized = id === 'access' ? { value: 'ordinary', certain: true } : read(id, 'route');
    equalReadings(route, authorized, 'Declared entry status disagrees with the supplied authorization.', ['declaration.text', id]);
    const coverage = read('vaccination', 'coverage'), registry = read('identityRecord', 'identity');
    if (coverage.certain) fail(coverage.value === 'polio', 'The certificate does not record the required polio coverage.', ['vaccination.text']);
    if (registry.certain) fail(registry.value === 'confirmed', 'The registry identifies different people; it does not establish a single identity.', ['identityRecord.text']);
  }
  if (route.certain && route.value === 'ordinary') {
    const id = item.difficulty === 'hard' ? 'access' : 'permit';
    fail(!!item[id], 'Ordinary entry requires the correct permit.', [id]);
    if (item[id]) {
      const permitted = read(id, 'purpose'), declared = read('declaration', 'purpose');
      equalReadings(permitted, declared, 'Permitted and declared purposes disagree.', [id + '.text', 'declaration.text']);
      if (item.difficulty !== 'easy') equalReadings(read(item.identity ? 'identity' : 'access', 'appearance'), read('declaration', 'appearance'),
        'The appearance descriptions identify different hair profiles.', [item.identity ? 'identity.appearance' : 'access.appearance', 'declaration.appearance']);
      if (declared.certain && declared.value === 'work') {
        fail(item.letter?.signed, 'Work visits require a signed employer letter.', ['letter']);
        if (item.letter) { const employed = read('letter', 'employment'); if (employed.certain) fail(employed.value, 'The letter does not confirm a paid job.', ['letter.text']); }
        if (item.difficulty !== 'easy') {
          fail(!!item.workPass, 'Work visits require a work pass.', ['workPass']);
          if (item.workPass && item.letter) equalReadings(read('workPass', 'sector'), read('letter', 'sector'),
            'The work pass authorizes a different job field than the employer letter.', ['workPass.text', 'letter.text']);
        }
      }
    }
  }
  // A confident discrepancy is sufficient to deny, even if another reading is uncertain.
  if (reasons.length) return { decision: 'deny', reasons, fields };
  if (unsure.length) return { decision: 'review', reasons: unsure, fields: uncertaintyFields };
  return { decision: 'approve', reasons: ['All required papers and their cross-document readings agree.'], fields: [] };
}

// Explicitly grading-only: ideal readings establish generator consistency, never real decisions.
export function idealLevelReadings(item, plan = translateLevelDocuments(item)) {
  return Object.fromEntries(plan.requests.map(request => [request.id, { answers: Object.fromEntries(Object.entries(request.questions).map(([qid, question]) => {
    const value = item.annotation.readings[request.id][qid];
    return [qid, question.type === 'noul' ? { type: 'noul', noul: value ? 0.99 : 0.01 }
      : { type: 'choice', choice: value, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === value ? 0.99 : 0.01 / (Object.keys(question.criteria).length - 1)])) }];
  })) }]));
}
export function expectedLevelAdmission(item) {
  return decideLevelAdmission(item, translateLevelDocuments(item), idealLevelReadings(item)).decision;
}
