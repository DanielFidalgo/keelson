export class DomainValidationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(problems.join('; '));
    this.name = 'DomainValidationError';
    this.problems = Object.freeze([...problems]);
  }
}

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}
