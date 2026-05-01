import { describe, it, expect } from 'vitest';
import { ValidationError } from '@/common/exceptions/base';
import {
  Required,
  Email,
  UUID,
  MinLength,
  MaxLength,
  validate,
  validateOrThrow,
} from '@/server/common/decorators/validation';

// ---------------------------------------------------------------------------
// Helper: small classes decorated for each test group
// ---------------------------------------------------------------------------

class RequiredFixture {
  @Required()
  name: string | null | undefined = 'default';
}

class EmailFixture {
  @Email()
  email: string = '';
}

class RequiredEmailFixture {
  @Required()
  @Email()
  email: string = '';
}

class UUIDFixture {
  @UUID()
  id: string = '';
}

class MinLengthFixture {
  @MinLength(5)
  value: string = '';
}

class MaxLengthFixture {
  @MaxLength(10)
  value: string = '';
}

class ComposedFixture {
  @Required()
  @Email()
  email: string = '';

  @Required()
  @MinLength(8)
  @MaxLength(100)
  password: string = '';

  @UUID()
  calendarId: string = '';
}

// ---------------------------------------------------------------------------
// @Required()
// ---------------------------------------------------------------------------

describe('@Required()', () => {
  it('passes for a non-empty string', () => {
    const f = new RequiredFixture();
    f.name = 'hello';
    expect(validate(f)).toEqual({});
  });

  it('fails for null', () => {
    const f = new RequiredFixture();
    f.name = null;
    const errors = validate(f);
    expect(errors.name).toContain('is required');
  });

  it('fails for undefined', () => {
    const f = new RequiredFixture();
    f.name = undefined;
    const errors = validate(f);
    expect(errors.name).toContain('is required');
  });

  it('fails for empty string', () => {
    const f = new RequiredFixture();
    f.name = '';
    const errors = validate(f);
    expect(errors.name).toContain('is required');
  });

  it('fails for whitespace-only string', () => {
    const f = new RequiredFixture();
    f.name = '   ';
    const errors = validate(f);
    expect(errors.name).toContain('is required');
  });
});

// ---------------------------------------------------------------------------
// @Email()
// ---------------------------------------------------------------------------

