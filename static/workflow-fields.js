export const FIELD_TRANSFORMS = [
  ['none', 'As is'], ['trim', 'Trim'], ['lower', 'Trim + lowercase'],
  ['upper', 'Trim + uppercase'], ['number', 'To number'],
  ['boolean', 'To boolean'], ['round', 'Round to 2 decimals'],
];

export function transformField(value, transform = 'none') {
  if (value === undefined) throw new Error('Value is missing. Choose an available field or use an explicit null.');
  if (transform === 'none') return value;
  if (['trim', 'lower', 'upper'].includes(transform)) {
    if (typeof value !== 'string') throw new Error('Text cleanup requires a text value.');
    const text = value.trim();
    return transform === 'lower' ? text.toLowerCase() : transform === 'upper' ? text.toUpperCase() : text;
  }
  if (transform === 'number' || transform === 'round') {
    if (!['string', 'number'].includes(typeof value) || (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value))) throw new Error('Expected a finite number or numeric text.');
    const number = Number(value);
    // At this magnitude the number has no representable fractional digits.
    const scaled = (number + Number.EPSILON) * 100;
    return transform === 'round' && Number.isFinite(scaled) ? Math.round(scaled) / 100 : number;
  }
  if (transform === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string' && /^(true|false)$/i.test(value.trim())) return value.trim().toLowerCase() === 'true';
    throw new Error('Expected true or false, or the text “true” / “false”.');
  }
  throw new Error(`Unknown field transform: ${transform}`);
}

export function validateColumns(columns) {
  if (!Array.isArray(columns) || !columns.length) throw new Error('Add at least one output column.');
  const names = new Set();
  return columns.map((column, i) => {
    const name = typeof column?.name === 'string' ? column.name.trim() : '';
    if (!name) throw new Error(`Column ${i + 1}: choose an output name.`);
    if (names.has(name)) throw new Error(`Column “${name}” is repeated. Use unique output names.`);
    if (!FIELD_TRANSFORMS.some(([id]) => id === (column.transform ?? 'none'))) throw new Error(`Column “${name}”: unknown transform.`);
    names.add(name);
    return { ...column, name };
  });
}

export function mapColumns(columns, resolve) {
  const output = {};
  for (const column of validateColumns(columns)) {
    try {
      const value = transformField(column.value === null ? null : resolve(column.value === undefined ? '' : column.value, `Column ${column.name}`), column.transform);
      Object.defineProperty(output, column.name, { value, enumerable: true, configurable: true, writable: true });
    } catch (error) { throw new Error(`Column “${column.name}”: ${error.message}`); }
  }
  return output;
}
