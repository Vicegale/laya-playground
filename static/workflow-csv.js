const delimiters = [',', ';', '\t', '|'];

function delimiterValue(value) {
  if (!delimiters.includes(value)) throw new Error('CSV delimiter must be comma, semicolon, tab or pipe.');
  return value;
}

function detectDelimiter(text) {
  const counts = new Map(delimiters.map(d => [d, 0]));
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (c === '\r' || c === '\n') {
        if ([...counts.values()].some(Boolean) || i > 0) break;
      }
      if (counts.has(c)) counts.set(c, counts.get(c) + 1);
    }
  }
  return delimiters.reduce((best, d) => counts.get(d) > counts.get(best) ? d : best, ',');
}

// CSV values stay strings. The first record supplies exact, unique field names.
export function parseCSV(content, { delimiter = 'auto' } = {}) {
  if (typeof content !== 'string') throw new Error('CSV input must be text. Load a UTF-8 CSV file or paste its contents.');
  const text = content.replace(/^\uFEFF/, '');
  delimiter = delimiter === 'auto' ? detectDelimiter(text.replace(/^(?:\r\n|\r|\n)+/, '')) : delimiterValue(delimiter);
  const records = [];
  let fields = [], field = '', quoted = false, closed = false, touched = false, line = 1, recordLine = 1;
  const fail = message => { throw new Error(`CSV line ${line}: ${message}`); };
  const endField = () => { fields.push(field); field = ''; closed = false; };
  const endRecord = () => {
    endField();
    if (touched || fields.length > 1 || fields[0] !== '') records.push({ values: fields, line: recordLine });
    fields = []; touched = false; recordLine = line + 1;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else {
        field += c;
        if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) line++;
      }
      continue;
    }
    if (c === delimiter) { touched = true; endField(); }
    else if (c === '\r' || c === '\n') {
      endRecord();
      if (c === '\r' && text[i + 1] === '\n') i++;
      line++;
    } else if (closed) fail('unexpected text after a closing quote.');
    else if (c === '"') {
      if (field.length) fail('a quote must start a field; double quotes inside quoted fields.');
      quoted = true; touched = true;
    } else { field += c; touched = true; }
  }
  if (quoted) fail('unterminated quoted field.');
  if (touched || fields.length || field.length) endRecord();
  if (!records.length) throw new Error('CSV has no header. Load a file with column names on its first row.');
  const columns = records.shift().values;
  const seen = new Set();
  columns.forEach((column, i) => {
    if (!column.trim()) throw new Error(`CSV header ${i + 1} is blank. Give each column a name.`);
    if (seen.has(column)) throw new Error(`CSV header “${column}” is duplicated. Column names must be unique.`);
    seen.add(column);
  });
  const rows = records.map(record => {
    if (record.values.length > columns.length) throw new Error(`CSV line ${record.line}: found ${record.values.length} fields for ${columns.length} columns.`);
    return Object.fromEntries(columns.map((column, i) => [column, record.values[i] ?? '']));
  });
  return { rows, columns, delimiter };
}

export function csvFilename(value) {
  const name = String(value ?? '').replace(/[\\/<>:"|?*\u0000-\u001F]/g, '_').trim() || 'output.csv';
  return /\.csv$/i.test(name) ? name : `${name}.csv`;
}

export function sortCSVRows(rows, { sortBy = '', sortDirection = 'asc' } = {}) {
  if (!sortBy) return rows;
  if (!Array.isArray(rows)) throw new Error('CSV Output expects an array of row objects.');
  if (!['asc', 'desc'].includes(sortDirection)) throw new Error('CSV sort direction must be ascending or descending.');
  if (rows.length && !rows.some(row => row && Object.prototype.hasOwnProperty.call(row, sortBy))) throw new Error(`CSV sort column “${sortBy}” was not found in the rows.`);
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  const missing = value => value == null || value === '';
  const sorted = rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`CSV row ${index + 1} must be an object with named columns.`);
    const value = Object.prototype.hasOwnProperty.call(row, sortBy) ? row[sortBy] : undefined;
    if (value != null && typeof value === 'object') throw new Error(`CSV row ${index + 1}: sort column “${sortBy}” must contain scalar values.`);
    return { row, index, value };
  });
  sorted.sort((a, b) => {
    if (missing(a.value) || missing(b.value)) return Number(missing(a.value)) - Number(missing(b.value)) || a.index - b.index;
    const order = typeof a.value === 'number' && typeof b.value === 'number' ? a.value - b.value : collator.compare(String(a.value), String(b.value));
    return order * (sortDirection === 'desc' ? -1 : 1) || a.index - b.index;
  });
  return sorted.map(entry => entry.row);
}

export function stringifyCSV(rows, { columns = [], delimiter = ',', bom = true } = {}) {
  delimiterValue(delimiter);
  if (!Array.isArray(rows)) throw new Error('CSV Output expects an array of row objects. Use the CSV rows or the collected Map/For Each results.');
  if (!Array.isArray(columns) || columns.some(c => typeof c !== 'string' || !c.trim()) || new Set(columns).size !== columns.length) {
    throw new Error('CSV columns must be an array of unique, nonempty names.');
  }
  const headers = [...columns], seen = new Set(headers);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`CSV row ${i + 1} must be an object with named columns.`);
    for (const key of Object.keys(row)) {
      if (!key.trim()) throw new Error(`CSV row ${i + 1} has an unnamed column.`);
      if (!seen.has(key)) { seen.add(key); headers.push(key); }
    }
  }
  if (!headers.length) throw new Error('CSV Output has no columns. For an empty list, supply the original CSV column names.');
  const cell = value => {
    const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    return text.includes(delimiter) || /["\r\n]/.test(text) || text === '' ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers.map(cell).join(delimiter)];
  rows.forEach((row, i) => {
    try { lines.push(headers.map(key => cell(Object.prototype.hasOwnProperty.call(row, key) ? row[key] : '')).join(delimiter)); }
    catch (cause) { throw new Error(`CSV row ${i + 1} could not be serialized: ${cause.message}`); }
  });
  return { content: `${bom ? '\uFEFF' : ''}${lines.join('\r\n')}\r\n`, columns: headers, rowCount: rows.length };
}