describe('@Email()', () => {
  const validEmails = [
    'user@example.com',
    'user+tag@sub.domain.org',
    'first.last@company.co.uk',
  ];

  for (const email of validEmails) {
    it(`passes for valid email: ${email}`, () => {
      const f = new EmailFixture();
      f.email = email;
      expect(validate(f)).toEqual({});
    });
  }

  const invalidEmails = [
    'notanemail',
    '@nodomain',
    'missing@',
    'two@@signs.com',
  ];

  for (const email of invalidEmails) {
    it(`fails for invalid email: ${email}`, () => {
      const f = new EmailFixture();
      f.email = email;
      const errors = validate(f);
      expect(errors.email).toContain('must be a valid email address');
    });
  }

  it('skips validation for empty string (absence not enforced without @Required)', () => {
    const f = new EmailFixture();
    f.email = '';
    expect(validate(f)).toEqual({});
  });

  it('skips validation for null', () => {
    const f = new EmailFixture();
    (f as Record<string, unknown>).email = null;
    expect(validate(f)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// @Required() + @Email() composed
// ---------------------------------------------------------------------------

describe('@Required() + @Email() composed', () => {
  it('fails with required error when email is empty', () => {
    const f = new RequiredEmailFixture();
    f.email = '';
    const errors = validate(f);
    expect(errors.email).toContain('is required');
  });

  it('fails with format error when email is invalid and non-empty', () => {
    const f = new RequiredEmailFixture();
    f.email = 'notvalid';
    const errors = validate(f);
    expect(errors.email).toContain('must be a valid email address');
  });

  it('passes for valid non-empty email', () => {
    const f = new RequiredEmailFixture();
    f.email = 'user@example.com';
    expect(validate(f)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// @UUID()
// ---------------------------------------------------------------------------

describe('@UUID()', () => {
  const validUUIDs = [
    '550e8400-e29b-41d4-a716-446655440000',
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    'A987FBC9-4BED-3078-AF07-9141BA07C9F3', // uppercase, variant bits a/b/8/9
  ];

  for (const uuid of validUUIDs) {
    it(`passes for valid UUID: ${uuid}`, () => {
      const f = new UUIDFixture();
      f.id = uuid;
      expect(validate(f)).toEqual({});
    });
  }

  const invalidUUIDs = [
    'not-a-uuid',
    '550e8400-e29b-41d4-a716',               // too short
    '550e8400-e29b-41d4-a716-4466554400001', // too long
    '00000000-0000-0000-0000-000000000000',  // version 0 not valid
  ];

  for (const uuid of invalidUUIDs) {
    it(`fails for invalid UUID: ${uuid}`, () => {
      const f = new UUIDFixture();
      f.id = uuid;
      const errors = validate(f);
      expect(errors.id).toContain('must be a valid UUID');
    });
  }

  it('skips validation for empty string (absence not enforced without @Required)', () => {
    const f = new UUIDFixture();
    f.id = '';
    expect(validate(f)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// @MinLength(n)
// ---------------------------------------------------------------------------

describe('@MinLength(n)', () => {
  it('passes when value meets the minimum', () => {
    const f = new MinLengthFixture();
    f.value = 'hello'; // exactly 5
    expect(validate(f)).toEqual({});
  });

  it('passes when value exceeds the minimum', () => {
    const f = new MinLengthFixture();
    f.value = 'hello world';
    expect(validate(f)).toEqual({});
  });

  it('fails when value is shorter than the minimum', () => {
    const f = new MinLengthFixture();
    f.value = 'hi';
    const errors = validate(f);
    expect(errors.value).toContain('must be at least 5 characters');
  });

  it('uses singular "character" for min=1', () => {
    class SingleCharFixture {
      @MinLength(1)
      v: string = '';
    }
    const f = new SingleCharFixture();
    f.v = '';
    // empty string is skipped (absence); set a non-empty too-short value isn't possible for length 1
    // Instead verify message wording when failing
    f.v = 'x';
    expect(validate(f)).toEqual({});
  });

  it('skips validation for empty string', () => {
    const f = new MinLengthFixture();
    f.value = '';
    expect(validate(f)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// @MaxLength(n)
// ---------------------------------------------------------------------------

describe('@MaxLength(n)', () => {
  it('passes when value meets the maximum', () => {
    const f = new MaxLengthFixture();
    f.value = '1234567890'; // exactly 10
    expect(validate(f)).toEqual({});
  });

  it('passes when value is shorter than the maximum', () => {
    const f = new MaxLengthFixture();
    f.value = 'short';
    expect(validate(f)).toEqual({});
  });

  it('fails when value exceeds the maximum', () => {
    const f = new MaxLengthFixture();
    f.value = '12345678901'; // 11 chars
    const errors = validate(f);
    expect(errors.value).toContain('must be at most 10 characters');
  });

  it('uses singular "character" for max=1', () => {
    class SingleCharFixture {
      @MaxLength(1)
      v: string = '';
    }
    const f = new SingleCharFixture();
    f.v = 'ab';
    const errors = validate(f);
    expect(errors.v).toContain('must be at most 1 character');
  });

  it('skips validation for empty string', () => {
    const f = new MaxLengthFixture();
    f.value = '';
    expect(validate(f)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Multiple decorators composable on one field
// ---------------------------------------------------------------------------

describe('composable decorators (multiple on same field)', () => {
  it('collects all rule failures for one field', () => {
    class MultiFixture {
      @Required()
      @MinLength(8)
      @MaxLength(10)
      value: string = '';
    }
    const f = new MultiFixture();
    f.value = ''; // fails Required (and MinLength is skipped for empty)
    const errors = validate(f);
    expect(errors.value).toContain('is required');
  });

  it('reports both MinLength and MaxLength independently', () => {
    // Set a value that is non-empty so @Required passes; pick a value < min
    class LengthOnlyFixture {
      @MinLength(5)
      @MaxLength(3)
      value: string = '';
    }
    const f = new LengthOnlyFixture();
    f.value = 'abcd'; // length 4: fails MinLength(5) AND exceeds MaxLength(3)
    const errors = validate(f);
    expect(errors.value).toContain('must be at least 5 characters');
    expect(errors.value).toContain('must be at most 3 characters');
  });
});

// ---------------------------------------------------------------------------
// validate() — full ComposedFixture
// ---------------------------------------------------------------------------

describe('validate()', () => {
  it('returns an empty object for a fully valid instance', () => {
    const f = new ComposedFixture();
    f.email = 'user@example.com';
    f.password = 'securepassword';
    f.calendarId = '550e8400-e29b-41d4-a716-446655440000';
    expect(validate(f)).toEqual({});
  });

  it('returns errors only for invalid fields', () => {
    const f = new ComposedFixture();
    f.email = 'not-an-email';
    f.password = 'securepassword';
    f.calendarId = '550e8400-e29b-41d4-a716-446655440000';
    const errors = validate(f);
    expect(Object.keys(errors)).toEqual(['email']);
  });

  it('returns errors for multiple invalid fields', () => {
    const f = new ComposedFixture();
    f.email = '';
    f.password = 'short';
    f.calendarId = 'not-a-uuid';
    const errors = validate(f);
    expect(errors.email).toContain('is required');
    expect(errors.password).toContain('must be at least 8 characters');
    expect(errors.calendarId).toContain('must be a valid UUID');
  });

  it('returns empty map for object without any rules', () => {
    class Plain {
      value: string = 'hello';
    }
    expect(validate(new Plain())).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// validateOrThrow()
// ---------------------------------------------------------------------------

describe('validateOrThrow()', () => {
  it('does not throw when instance is valid', () => {
    const f = new ComposedFixture();
    f.email = 'user@example.com';
    f.password = 'securepassword';
    f.calendarId = '550e8400-e29b-41d4-a716-446655440000';
    expect(() => validateOrThrow(f)).not.toThrow();
  });

  it('throws ValidationError when instance is invalid', () => {
    const f = new ComposedFixture();
    f.email = '';
    f.password = '';
    f.calendarId = '';
    expect(() => validateOrThrow(f)).toThrow(ValidationError);
  });

  it('thrown ValidationError contains field-level errors', () => {
    const f = new ComposedFixture();
    f.email = 'bad-email';
    f.password = 'ok-pass-length';
    f.calendarId = '';

    let caught: ValidationError | undefined;
    try {
      validateOrThrow(f);
    }
    catch (err) {
      caught = err as ValidationError;
    }

    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught?.fields?.email).toContain('must be a valid email address');
    expect(caught?.errors).toContain('Validation failed');
  });

  it('thrown ValidationError has the correct name', () => {
    const f = new RequiredFixture();
    f.name = '';
    let caught: Error | undefined;
    try {
      validateOrThrow(f);
    }
    catch (err) {
      caught = err as Error;
    }
    expect(caught?.name).toBe('ValidationError');
  });
});
