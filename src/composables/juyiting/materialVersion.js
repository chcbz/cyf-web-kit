// Workspace public versions are canonical positive decimal int32 strings.
export const validMaterialVersion = value => typeof value === 'string' &&
  /^[1-9][0-9]*$/.test(value) && value.length <= 10 && BigInt(value) <= 2147483647n
